import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ok, bad, error } from "../common/responses";
import { authMiddleware } from "../auth/middleware";
import { searchObjects } from "./store";

export async function handle(evt: APIGatewayProxyEventV2) {
  try {
    const ctx = await authMiddleware(evt);
    const type = evt.pathParameters?.type;
    if (!type) return bad("type is required");

    const q = evt.queryStringParameters?.q ?? "";
    const { items, next } = await searchObjects(ctx.tenantId, type, q, {
      next: evt.queryStringParameters?.next,
      limit: Number(evt.queryStringParameters?.limit ?? 50),
    });

    return ok({ items, next });
  } catch (e: any) {
    return error(e?.message || "search_failed");
  }
}
