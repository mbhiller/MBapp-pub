export function getTenantId(evt: any): string | undefined {
  const h = evt?.headers || {};
  return h["x-tenant-id"] || h["X-Tenant-Id"] || process.env.DEFAULT_TENANT || "DemoTenant";
}
