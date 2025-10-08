// apps/api/src/epc/resolve.ts
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { getObjectById } from "../objects/repo";

export async function handle(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const { tenantId } = getAuth(event);
  const epc = event.queryStringParameters?.epc;
  if (!epc) return json(400, { error: "Missing ?epc" });

  // Convention: EPCMap rows use id === EPC string (type: "epcMap")
  const map = await getObjectById({ tenantId, type: "epcMap", id: epc });
  if (!map || (map as any).status === "retired") {
    return json(404, { error: "EPC not found" });
  }

  return json(200, { itemId: (map as any).itemId, status: (map as any).status ?? "active" });
}

// ---------- local utils ----------
function getAuth(event: APIGatewayProxyEventV2) {
  // Cast to any so TypeScript doesn't complain about requestContext.authorizer
  const rc: any = (event as any).requestContext || {};
  const auth: any = rc.authorizer || {};

  // Try common places the mbapp payload might live
  // - dev-login might inject it directly as `authorizer.mbapp`
  // - JWT authorizer often exposes it under authorizer.jwt.claims
  const mbRaw =
    auth.mbapp ??
    auth.jwt?.mbapp ??
    auth.jwt?.claims?.mbapp ??
    auth.jwt?.claims?.["mbapp"];

  const mb = parseMaybe(mbRaw) || {};

  return {
    tenantId: String(mb.tenantId ?? "DemoTenant"),
    userId: String(mb.userId ?? "dev-user"),
  };
}

function parseMaybe(v: unknown) {
  if (!v) return undefined;
  if (typeof v === "object") return v as any;
  if (typeof v === "string") {
    try { return JSON.parse(v); } catch { /* claims may already be plain string */ }
  }
  return undefined;
}

function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return { statusCode, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}
