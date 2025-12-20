import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ok, notFound, error } from "../common/responses";
import { getObjectById } from "../objects/repo";
import { getAuth, requirePerm } from "../auth/middleware";

export async function handle(event: APIGatewayProxyEventV2) {
  try {
    const auth = await getAuth(event);
    requirePerm(auth, "view:read");
    
    const id = event.pathParameters?.id;
    if (!id) return notFound();

    const result = await getObjectById({
      tenantId: auth.tenantId,
      type: "view",
      id,
    });
    
    if (!result) return notFound();
    return ok(result);
  } catch (e: any) {
    return error(e);
  }
}
