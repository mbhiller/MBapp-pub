import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ok, internalError } from "../common/responses";
import { listObjects } from "../objects/repo";
import { getAuth, requirePerm } from "../auth/middleware";
import { parsePagination } from "../shared/pagination";

/**
 * GET /workspaces — returns saved Views for the current tenant/user.
 * Mirrors /views behavior exactly: uses same RBAC (getAuth + requirePerm),
 * same tenancy scoping (auth.tenantId), and queries type="view".
 * No feature flag checks (pure RBAC pattern like /views).
 * 
 * Supported filters:
 * - q: case-insensitive substring match on view name
 * - entityType: exact match on entityType field
 */
export async function handle(event: APIGatewayProxyEventV2) {
  try {
    const auth = await getAuth(event);
    const qsp = event.queryStringParameters || {};
    const { limit, cursor } = parsePagination(qsp, 25);
    const fields = qsp.fields ? String(qsp.fields).split(",").map(s => s.trim()).filter(Boolean) : undefined;

    // Extract filters (spec + legacy)
    const qFilter = qsp.q ? String(qsp.q).trim() : undefined;
    const entityTypeFilter = qsp.entityType ? String(qsp.entityType).trim() : undefined;
    const ownerIdFilter = qsp.ownerId ? String(qsp.ownerId).trim() : undefined;
    const sharedRaw = typeof qsp.shared !== "undefined" ? String(qsp.shared).trim().toLowerCase() : undefined;
    const sharedFilter = sharedRaw === "true" ? true : sharedRaw === "false" ? false : undefined;

    requirePerm(auth, "workspace:read");
    // Accumulate pages while applying in-memory filters before pagination
    const collected: any[] = [];
    let cursorToFetch: string | undefined | null = cursor;
    let nextCursor: string | undefined;
    let pagesFetched = 0;
    const seenCursors = new Set<string | null>();

    while (collected.length < limit && pagesFetched < 25) {
      pagesFetched += 1;
      seenCursors.add(cursorToFetch ?? null);

      const page = await listObjects({
        tenantId: auth.tenantId,
        type: "view",
        next: cursorToFetch || undefined,
        limit,
      });

      const pageItems = Array.isArray(page.items) ? page.items : [];
      const qLower = qFilter?.toLowerCase();

      // Apply filters before pagination result collection
      const filtered = pageItems.filter((item: any) => {
        if (qLower) {
          const name = item?.name ? String(item.name).toLowerCase() : "";
          const desc = item?.description ? String(item.description).toLowerCase() : "";
          if (!name.includes(qLower) && !desc.includes(qLower)) return false;
        }

        if (entityTypeFilter && item?.entityType !== entityTypeFilter) return false;
        if (ownerIdFilter && item?.ownerId !== ownerIdFilter) return false;

        if (typeof sharedFilter === "boolean") {
          const val = typeof item?.shared === "boolean" ? item.shared : false;
          if (val !== sharedFilter) return false;
        }

        return true;
      });

      for (const it of filtered) {
        if (collected.length >= limit) break;
        collected.push(it);
      }

      const pageNext = (page as any).next
        ?? (page as any).nextCursor
        ?? (page as any).pageInfo?.nextCursor;

      if (collected.length >= limit) {
        nextCursor = pageNext ?? undefined;
        break;
      }

      if (!pageNext) {
        nextCursor = undefined;
        break;
      }

      if (seenCursors.has(pageNext) || pageNext === cursorToFetch) {
        // No cursor progress; stop to avoid infinite loops
        nextCursor = undefined;
        break;
      }

      cursorToFetch = pageNext;
      nextCursor = pageNext ?? undefined;
    }

    // Project list items as workspaces (type override + views default [])
    const projectedItems = collected.map((item: any) => ({
      ...item,
      type: "workspace",
      views: Array.isArray(item?.views) ? item.views : [],
    })).map((item: any) => {
      if (!fields) return item;
      const projected: Record<string, any> = {};
      for (const f of fields) {
        if (f in item) projected[f] = (item as any)[f];
      }
      return projected;
    });

    const hasNext = !!nextCursor;

    const response = {
      items: projectedItems,
      ...(hasNext ? { next: nextCursor } : {}),
      pageInfo: {
        ...(hasNext ? { nextCursor } : {}),
        hasNext,
      },
    };

    return ok(response);
  } catch (e: any) {
    return internalError(e);
  }
}
