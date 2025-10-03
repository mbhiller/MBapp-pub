import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { getAuth, requirePerm } from "../auth/middleware";
import { ok, bad, error } from "../common/responses";
import { listObjects, deleteObject } from "../objects/repo";

export async function handle(event: APIGatewayProxyEventV2) {
  try {
    const auth = await getAuth(event);
    requirePerm(auth, "admin:reset");

    const type = event.queryStringParameters?.type || event.pathParameters?.type;
    if (!type) return bad("Missing type");

    const limit = Number(event.queryStringParameters?.limit ?? 200);
    let next: string | undefined = event.queryStringParameters?.next ?? undefined;
    let deleted = 0;

    // Iterate pages and delete until a page is empty (or caller passes one page via ?next=)
    do {
      const page = await listObjects({ tenantId: auth.tenantId, type, limit, next });
      for (const it of page.items as any[]) {
        await deleteObject({ tenantId: auth.tenantId, type, id: String(it.id) });
        deleted++;
      }
      next = page.next ?? undefined;
      // If caller wants one page only, they can pass a flag; otherwise this loops all pages.
    } while (next);

    return ok({ type, deleted });
  } catch (e:any) { return error(e); }
}
export default { handle };
