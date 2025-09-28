import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ok, bad, notfound, error } from "../common/responses";
import { authMiddleware } from "../auth/middleware";
import { getObject, putObject } from "./store";
import { normalizeKeys, buildSkuLock } from "./repo";

export async function handle(evt: APIGatewayProxyEventV2) {
  try {
    const ctx = await authMiddleware(evt);
    const type = evt.pathParameters?.type;
    const id = evt.pathParameters?.id;
    if (!type || !id) return bad("type and id are required");

    const existing = await getObject(ctx.tenantId, type, id);
    if (!existing) return notfound();

    const body = evt.body ? JSON.parse(evt.body) : {};
    if (body.type && body.type !== type) return bad(`body.type must be '${type}'`);

    const keys = normalizeKeys({ id, type, tenantId: ctx.tenantId });

    const item = {
      ...existing,
      ...body,
      ...keys,
      updatedAt: new Date().toISOString(),
    };

    await putObject(item);

    // If SKU changes, replace lock
    if (type === "product" && body.sku && body.sku !== existing.sku) {
      const lock = buildSkuLock(ctx.tenantId, id, body.sku);
      await putObject(lock);
    }

    return ok(item);
  } catch (e: any) {
    return error(e?.message || "update_failed");
  }
}
