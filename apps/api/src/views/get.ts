import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ok, bad, error } from "../common/responses";
import { getAuth, requirePerm } from "../auth/middleware";
import { getObject } from "../objects/store";

function getId(evt: APIGatewayProxyEventV2) {
  return evt.pathParameters?.id ?? (evt.rawPath || "").split("/").pop();
}

export async function handle(evt: APIGatewayProxyEventV2) {
  try {
    const ctx = await getAuth(evt);
    requirePerm(ctx, "view:read");

    const id = getId(evt);
    if (!id) return bad("missing_view_id");

    const item = await getObject(ctx.tenantId, "view", id);
    if (!item) return bad("view_not_found");

    return ok(item);
  } catch (e: any) {
    return error(e?.message || "get_view_failed");
  }
}
