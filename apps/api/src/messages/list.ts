import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ok, internalError } from "../common/responses";
import { getAuth, requirePerm } from "../auth/middleware";
import { parsePagination, buildListPage } from "../shared/pagination";
import { listObjects } from "../objects/repo";

export async function handle(event: APIGatewayProxyEventV2) {
  try {
    const auth = await getAuth(event);
    const qsp = event.queryStringParameters || {};
    const { limit, cursor } = parsePagination(qsp, 25);

    const status = qsp.status ? String(qsp.status).trim() : undefined;
    const channel = qsp.channel ? String(qsp.channel).trim() : undefined;
    const provider = qsp.provider ? String(qsp.provider).trim() : undefined;
    const to = qsp.to ? String(qsp.to).trim() : undefined;

    requirePerm(auth, "message:read");

    const filters: Record<string, string> = {};
    if (status) filters.status = status;
    if (channel) filters.channel = channel;
    if (provider) filters.provider = provider;
    if (to) filters.to = to;

    const page = await listObjects({
      tenantId: auth.tenantId,
      type: "message",
      limit,
      next: cursor,
      filters: Object.keys(filters).length ? filters : undefined,
    });

    return ok(buildListPage(page.items, page.next ?? null));
  } catch (e: any) {
    return internalError(e);
  }
}
