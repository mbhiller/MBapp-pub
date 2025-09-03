export function getTenantId(evt: any): string {
  const claimTenant = evt?.requestContext?.authorizer?.jwt?.claims?.["custom:tenantId"]; // Cognito
  const headerTenant = evt?.headers?.["x-tenant-id"] || evt?.headers?.["X-Tenant-Id"];
  return (claimTenant || headerTenant || "demo") as string; // nonprod convenience
}