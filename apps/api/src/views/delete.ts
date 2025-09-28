import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ok, bad, error } from "../common/responses";
import { getAuth, requirePerm } from "../auth/middleware";
import { deleteObject } from "../objects/store";

function getId(evt: APIGatewayProxyEventV2) {
  return evt.pathParameters?.id ?? (evt.rawPath || "").split("/").pop();
}

export async function handle(evt: APIGatewayProxyEventV2) {
  try {
    const ctx = await getAuth(evt);
    requirePerm(ctx, "view:write");

    const id = getId(evt);
    if (!id) return bad("missing_view_id");

    await deleteObject(ctx.tenantId, "view", id);
    return ok({ id, deleted: true });
  } catch (e: any) {
    return error(e?.message || "delete_view_failed");
  }
}
