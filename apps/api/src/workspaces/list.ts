import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ok, error } from "../common/responses";
import { getAuth, requirePerm } from "../auth/middleware";
import { listObjects } from "../objects/store";

export async function handle(evt: APIGatewayProxyEventV2) {
  try {
    const ctx = await getAuth(evt);
    requirePerm(ctx, "workspace:read");

    const limit = Number(evt.queryStringParameters?.limit ?? 50);
    const next  = evt.queryStringParameters?.next;

    const { items, next: nextToken } = await listObjects(ctx.tenantId, "workspace", {
      limit,
      next,
    });

    return ok({ items, next: nextToken });
  } catch (e: any) {
    return error(e?.message || "list_workspaces_failed");
  }
}
