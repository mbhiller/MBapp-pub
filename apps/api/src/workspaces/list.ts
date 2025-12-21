import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ok, bad, error } from "../common/responses";
import { listObjects } from "../objects/repo";
import { getAuth, requirePerm } from "../auth/middleware";
import { featureViewsEnabled } from "../flags";

/**
 * GET /workspaces — returns saved Views for the current tenant/user.
 * Reuses the same repository logic as /views to load tenant-scoped views (type="view").
 * Maps each view to a workspace summary shape:
 * { id, name, entityType, filters?, columns?, createdAt, updatedAt }.
 * Response: { items, next }. If no views exist or views are disabled, items: [].
 */
export async function handle(event: APIGatewayProxyEventV2) {
  try {
    const auth = await getAuth(event);
    requirePerm(auth, "workspace:read");

    // Respect views feature flag: if views are disabled, return empty list
    const viewsEnabled = featureViewsEnabled(event);
    if (!viewsEnabled) {
      return ok({ items: [], next: null });
    }

    const qsp = event.queryStringParameters || {};
    const limit = Number(qsp.limit ?? 20);
    const next = qsp.next ?? undefined;
    const q = qsp.q ?? undefined;

    // Query views (type="view") using the same repository logic as /views
    const page = await listObjects({
      tenantId: auth.tenantId,
      type: "view",
      q,
      next,
      limit,
    });

    // Map each view to workspace summary shape
    const items = (page.items || []).map((view: any) => ({
      id: view.id,
      name: view.name,
      entityType: view.entityType,
      ...(view.filters && { filters: view.filters }),
      ...(view.columns && { columns: view.columns }),
      createdAt: view.createdAt,
      updatedAt: view.updatedAt,
    }));

    return ok({ items, next: page.next });
  } catch (e: any) {
    return error(e);
  }
}
