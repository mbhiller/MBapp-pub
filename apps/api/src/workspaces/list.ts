import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ok, internalError } from "../common/responses";
import { getAuth, requirePerm } from "../auth/middleware";
import { parsePagination } from "../shared/pagination";
import { listWorkspaces } from "./repo";

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
    const page = await listWorkspaces({
      tenantId: auth.tenantId,
      q: qFilter,
      entityType: entityTypeFilter,
      ownerId: ownerIdFilter,
      shared: sharedFilter,
      limit,
      next: cursor,
      fields,
    });

    return ok(page);
  } catch (e: any) {
    return internalError(e);
  }
}
