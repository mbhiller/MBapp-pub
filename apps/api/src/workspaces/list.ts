import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ok, error } from "../common/responses";
import { authMiddleware } from "../auth/middleware";
import { listObjects } from "../objects/store";

export async function handle(evt: APIGatewayProxyEventV2) {
  try {
    const ctx = await authMiddleware(evt);
    const { items, next } = await listObjects(ctx.tenantId, "view", {
      next: evt.queryStringParameters?.next,
      limit: Number(evt.queryStringParameters?.limit ?? 50),
    });
    return ok({ items, next });
  } catch (e: any) {
    return error(e?.message || "list_views_failed");
  }
}
