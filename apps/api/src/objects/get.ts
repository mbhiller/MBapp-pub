import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ok, bad, notFound, error } from "../common/responses";
import { getObjectById } from "./repo";
import { resolveObjectByIdWithAliases } from "./type-alias";
import { getAuth, requirePerm } from "../auth/middleware";

export async function handle(event: APIGatewayProxyEventV2) {
  try {
    const auth = await getAuth(event);
    const type = event.pathParameters?.type;
    const id   = event.pathParameters?.id;
    if (!type || !id) return bad("Missing type or id");

    // Permission already checked by router via requireObjectPerm()

    // Prefer canonical type, fall back to aliases for inventory vs inventoryItem only
    const resolved = await resolveObjectByIdWithAliases({ tenantId: auth.tenantId, type, id });
    if (!resolved) return notFound("Not Found");

    return ok(resolved.obj);
  } catch (e: any) {
    return error(e);
  }
}
