// apps/api/src/common/tenant.ts
// Helper to resolve tenantId for authenticated handlers, enforcing header vs auth alignment.

export type AuthLike = { tenantId?: string } | undefined;

function headerTenant(event: any): string | undefined {
  const h = event?.headers || {};
  return h["X-Tenant-Id"] || h["x-tenant-id"] || h["X-tenant-id"] || h["x-Tenant-Id"] || undefined;
}

export function resolveTenantId(event: any, auth?: AuthLike): string {
  const allowMismatch = process.env.MBAPP_ALLOW_TENANT_HEADER_MISMATCH === "1";
  const authTenant = auth?.tenantId ?? (event as any)?.requestContext?.authorizer?.mbapp?.tenantId;
  if (!authTenant) {
    throw Object.assign(new Error("Missing authenticated tenantId"), { statusCode: 401, code: "MissingTenant" });
  }
  const hdr = headerTenant(event);
  if (hdr && hdr !== authTenant && !allowMismatch) {
    throw Object.assign(new Error("tenant header mismatch"), { statusCode: 400, code: "TenantHeaderMismatch", details: { header: hdr, auth: authTenant } });
  }
  return String(authTenant);
}
