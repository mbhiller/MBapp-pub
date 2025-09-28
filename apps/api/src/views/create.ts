import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ok, bad, error } from "../common/responses";
import { authMiddleware } from "../auth/middleware";
import { putObject } from "../objects/store";
import { normalizeKeys } from "../objects/repo";

export async function handle(evt: APIGatewayProxyEventV2) {
  try {
    const ctx = await authMiddleware(evt);
    const body = evt.body ? JSON.parse(evt.body) : {};
    body.type = "view";

    const keys = normalizeKeys({ id: body.id, type: "view", tenantId: ctx.tenantId });
    const now = new Date().toISOString();
    const item = { ...body, ...keys, createdAt: now, updatedAt: now, tenantId: ctx.tenantId };

    await putObject(item);
    return ok(item);
  } catch (e: any) {
    return error(e?.message || "create_view_failed");
  }
}
