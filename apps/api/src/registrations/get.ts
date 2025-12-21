import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ok, bad, error } from "../common/responses";
import { getObjectById } from "../objects/repo";
import { getAuth, requirePerm } from "../auth/middleware";

export async function handle(event: APIGatewayProxyEventV2) {
  try {
    const auth = await getAuth(event);
    const id = event.pathParameters?.id;

    if (!id) {
      return bad({ message: "id is required" });
    }

    requirePerm(auth, "registration:read");

    const result = await getObjectById({
      tenantId: auth.tenantId,
      type: "registration",
      id,
    });

    if (!result) {
      return ok({ message: "Not Found" }, 404);
    }

    return ok(result);
  } catch (e: any) {
    return error(e);
  }
}
