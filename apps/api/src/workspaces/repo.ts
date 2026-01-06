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
};

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

export async function getWorkspaceById({ tenantId, id, fields }: GetWorkspaceArgs) {
  const workspace = await getObjectById({ tenantId, type: "workspace", id, fields });
  return workspace ? projectWorkspace(workspace) : null;
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
  // Workspace-only list (no legacy view fallback)
  const page = await listObjects({
    tenantId,
    type: "workspace",
    q,
    next,
    limit,
    fields,
  });

  // Apply additional filters not natively supported by listObjects
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

  const items = filtered.map((raw) => {
    const projected = projectWorkspace(raw);
    return applyFields(projected, fields);
  });

  const nextCursor = (page as any).next ?? (page as any).nextCursor ?? (page as any).pageInfo?.nextCursor ?? null;
  const hasNext = !!nextCursor;

  return {
    items,
    ...(nextCursor ? { next: nextCursor } : {}),
    pageInfo: {
      hasNext,
      nextCursor,
    },
  };
}

export async function writeWorkspace({ tenantId, workspace }: WriteWorkspaceArgs) {
  const base = projectWorkspace({ ...workspace, type: "workspace" });
  const views = Array.isArray(base.views) ? base.views : [];
  base.views = views;

  const hasId = !!base.id;
  const saved = hasId
    ? await replaceObject({ tenantId, type: "workspace", id: base.id!, body: base })
    : await createObject({ tenantId, type: "workspace", body: base });

  return projectWorkspace(saved);
}
