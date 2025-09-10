// apps/mobile/src/features/tenants/api.ts
import { http } from "../../lib/http"; // http(): AxiosInstance

export type Tenant = {
  id: string;
  name: string;
  slug?: string;
};

function normalize(raw: any): Tenant | null {
  if (!raw) return null;
  const id = String(raw.id ?? raw.tenantId ?? "").trim();
  if (!id) return null;
  const name = String(raw.name ?? raw.displayName ?? raw.slug ?? id).trim();
  const slug = typeof raw.slug === "string" ? raw.slug : undefined;
  return { id, name, slug };
}

/** GET /tenants — supports array or { items: [...] } payloads */
export async function listTenants(opts?: { signal?: AbortSignal }): Promise<Tenant[]> {
  const client = http();                    // <<— instantiate
  const res = await client.get("/tenants", { signal: opts?.signal });
  const data = res?.data;
  const arr = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
  return (arr.map(normalize).filter(Boolean) as Tenant[]);
}
