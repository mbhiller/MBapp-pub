import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ok, notFound, bad, error } from "../common/responses";
import { replaceObject } from "../objects/repo";
import { getAuth, requirePerm } from "../auth/middleware";

/**
 * PUT /workspaces/:id — updates a saved View.
 * Mirrors /views/:id behavior: same validation, RBAC guards, updates type='view'.
 */
export async function handle(event: APIGatewayProxyEventV2) {
  try {
    const auth = await getAuth(event);
    requirePerm(auth, "workspace:write");

    const id = event.pathParameters?.id;
    if (!id) return notFound();

    const body = JSON.parse(event.body || "{}");

    // Validate required fields (match views/update.ts)
    if (!body.name || typeof body.name !== "string" || body.name.length < 1 || body.name.length > 120) {
      return bad({ message: "name is required and must be 1-120 characters" });
    }
    if (!body.entityType || typeof body.entityType !== "string") {
      return bad({ message: "entityType is required" });
    }

    const viewBody = {
      ...body,
      type: "view",
    };

    const result = await replaceObject({
      tenantId: auth.tenantId,
      type: "view",
      id,
      body: viewBody,
    });

    if (!result) return notFound();
    return ok(result);
  } catch (e: any) {
    return error(e);
  }
}
