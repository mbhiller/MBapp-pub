import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { notFound as notFoundResp, error, bad } from "../common/responses";
import { deleteObject, getObjectById } from "../objects/repo";
import { getAuth, requirePerm } from "../auth/middleware";

/**
 * DELETE /workspaces/:id — deletes a workspace.
 */
export async function handle(event: APIGatewayProxyEventV2) {
  try {
    const auth = await getAuth(event);
    requirePerm(auth, "workspace:write");

    const id = event.pathParameters?.id;
    if (!id) return bad({ message: "id is required" });

    const existingWorkspace = await getObjectById({ tenantId: auth.tenantId, type: "workspace", id });
    if (!existingWorkspace) return notFoundResp();

    await deleteObject({ tenantId: auth.tenantId, type: "workspace", id });

    return { statusCode: 204, body: "" } as any;
  } catch (e: any) {
    return error(e);
  }
}
