import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ok, notFound, bad, error } from "../common/responses";
import { replaceObject } from "../objects/repo";
import { getAuth, requirePerm } from "../auth/middleware";

export async function handle(event: APIGatewayProxyEventV2) {
  try {
    const auth = await getAuth(event);
    requirePerm(auth, "workspace:write");

    const id = event.pathParameters?.id;
    if (!id) return notFound();

    const body = JSON.parse(event.body || "{}");

    // Validate required fields
    if (!body.name || typeof body.name !== "string" || body.name.length < 1 || body.name.length > 200) {
      return bad({ message: "name is required and must be 1-200 characters" });
    }

    const workspaceBody = {
      ...body,
      type: "workspace",
      views: body.views || [],
    };

    const result = await replaceObject({
      tenantId: auth.tenantId,
      type: "workspace",
      id,
      body: workspaceBody,
    });

    if (!result) return notFound();
    return ok(result);
  } catch (e: any) {
    return error(e);
  }
}
