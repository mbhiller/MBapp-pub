import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ok, notFound, bad, error } from "../common/responses";
import { getObjectById, replaceObject } from "../objects/repo";
import { getAuth, requirePerm } from "../auth/middleware";
import { validateFilters, validateViewBodyFields } from "./validate";

export async function handle(event: APIGatewayProxyEventV2) {
  try {
    const auth = await getAuth(event);
    requirePerm(auth, "view:write");

    const id = event.pathParameters?.id;
    if (!id) return notFound();

    // Fetch existing view to merge patch
    const existing = await getObjectById({ tenantId: auth.tenantId, type: "view", id });
    if (!existing) return notFound();

    const body = JSON.parse(event.body || "{}");

    // Shallow merge; arrays/objects in patch replace existing when provided
    const merged = { ...existing, ...body, id: existing.id, type: "view" } as any;

    // Validate required fields on merged payload
    const fieldError = validateViewBodyFields(merged);
    if (fieldError) {
      return bad({ message: fieldError });
    }

    // Validate filters if provided (merged value)
    const filterError = validateFilters(merged.filters);
    if (filterError) {
      return bad({ message: filterError });
    }

    const result = await replaceObject({ tenantId: auth.tenantId, type: "view", id, body: merged });
    if (!result) return notFound();

    return ok(result);
  } catch (e: any) {
    return error(e);
  }
}
