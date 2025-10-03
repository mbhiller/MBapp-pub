import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ok, bad, error } from "../common/responses";
import { createObject } from "../objects/repo";
import { getAuth, requirePerm } from "../auth/middleware";

export async function handle(event: APIGatewayProxyEventV2) {
  try {
    const auth = await getAuth(event);
    requirePerm(auth, "workspace:write");
    const body = event.body ? JSON.parse(event.body) : {};
    body.type = "workspace";
    const item = await createObject({ tenantId: auth.tenantId, type: "workspace", body }) as { id: string };
    return ok(item);
  } catch (e:any) { return error(e); }
}
