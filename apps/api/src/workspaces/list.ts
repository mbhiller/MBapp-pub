import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ok, error } from "../common/responses";
import { listObjects } from "../objects/repo";
import { getAuth, requirePerm } from "../auth/middleware";

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
    const limit = Number(qsp.limit ?? 20);
    const next = qsp.next ?? undefined;
    const fields = qsp.fields ? String(qsp.fields).split(",").map(s => s.trim()).filter(Boolean) : undefined;

    // Extract and validate filter parameters
    const qFilter = qsp.q ? String(qsp.q).trim() : undefined;
    const entityTypeFilter = qsp.entityType ? String(qsp.entityType).trim() : undefined;

    requirePerm(auth, "workspace:read");
    
    // Query views (type="view") using the same repository logic as /views
    // Note: not passing q to repo, filter in-memory for precise name matching
    const page = await listObjects({
      tenantId: auth.tenantId,
      type: "view",
      next,
      limit,
      fields,
    });
    
    // Apply in-memory filters to the returned items
    let filteredItems = page.items || [];
    
    // Filter by name (case-insensitive substring match)
    if (qFilter && qFilter.length > 0) {
      const needle = qFilter.toLowerCase();
      filteredItems = filteredItems.filter((item: any) => 
        item.name && String(item.name).toLowerCase().includes(needle)
      );
    }
    
    // Filter by entityType (exact match)
    if (entityTypeFilter && entityTypeFilter.length > 0) {
      filteredItems = filteredItems.filter((item: any) => 
        item.entityType === entityTypeFilter
      );
    }
    
    return ok({ items: filteredItems, next: page.next });
  } catch (e: any) {
    return error(e);
  }
}
