import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ok, bad, notfound, error } from "../common/responses";
import { authMiddleware } from "../auth/middleware";
import { getObject, putObject } from "../objects/store";
import { normalizeKeys } from "../objects/repo";

export async function handle(evt: APIGatewayProxyEventV2) {
  try {
    const ctx = await authMiddleware(evt);
    const id = evt.pathParameters?.id;
    if (!id) return bad("id required");

    const existing = await getObject(ctx.tenantId, "view", id);
    if (!existing) return notfound();

    const body = evt.body ? JSON.parse(evt.body) : {};
    const keys = normalizeKeys({ id, type: "view", tenantId: ctx.tenantId });

    const item = { ...existing, ...body, ...keys, updatedAt: new Date().toISOString() };
    await putObject(item);
    return ok(item);
  } catch (e: any) {
    return error(e?.message || "update_view_failed");
  }
}
