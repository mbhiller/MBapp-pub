import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ok, bad, error } from "../common/responses";
import { searchObjects } from "./repo";
import { getAuth, requirePerm } from "../auth/middleware";

export async function handle(event: APIGatewayProxyEventV2) {
  try {
    const auth = await getAuth(event);
    const type = event.pathParameters?.type;
    if (!type) return bad("Missing type");

    requirePerm(auth, `${type}:read`);

    const body   = event.body ? JSON.parse(event.body) : {};
    const q      = body.q ?? "";
    const next   = body.next ?? undefined;
    const limit  = Number(body.limit ?? 20);
    const fields = Array.isArray(body.fields) ? body.fields : undefined;

    const page = await searchObjects({ tenantId: auth.tenantId, type, q, next, limit, fields });
    return ok(page);
  } catch (e: any) {
    return error(e);
  }
}
