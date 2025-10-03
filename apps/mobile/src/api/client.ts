// apps/mobile/src/api/client.ts
// Canonical objects client used by all features.
// Reads MBAPP_* envs first (your PowerShell script sets these), then Expo envs.
// Adds optional Authorization bearer token support (via setBearerToken) and Idempotency-Key.
import AsyncStorage from "@react-native-async-storage/async-storage";
let API_BASE = (
  process.env.MBAPP_API_BASE ??
  process.env.EXPO_PUBLIC_API_BASE ??
  "https://ki8kgivz1f.execute-api.us-east-1.amazonaws.com"
).replace(/\/+$/, "");

let TENANT =
  process.env.MBAPP_TENANT_ID ??
  process.env.EXPO_PUBLIC_TENANT_ID ??
  "DemoTenant";

let _bearerToken: string | null =
  (process.env.MBAPP_BEARER as string | undefined) ?? null;

export function setApiBase(url: string) { if (url) API_BASE = url.replace(/\/+$/, ""); }
export function setTenantId(tenantId: string) { if (tenantId) TENANT = tenantId; }
export function setBearerToken(token: string | null | undefined) { _bearerToken = token ?? null; }
export function getBearerToken(): string | null { return _bearerToken; }
export function clearBearerToken() { _bearerToken = null; }

export function _debugConfig() {
  return { API_BASE, TENANT, hasBearer: Boolean(_bearerToken) };
}

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";
type RequestOpts = { idempotencyKey?: string; headers?: Record<string, string>; };

function normalizePage<T>(res: any): { items: T[]; next?: string } {
  if (Array.isArray(res)) return { items: res };
  if (res && typeof res === "object" && "items" in res) {
    const raw = (res as any).items;
    const items = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? Object.values(raw) : [];
    return { items: items as T[], next: (res as any).next };
  }
  if (res && typeof res === "object" && "data" in res) {
    const raw = (res as any).data;
    const items = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? Object.values(raw) : [];
    return { items: items as T[], next: (res as any).next };
  }
  if (res && typeof res === "object") return { items: Object.values(res) as T[] };
  return { items: [] };
}

async function request<T>(path: string, method: HttpMethod = "GET", body?: any, opts: RequestOpts = {}): Promise<T> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-tenant-id": TENANT,
    ...opts.headers,
  };
  // ⚙️ Send both casings — whichever your middleware inspects will be present
  if (_bearerToken) {
    headers["Authorization"] = `Bearer ${_bearerToken}`;
    headers["authorization"] = `Bearer ${_bearerToken}`;
  }
  if (opts.idempotencyKey) headers["idempotency-key"] = opts.idempotencyKey;

  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    let detail = "";
    try {
      const data = await res.json();
      const code = data?.code ? ` ${data.code}` : "";
      const msg  = typeof data?.message === "string" ? data.message : JSON.stringify(data);
      detail = `${code} — ${msg}`;
    } catch {
      const text = await res.text().catch(() => "");
      detail = text;
    }
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${path}${detail ? ` — ${detail}` : ""}`);
  }

  if (res.status === 204) return undefined as unknown as T;
  return (await res.json()) as T;
}

export type ListPage<T> = { items: T[]; next?: string };

function qs(params?: Record<string, any>) {
  const s = new URLSearchParams();
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null) continue;
      if (Array.isArray(v)) v.forEach((vv) => s.append(k, String(vv)));
      else if (typeof v === "boolean") s.set(k, v ? "true" : "false");
      else s.set(k, String(v));
    }
  }
  const q = s.toString();
  return q ? `?${q}` : "";
}

// ===== Generic Objects helpers =====

export async function listObjects<T>(
  type: string,
  opts: { limit?: number; next?: string; sort?: "asc" | "desc" } & Record<string, any> = {}
): Promise<ListPage<T>> {
  const res = await request<any>(`/objects/${encodeURIComponent(type)}${qs(opts)}`, "GET");
  return normalizePage<T>(res);
}

export async function searchObjects<T>(
  type: string,
  filters: Record<string, any>,
  opts: { limit?: number; next?: string; sort?: "asc" | "desc" } = {}
): Promise<ListPage<T>> {
  const body = { ...filters, ...opts };
  const res = await request<any>(`/objects/${encodeURIComponent(type)}/search`, "POST", body);
  return normalizePage<T>(res);
}

export async function getObject<T>(type: string, id: string): Promise<T> {
  return request<T>(`/objects/${encodeURIComponent(type)}/${encodeURIComponent(id)}`, "GET");
}

export async function createObject<T>(
  type: string,
  body: Partial<T>,
  opts: RequestOpts = {}
): Promise<T> {
  return request<T>(`/objects/${encodeURIComponent(type)}`, "POST", body, opts);
}

export async function updateObject<T>(
  type: string,
  id: string,
  patch: Partial<T>,
  opts: RequestOpts = {}
): Promise<T> {
  return request<T>(`/objects/${encodeURIComponent(type)}/${encodeURIComponent(id)}`, "PUT", patch, opts);
}

export async function deleteObject(
  type: string,
  id: string,
  opts: RequestOpts = {}
): Promise<{ id: string; type: string; deleted: boolean }> {
  return request(`/objects/${encodeURIComponent(type)}/${encodeURIComponent(id)}`, "DELETE", undefined, opts);
}

// Low-level pass-through
export const apiClient = {
  get:  <T>(p: string, headers?: Record<string, string>) => request<T>(p, "GET", undefined, { headers }),
  post: <T>(p: string, b: any, headers?: Record<string, string>) => request<T>(p, "POST", b, { headers }),
  put:  <T>(p: string, b: any, headers?: Record<string, string>) => request<T>(p, "PUT", b, { headers }),
  del:  <T>(p: string, headers?: Record<string, string>) => request<T>(p, "DELETE", undefined, { headers }),
};
