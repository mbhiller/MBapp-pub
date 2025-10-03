import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ok, bad, error } from "../common/responses";
import { getAuth, requirePerm } from "../auth/middleware";
import { getOnHand } from "./counters";

export async function handle(event: APIGatewayProxyEventV2) {
  try {
    const auth = await getAuth(event);
    requirePerm(auth, "inventory:read");
    const body = event.body ? JSON.parse(event.body) as { itemIds?: string[] } : {};
    const ids = Array.isArray(body.itemIds) ? body.itemIds.filter(Boolean) : [];
    if (!ids.length) return bad("itemIds required");

    const items = await Promise.all(ids.map(async (id) => {
      const r = await getOnHand(auth.tenantId, id);
      return { itemId: id, ...r };
    }));
    return ok({ items });
  } catch (e:any) { return error(e); }
}
