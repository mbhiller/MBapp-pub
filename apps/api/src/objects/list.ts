//apps/api/src/objects/list.ts
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ok, bad, error } from "../common/responses";
import { listObjects } from "./repo";
import { listObjectsWithAliases } from "./type-alias";
import { getAuth, requirePerm } from "../auth/middleware";

export async function handle(event: APIGatewayProxyEventV2) {
  try {
    const auth = await getAuth(event);
    const type = event.pathParameters?.type;
    if (!type) return bad("Missing type");

    // Permission already checked by router via requireObjectPerm()

    const qsp = event.queryStringParameters || {};
    const limit  = Number(qsp.limit ?? 20);
    const next   = qsp.next ?? undefined;
    const q      = qsp.q ?? undefined;
    const fields = qsp.fields ? String(qsp.fields).split(",").map(s => s.trim()).filter(Boolean) : undefined;
    
    // Parse filter.* query params
    const filters: Record<string, string> = {};
    for (const [key, value] of Object.entries(qsp)) {
      if (key.startsWith("filter.") && value) {
        const field = key.slice(7); // "filter.soId" → "soId"
        filters[field] = String(value);
      }
    }

    const page = await listObjectsWithAliases({ tenantId: auth.tenantId, type, q, next, limit, fields, filters: Object.keys(filters).length > 0 ? filters : undefined });
    // Backward-compatible: keep { items, next } but also include pageInfo if available
    return ok({
      ...page,
      pageInfo: {
        hasNext: Boolean(page?.next),
        nextCursor: page?.next ?? null,
        pageSize: limit,
      },
    });
  } catch (e: any) {
    return error(e);
  }
}
