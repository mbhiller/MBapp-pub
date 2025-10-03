import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ok, bad, error } from "../common/responses";
import { getAuth, requirePerm } from "../auth/middleware";
import { getOnHand } from "./counters";

export async function handle(event: APIGatewayProxyEventV2) {
  try {
    const auth = await getAuth(event);
    requirePerm(auth, "inventory:read");
    const id = event.pathParameters?.id; if (!id) return bad("Missing id");
    const res = await getOnHand(auth.tenantId, id);
    return ok({ itemId: id, ...res });
  } catch (e:any) { return error(e); }
}
