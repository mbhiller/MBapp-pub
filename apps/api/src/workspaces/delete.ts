import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { notFound as notFoundResp, error, bad } from "../common/responses";
import { deleteObject, getObjectById } from "../objects/repo";
import { getAuth, requirePerm } from "../auth/middleware";

const DUALWRITE_LEGACY = process.env.MBAPP_WORKSPACES_DUALWRITE_LEGACY === "true";

/**
 * DELETE /workspaces/:id — deletes a saved View.
 * Mirrors /views/:id behavior: same RBAC guards, deletes type='view'.
 */
export async function handle(event: APIGatewayProxyEventV2) {
  try {
    const auth = await getAuth(event);
    requirePerm(auth, "workspace:write");

    const id = event.pathParameters?.id;
    if (!id) return bad({ message: "id is required" });

    if (DUALWRITE_LEGACY) {
      console.warn(JSON.stringify({
        event: "workspaces:dualwrite_enabled",
        tenantId: auth.tenantId,
        op: "delete",
        workspaceId: id,
        flagName: "MBAPP_WORKSPACES_DUALWRITE_LEGACY",
        flagValue: "true",
      }));
    }

    const existingWorkspace = await getObjectById({ tenantId: auth.tenantId, type: "workspace", id });
    const existingView = await getObjectById({ tenantId: auth.tenantId, type: "view", id });

    if (!existingWorkspace && !existingView) return notFoundResp();

    if (DUALWRITE_LEGACY) {
      if (existingWorkspace) {
        await deleteObject({ tenantId: auth.tenantId, type: "workspace", id });
      }
      if (existingView) {
        await deleteObject({ tenantId: auth.tenantId, type: "view", id });
      }
    } else {
      if (existingWorkspace) {
        await deleteObject({ tenantId: auth.tenantId, type: "workspace", id });
      } else if (existingView) {
        await deleteObject({ tenantId: auth.tenantId, type: "view", id });
      }
    }

    return { statusCode: 204, body: "" } as any;
  } catch (e: any) {
    return error(e);
  }
}
