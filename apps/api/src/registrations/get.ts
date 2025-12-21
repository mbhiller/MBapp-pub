import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ok, badRequest, notFound, internalError } from "../common/responses";
import { getObjectById } from "../objects/repo";
import { getAuth, requirePerm } from "../auth/middleware";
import { guardRegistrations } from "./feature";

export async function handle(event: APIGatewayProxyEventV2) {
  try {
    const guard = guardRegistrations(event);
    if (guard) return guard;

    const auth = await getAuth(event);
    const id = event.pathParameters?.id;

    if (!id) {
      return badRequest("id is required", { field: "id" });
    }

    requirePerm(auth, "registration:read");

    const result = await getObjectById({
      tenantId: auth.tenantId,
      type: "registration",
      id,
    });

    if (!result) {
      return notFound("Not Found");
    }

    return ok(result);
  } catch (e: any) {
    return internalError(e);
  }
}
