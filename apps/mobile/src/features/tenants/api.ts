// apps/mobile/src/features/tenants/api.ts
// Works whether ../../lib/http exports `http()` or `client()` (factories) or a prebuilt instance.
import * as HttpMod from "../../lib/http";

export type Tenant = {
  id: string;
  name: string;
  slug?: string;
};

type AxiosLike = {
  get: (url: string, config?: any) => Promise<{ data: any }>;
};

function getClient(): AxiosLike {
  const m: any = HttpMod as any;
  // Prefer factories (functions returning an axios instance)
  if (typeof m.client === "function") return m.client();
  if (typeof m.http === "function") return m.http();
  // Fall back to prebuilt instances, if present
  if (m.client && typeof m.client.get === "function") return m.client;
  if (m.http && typeof m.http.get === "function") return m.http;
  throw new Error("lib/http must export client() or http() or an axios instance");
}

function normalize(raw: any) {
  if (!raw) return null;
  const id = String(raw.id ?? raw.tenantId ?? "").trim();
  if (!id) return null;
  const name = String(raw.name ?? raw.displayName ?? raw.slug ?? id).trim();
  const slug = typeof raw.slug === "string" ? raw.slug : undefined;
  return { id, name, slug } as Tenant;
}

/** GET /tenants — supports array or { items: [...] } payloads */
export async function listTenants(opts?: { signal?: AbortSignal }): Promise<Tenant[]> {
  const api = getClient();
  const res = await api.get("/tenants", { signal: opts?.signal });
  const data = res?.data;
  const arr = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
  return (arr.map(normalize).filter(Boolean) as Tenant[]);
}
