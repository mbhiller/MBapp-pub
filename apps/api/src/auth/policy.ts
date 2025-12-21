import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { unauthorized } from "../common/responses";

export async function getPolicy(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const auth = event.headers?.authorization || event.headers?.Authorization;
  const tenantId = event.headers?.["x-tenant-id"] || event.headers?.["X-Tenant-Id"];
  if (!auth) return unauthorized();

  // In a real impl, verify JWT & derive roles/tenants. For now echo a safe shape:
  const roles = ["admin"];  // TODO: parse from JWT
  const tenants = tenantId ? [String(tenantId)] : ["DemoTenant"];
  const body = { user: "dev", roles, tenants, scopes: ["*:*"], version: 1, issuedAt: new Date().toISOString() };
  return { statusCode: 200, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}
