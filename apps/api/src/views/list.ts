import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ok, internalError } from "../common/responses";
import { listObjects } from "../objects/repo";
import { getAuth, requirePerm } from "../auth/middleware";
import { parsePagination, buildListPage } from "../shared/pagination";

export async function handle(event: APIGatewayProxyEventV2) {
  try {
    const auth = await getAuth(event);
    const qsp = event.queryStringParameters || {};
    const { limit, cursor } = parsePagination(qsp, 25);
    const q = qsp.q ?? undefined;
    const fields = qsp.fields ? String(qsp.fields).split(",").map(s => s.trim()).filter(Boolean) : undefined;

    requirePerm(auth, "view:read");
    const page = await listObjects({ tenantId: auth.tenantId, type: "view", q, next: cursor, limit, fields });
    return ok(buildListPage(page.items, page.next));
  } catch (e: any) {
    return internalError(e);
  }
}
