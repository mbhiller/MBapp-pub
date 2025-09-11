import { api } from "../../api/client";

export type Tenant = { id: string; name: string; slug?: string };
type TenantsOut = { items: Tenant[] } | Tenant[];

export async function listTenants(): Promise<{ items: Tenant[] }> {
  const data = await api.get<TenantsOut>("/tenants");
  return Array.isArray(data) ? { items: data } : data;
}
