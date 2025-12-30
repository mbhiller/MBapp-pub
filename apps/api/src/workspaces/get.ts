import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ok, notFound, error } from "../common/responses";
import { getObjectById } from "../objects/repo";
import { getAuth, requirePerm } from "../auth/middleware";

/**
 * GET /workspaces/:id — retrieves a single saved View.
 * Mirrors /views/:id behavior: same RBAC guards, tenancy scoping.
 */
export async function handle(event: APIGatewayProxyEventV2) {
  try {
    const auth = await getAuth(event);
    requirePerm(auth, "workspace:read");
    
    const id = event.pathParameters?.id;
    if (!id) return notFound();

    const result = await getObjectById({
      tenantId: auth.tenantId,
      type: "view",
      id,
    });
    
    if (!result) return notFound();

    const views = Array.isArray((result as any)?.views) ? (result as any).views : [];
    const projected = { ...result, type: "workspace", views };
    return ok(projected);
  } catch (e: any) {
    return error(e);
  }
}
