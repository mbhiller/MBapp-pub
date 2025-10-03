import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { getAuth, requirePerm } from "../auth/middleware";
import { ok, bad, error } from "../common/responses";
import { listObjects } from "../objects/repo";

export async function handle(event: APIGatewayProxyEventV2) {
  try {
    const auth = await getAuth(event);
    requirePerm(auth, "admin:reset");

    const type = event.queryStringParameters?.type || event.pathParameters?.type;
    if (!type) return bad("Missing type");

    // list without q, just page through one page (caller can use 'next' to continue)
    const limit = Number(event.queryStringParameters?.limit ?? 100);
    const next  = event.queryStringParameters?.next ?? undefined;

    const page = await listObjects({ tenantId: auth.tenantId, type, limit, next });
    // Return the keys you’ll need to delete later
    const keys = (page.items as any[]).map((it) => ({
      pk: auth.tenantId,
      sk: `${type}#${it.id}`,
      id: it.id,
      type,
    }));

    return ok({ type, items: keys, next: page.next });
  } catch (e:any) { return error(e); }
}
export default { handle };
