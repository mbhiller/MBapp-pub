import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ok, bad, notfound, error } from "../common/responses";
import { getObjectById } from "../objects/repo";
import { getAuth, requirePerm } from "../auth/middleware";

export async function handle(event: APIGatewayProxyEventV2) {
  try {
    const auth = await getAuth(event);
    const id = event.pathParameters?.id;
    if (!id) return bad("Missing id");

    requirePerm(auth, "workspace:read");
    const rec = await getObjectById({ tenantId: auth.tenantId, type: "workspace", id });
    if (!rec) return notfound("Not Found");
    return ok(rec);
  } catch (e:any) { return error(e); }
}
