import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ok, bad, error } from "../common/responses";
import { authMiddleware } from "../auth/middleware";
import { putObject } from "./store";
import { normalizeKeys, buildSkuLock } from "./repo";

export async function handle(evt: APIGatewayProxyEventV2) {
  try {
    const ctx = await authMiddleware(evt);
    const type = evt.pathParameters?.type;
    if (!type) return bad("type is required");

    const body = evt.body ? JSON.parse(evt.body) : {};
    if (body.type && body.type !== type) return bad(`body.type must be '${type}'`);
    body.type = type;

    const keys = normalizeKeys({ id: body.id, type, tenantId: ctx.tenantId });
    const now = new Date().toISOString();

    const item = {
      ...body,
      ...keys,
      createdAt: body.createdAt ?? now,
      updatedAt: now,
      tenantId: ctx.tenantId,
    };

    await putObject(item);

    // Example SKU uniqueness lock
    if (type === "product" && body.sku) {
      const lock = buildSkuLock(ctx.tenantId, keys.id, body.sku);
      await putObject(lock);
    }

    return ok(item);
  } catch (e: any) {
    return error(e?.message || "create_failed");
  }
}
