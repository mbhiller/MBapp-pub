import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ok, bad, error } from "../common/responses";
import { getAuth, requirePerm } from "../auth/middleware";
import { listObjects } from "../objects/repo";

export async function handle(event: APIGatewayProxyEventV2) {
  try {
    const auth = await getAuth(event);
    requirePerm(auth, "inventory:read");
    const id = event.pathParameters?.id; if (!id) return bad("Missing id");
    const qsp = event.queryStringParameters || {};
    const limit = Number(qsp.limit ?? 50);
    const next  = qsp.next ?? undefined;

    // Movements are stored as type=inventoryMovement; filter client-side by itemId.
    const page = await listObjects({ tenantId: auth.tenantId, type: "inventoryMovement", limit, next });
    const items = (page.items as any[]).filter(m => String(m.itemId) === String(id));
    return ok({ items, next: page.next });
  } catch (e:any) { return error(e); }
}
