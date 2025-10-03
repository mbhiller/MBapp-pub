import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ok, bad, notfound, error } from "../common/responses";
import { getObjectById, deleteObject } from "../objects/repo";
import { getAuth, requirePerm } from "../auth/middleware";

export async function handle(event: APIGatewayProxyEventV2) {
  try {
    const auth = await getAuth(event);
    const id = event.pathParameters?.id;
    if (!id) return bad("Missing id");

    requirePerm(auth, "view:write");
    const existing = await getObjectById({ tenantId: auth.tenantId, type: "view", id });
    if (!existing) return notfound("Not Found");

    await deleteObject({ tenantId: auth.tenantId, type: "view", id });
    return ok({ ok: true, id, type: "view", deleted: true });
  } catch (e:any) { return error(e); }
}
