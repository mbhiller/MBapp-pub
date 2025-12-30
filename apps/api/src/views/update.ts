import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ok, notFound, bad, error } from "../common/responses";
import { replaceObject } from "../objects/repo";
import { getAuth, requirePerm } from "../auth/middleware";
import { validateFilters } from "./validate";

export async function handle(event: APIGatewayProxyEventV2) {
  try {
    const auth = await getAuth(event);
    requirePerm(auth, "view:write");

    const id = event.pathParameters?.id;
    if (!id) return notFound();

    const body = JSON.parse(event.body || "{}");

    // Validate required fields
    if (!body.name || typeof body.name !== "string" || body.name.length < 1 || body.name.length > 120) {
      return bad({ message: "name is required and must be 1-120 characters" });
    }
    if (!body.entityType || typeof body.entityType !== "string") {
      return bad({ message: "entityType is required" });
    }

    // Validate filters if present
    const filterError = validateFilters(body.filters);
    if (filterError) {
      return bad({ message: filterError });
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
