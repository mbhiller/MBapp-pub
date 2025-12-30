import { createObject, getObjectById, listObjects, replaceObject } from "../objects/repo";

export type WorkspaceRecord = Record<string, any> & { id?: string; type?: string; views?: string[] };

export type GetWorkspaceArgs = {
  tenantId: string;
  id: string;
  fields?: string[];
};

export type ListWorkspaceArgs = {
  tenantId: string;
  q?: string;
  entityType?: string;
  ownerId?: string;
  shared?: boolean;
  limit?: number;
  next?: string;
  fields?: string[];
};

export type WriteWorkspaceArgs = {
  tenantId: string;
  workspace: WorkspaceRecord;
  dualWriteLegacy?: boolean;
};

type Source = "workspace" | "view";
type CursorState = { src: Source; cursor?: string | null };

function projectWorkspace(obj: any): WorkspaceRecord {
  const views = Array.isArray(obj?.views) ? obj.views : [];
  return { ...obj, type: "workspace", views };
}

function applyFields(item: WorkspaceRecord, fields?: string[]) {
  if (!fields?.length) return item;
  const projected: Record<string, any> = {};
  for (const f of fields) {
    if (f in item) projected[f] = (item as any)[f];
  }
  return projected as WorkspaceRecord;
}

function decodeCursor(token?: string | null): CursorState {
  if (!token) return { src: "workspace", cursor: undefined };
  try {
    const decoded = Buffer.from(token, "base64").toString("utf8");
    const parsed = JSON.parse(decoded) as { src?: Source; cursor?: string | null };
    if (parsed && (parsed.src === "workspace" || parsed.src === "view")) {
      return { src: parsed.src, cursor: parsed.cursor ?? undefined };
    }
  } catch {
    // fall through to legacy format
  }
  return { src: "view", cursor: token };
}

function encodeCursor(state?: CursorState): string | undefined {
  if (!state) return undefined;
  // If we are still using legacy view pagination, return raw cursor for compatibility
  if (state.src === "view" && state.cursor) return state.cursor;
  const payload = { src: state.src, cursor: state.cursor ?? null };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}

export async function getWorkspaceById({ tenantId, id, fields }: GetWorkspaceArgs) {
  const primary = await getObjectById({ tenantId, type: "workspace", id, fields });
  if (primary) return projectWorkspace(primary);

  const legacy = await getObjectById({ tenantId, type: "view", id, fields });
  if (legacy) return projectWorkspace(legacy);

  return null;
}

export async function listWorkspaces({
  tenantId,
  q,
  entityType,
  ownerId,
  shared,
  limit = 25,
  next,
  fields,
}: ListWorkspaceArgs) {
  const decoded = decodeCursor(next);
  const sources: Source[] = ["workspace", "view"];
  const startIdx = Math.max(0, sources.indexOf(decoded.src));
  const cursors: Record<Source, string | undefined | null> = { workspace: undefined, view: undefined };
  cursors[decoded.src] = decoded.cursor ?? undefined;

  const collected: WorkspaceRecord[] = [];
  const seen = new Set<string>();
  let outgoing: CursorState | undefined;
  const maxPagesPerSource = 25;

  for (let si = startIdx; si < sources.length; si++) {
    const source = sources[si];
    let pageCursor = cursors[source];
    let pagesFetched = 0;

    while (collected.length < limit && pagesFetched < maxPagesPerSource) {
      pagesFetched += 1;
      const page = await listObjects({
        tenantId,
        type: source,
        q,
        next: pageCursor || undefined,
        limit,
        fields,
      });

      const qLower = q ? q.toLowerCase() : undefined;
      const filtered = (page.items || []).filter((item: any) => {
        if (qLower) {
          const name = item?.name ? String(item.name).toLowerCase() : "";
          const desc = item?.description ? String(item.description).toLowerCase() : "";
          if (!name.includes(qLower) && !desc.includes(qLower)) return false;
        }
        if (entityType && item?.entityType !== entityType) return false;
        if (ownerId && item?.ownerId !== ownerId) return false;
        if (typeof shared === "boolean") {
          const val = typeof item?.shared === "boolean" ? item.shared : false;
          if (val !== shared) return false;
        }
        return true;
      });

      let uniquesAdded = 0;
      for (const raw of filtered) {
        const projected = projectWorkspace(raw);
        const id = projected.id;
        if (!id) continue;
        if (seen.has(id)) continue; // duplicates do not consume limit
        seen.add(id);
        collected.push(applyFields(projected, fields));
        uniquesAdded += 1;
        if (collected.length >= limit) break;
      }

      const pageNext = (page as any).next ?? (page as any).nextCursor ?? (page as any).pageInfo?.nextCursor;

      if (collected.length >= limit) {
        outgoing = pageNext ? { src: source, cursor: pageNext } : undefined;
        break;
      }

      // If no more pages in this source, stop and move to next source (if any)
      if (!pageNext || pageNext === pageCursor) {
        break;
      }

      // Continue paging current source to find more uniques
      pageCursor = pageNext;
    }

    if (collected.length >= limit) break;

    // Move to next source if it exists
    if (si < sources.length - 1) {
      outgoing = { src: sources[si + 1], cursor: undefined };
    } else {
      outgoing = undefined;
    }
  }

  const nextCursor = encodeCursor(outgoing);
  const hasNext = !!nextCursor;

  return {
    items: collected,
    ...(nextCursor ? { next: nextCursor } : {}),
    pageInfo: {
      hasNext,
      nextCursor: nextCursor ?? null,
    },
  };
}

export async function writeWorkspace({ tenantId, workspace, dualWriteLegacy }: WriteWorkspaceArgs) {
  const base = projectWorkspace({ ...workspace, type: "workspace" });
  const views = Array.isArray(base.views) ? base.views : [];
  base.views = views;

  const hasId = !!base.id;
  const saved = hasId
    ? await replaceObject({ tenantId, type: "workspace", id: base.id!, body: base })
    : await createObject({ tenantId, type: "workspace", body: base });

  if (dualWriteLegacy) {
    const legacyBody = { ...base, type: "view" };
    if (hasId) {
      await replaceObject({ tenantId, type: "view", id: legacyBody.id!, body: legacyBody });
    } else {
      await createObject({ tenantId, type: "view", body: legacyBody });
    }
  }

  return projectWorkspace(saved);
}
