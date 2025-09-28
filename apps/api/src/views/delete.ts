import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ok, bad, notfound, error } from "../common/responses";
import { authMiddleware } from "../auth/middleware";
import { getObject, deleteObject } from "../objects/store";

export async function handle(evt: APIGatewayProxyEventV2) {
  try {
    const ctx = await authMiddleware(evt);
    const id = evt.pathParameters?.id;
    if (!id) return bad("id required");

    const existing = await getObject(ctx.tenantId, "view", id);
    if (!existing) return notfound();

    await deleteObject(ctx.tenantId, "view", id);
    return ok({ deleted: true, id });
  } catch (e: any) {
    return error(e?.message || "delete_view_failed");
  }
}
