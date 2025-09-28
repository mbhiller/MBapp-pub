import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ok, bad, error } from "../common/responses";
import { getAuth, requirePerm } from "../auth/middleware";
import { putObject } from "../objects/store";
import { normalizeKeys } from "../objects/repo";

export async function handle(evt: APIGatewayProxyEventV2) {
  try {
    const ctx = await getAuth(evt);
    requirePerm(ctx, "view:write");

    if (!evt.body) return bad("missing_body");

    const data = JSON.parse(evt.body);

    // Ensure type + tenant, then normalize for your Layout A keys
    const obj = normalizeKeys({
      ...data,
      type: "view",
      tenantId: ctx.tenantId,
    });

    // store.putObject expects a single object and returns void
    await putObject(obj);

    // Return the object we just saved (ok(Json) requires a value)
    return ok(obj);
  } catch (e: any) {
    if (e instanceof SyntaxError) return bad("invalid_json");
    return error(e?.message || "create_view_failed");
  }
}
