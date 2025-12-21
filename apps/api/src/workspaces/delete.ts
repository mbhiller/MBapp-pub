import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { notFound as notFoundResp, error } from "../common/responses";
import { deleteObject } from "../objects/repo";
import { getAuth, requirePerm } from "../auth/middleware";

/**
 * DELETE /workspaces/:id — deletes a saved View.
 * Mirrors /views/:id behavior: same RBAC guards, deletes type='view'.
 */
export async function handle(event: APIGatewayProxyEventV2) {
  try {
    const auth = await getAuth(event);
    requirePerm(auth, "workspace:write");

    const id = event.pathParameters?.id;
    if (!id) return notFoundResp();

    const result = await deleteObject({
      tenantId: auth.tenantId,
      type: "view",
      id,
    });

    if (!result.ok) return notFoundResp();
    return { statusCode: 204, body: "" } as any;
  } catch (e: any) {
    return error(e);
  }
}
