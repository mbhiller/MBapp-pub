import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ok, bad, notfound, error } from "../common/responses";
import { authMiddleware } from "../auth/middleware";
import { getObject } from "../objects/store";

export async function handle(evt: APIGatewayProxyEventV2) {
  try {
    const ctx = await authMiddleware(evt);
    const id = evt.pathParameters?.id;
    if (!id) return bad("id required");

    const view = await getObject(ctx.tenantId, "view", id);
    if (!view) return notfound();

    return ok(view);
  } catch (e: any) {
    return error(e?.message || "get_view_failed");
  }
}
