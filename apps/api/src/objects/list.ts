import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ok, bad, error } from "../common/responses";
import { listObjects } from "./repo";
import { getAuth, requirePerm } from "../auth/middleware";

export async function handle(event: APIGatewayProxyEventV2) {
  try {
    const auth = await getAuth(event);
    const type = event.pathParameters?.type;
    if (!type) return bad("Missing type");

    requirePerm(auth, `${type}:read`);

    const qsp = event.queryStringParameters || {};
    const limit  = Number(qsp.limit ?? 20);
    const next   = qsp.next ?? undefined;
    const q      = qsp.q ?? undefined;
    const fields = qsp.fields ? String(qsp.fields).split(",").map(s => s.trim()).filter(Boolean) : undefined;

    const page = await listObjects({ tenantId: auth.tenantId, type, q, next, limit, fields });
    return ok(page);
  } catch (e: any) {
    return error(e);
  }
}
