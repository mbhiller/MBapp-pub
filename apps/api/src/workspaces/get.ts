import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ok, notFound, error } from "../common/responses";
import { getAuth, requirePerm } from "../auth/middleware";
import { getWorkspaceById } from "./repo";

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

    const result = await getWorkspaceById({ tenantId: auth.tenantId, id });
    if (!result) return notFound();

    return ok(result);
  } catch (e: any) {
    return error(e);
  }
}
