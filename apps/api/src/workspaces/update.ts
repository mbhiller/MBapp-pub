import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ok, bad, notfound, error } from "../common/responses";
import { getObjectById, updateObject } from "../objects/repo";
import { getAuth, requirePerm } from "../auth/middleware";

export async function handle(event: APIGatewayProxyEventV2) {
  try {
    const auth = await getAuth(event);
    const id = event.pathParameters?.id;
    if (!id) return bad("Missing id");

    requirePerm(auth, "workspace:write");
    const patch = event.body ? JSON.parse(event.body) : {};
    const existing = await getObjectById({ tenantId: auth.tenantId, type: "workspace", id });
    if (!existing) return notfound("Not Found");

    const updated = await updateObject({ tenantId: auth.tenantId, type: "workspace", id, body: patch });
    return ok(updated);
  } catch (e:any) { return error(e); }
}
