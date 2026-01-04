//apps/api/src/inventory/search.ts
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ok, error } from "../common/responses";
import { getAuth, requirePerm } from "../auth/middleware";
import { searchObjectsWithAliases } from "../objects/type-alias";

export async function handle(event: APIGatewayProxyEventV2) {
  try {
    const auth = await getAuth(event);
    requirePerm(auth, "inventory:read");
    const body = event.body ? JSON.parse(event.body) as { q?: string; limit?: number; next?: string } : {};
    const q = body.q || "";
    const page = await searchObjectsWithAliases({ tenantId: auth.tenantId, type: "inventory", q, limit: body.limit ?? 20, next: body.next ?? undefined });
    return ok(page);
  } catch (e:any) { return error(e); }
}
