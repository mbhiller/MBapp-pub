import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { noContent, bad, error } from "../common/responses";
import { deleteObject } from "../objects/repo";
import { getAuth, requirePerm } from "../auth/middleware";

export async function handle(event: APIGatewayProxyEventV2) {
  try {
    const auth = await getAuth(event);
    const id = event.pathParameters?.id;

    if (!id) {
      return bad({ message: "id is required" });
    }

    requirePerm(auth, "registration:write");

    await deleteObject({
      tenantId: auth.tenantId,
      type: "registration",
      id,
    });

    return noContent();
  } catch (e: any) {
    return error(e);
  }
}
