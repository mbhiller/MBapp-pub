//apps/api/src/objects/search.ts
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ok, bad, error } from "../common/responses";
import { searchObjects } from "./repo";
import { getAuth, requirePerm } from "../auth/middleware";

export async function handle(event: APIGatewayProxyEventV2) {
  try {
    const auth = await getAuth(event);
    const type = event.pathParameters?.type;
    if (!type) return bad("Missing type");

    requirePerm(auth, `${type}:read`);

    const body   = event.body ? JSON.parse(event.body) : {};
    const q      = body.q ?? "";
    const next   = body.next ?? undefined;
    const limit  = Number(body.limit ?? 20);
    const fields = Array.isArray(body.fields) ? body.fields : undefined;

    const page = await searchObjects({ tenantId: auth.tenantId, type, q, next, limit, fields });
    // Backward-compatible: keep { items, next } and also include pageInfo
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
