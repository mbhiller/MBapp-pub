import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ok, bad, error } from "../common/responses";
import { getAuth, requirePerm } from "../auth/middleware";
import { getObject, putObject } from "../objects/store";
import { normalizeKeys } from "../objects/repo";

function getId(evt: APIGatewayProxyEventV2) {
  return evt.pathParameters?.id ?? (evt.rawPath || "").split("/").pop();
}

export async function handle(evt: APIGatewayProxyEventV2) {
  try {
    const ctx = await getAuth(evt);
    requirePerm(ctx, "view:write");

    const id = getId(evt);
    if (!id) return bad("missing_view_id");
    if (!evt.body) return bad("missing_body");

    const existing = await getObject(ctx.tenantId, "view", id);
    if (!existing) return bad("view_not_found");

    const patch = JSON.parse(evt.body);

    const next = normalizeKeys({
      ...existing,
      ...patch,
      id,
      type: "view",
      tenantId: ctx.tenantId,
    });

    await putObject(next);

    return ok(next);
  } catch (e: any) {
    if (e instanceof SyntaxError) return bad("invalid_json");
    return error(e?.message || "update_view_failed");
  }
}
