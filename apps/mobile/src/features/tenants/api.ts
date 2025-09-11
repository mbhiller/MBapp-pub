// apps/mobile/src/features/tenants/api.ts
import { api } from "../../api/client";

export type Tenant = { id: string; name: string };
export type TenantList = { items: Tenant[] };

export async function listTenants(): Promise<TenantList> {
  return api.get<TenantList>("/tenants");
}
