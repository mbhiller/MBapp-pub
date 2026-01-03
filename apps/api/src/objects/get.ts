import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ok, bad, notFound, error } from "../common/responses";
import { getObjectById } from "./repo";
import { getAuth, requirePerm } from "../auth/middleware";

export async function handle(event: APIGatewayProxyEventV2) {
  try {
    const auth = await getAuth(event);
    const type = event.pathParameters?.type;
    const id   = event.pathParameters?.id;
    if (!type || !id) return bad("Missing type or id");

    // Permission already checked by router via requireObjectPerm()

    const obj = await getObjectById({ tenantId: auth.tenantId, type, id });
    if (!obj) return notFound("Not Found");

    return ok(obj);
  } catch (e: any) {
    return error(e);
  }
}
