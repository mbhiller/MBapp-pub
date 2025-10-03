import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ok, bad, notfound, error } from "../common/responses";
import { getObjectById } from "./repo";
import { getAuth, requirePerm } from "../auth/middleware";

export async function handle(event: APIGatewayProxyEventV2) {
  try {
    const auth = await getAuth(event);
    const type = event.pathParameters?.type;
    const id   = event.pathParameters?.id;
    if (!type || !id) return bad("Missing type or id");

    requirePerm(auth, `${type}:read`);

    const obj = await getObjectById({ tenantId: auth.tenantId, type, id });
    if (!obj) return notfound("Not Found");

    return ok(obj);
  } catch (e: any) {
    return error(e);
  }
}
