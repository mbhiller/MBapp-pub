import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ok, bad, error } from "../common/responses";
import { getAuth, requirePerm } from "../auth/middleware";
import { putObject } from "../objects/store";
import { normalizeKeys } from "../objects/repo";

export async function handle(evt: APIGatewayProxyEventV2) {
  try {
    const ctx = await getAuth(evt);
    requirePerm(ctx, "workspace:write");

    if (!evt.body) return bad("missing_body");
    const data = JSON.parse(evt.body);

    const obj = normalizeKeys({
      ...data,
      type: "workspace",
      tenantId: ctx.tenantId,
    });

    await putObject(obj);
    return ok(obj);
  } catch (e: any) {
    if (e instanceof SyntaxError) return bad("invalid_json");
    return error(e?.message || "create_workspace_failed");
  }
}
