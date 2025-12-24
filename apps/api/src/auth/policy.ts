import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { unauthorized } from "../common/responses";
import { resolveTenantId } from "../common/tenant";

export async function getPolicy(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const auth = event.headers?.authorization || event.headers?.Authorization;
  if (!auth) return unauthorized();

  let tenantId: string;
  try {
    tenantId = resolveTenantId(event);
  } catch (err: any) {
    const status = err?.statusCode ?? 400;
    return { statusCode: status, headers: { "content-type": "application/json" }, body: JSON.stringify({ error: err?.code ?? "TenantError", message: err?.message ?? "Tenant resolution failed" }) };
  }

  // In a real impl, verify JWT & derive roles/tenants. For now echo a safe shape:
  const roles = ["admin"];  // TODO: parse from JWT
  const tenants = [tenantId];
  const body = { user: "dev", roles, tenants, scopes: ["*:*"], version: 1, issuedAt: new Date().toISOString() };
  return { statusCode: 200, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}
