// apps/mobile/src/api/client.ts
// Canonical objects client used by all features.
// Adds: auto refresh on 401 in dev, dual header casings, Accept header.
import type { PatchLinesOp } from "../lib/patchLinesDiff";

const env = process.env as Record<string, string | undefined>;

let API_BASE = (
  env.EXPO_PUBLIC_API_BASE ??
  env.EXPO_PUBLIC_MBAPP_API_BASE ??  // backward compat
  env.MBAPP_API_BASE ??              // backward compat
  "https://ki8kgivz1f.execute-api.us-east-1.amazonaws.com"
).replace(/\/+$/, "");

let TENANT =
  env.EXPO_PUBLIC_TENANT_ID ??
  env.EXPO_PUBLIC_MBAPP_TENANT_ID ??  // backward compat
  env.MBAPP_TENANT_ID ??              // backward compat
  "DemoTenant";

let _bearerToken: string | null =
  (env.MBAPP_BEARER as string | undefined) ?? null;

if (__DEV__) {
  console.log("[api/client] resolved config", { API_BASE, TENANT, hasBearer: Boolean(_bearerToken) });
}

/**
 * Get feature-enabled headers for API requests.
 * Maps EXPO_PUBLIC env vars to X-Feature-* headers for smoke testing and dev.
 * - EXPO_PUBLIC_MBAPP_FEATURE_REGISTRATIONS_ENABLED → X-Feature-Registrations-Enabled
 * - EXPO_PUBLIC_FEATURE_STRIPE_SIMULATE → X-Feature-Stripe-Simulate
 * - EXPO_PUBLIC_FEATURE_NOTIFY_SIMULATE → X-Feature-Notify-Simulate
 */
function getFeatureHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  
  const registrationsEnabled = process.env.EXPO_PUBLIC_MBAPP_FEATURE_REGISTRATIONS_ENABLED;
  if (registrationsEnabled?.toLowerCase() === "true" || registrationsEnabled === "1") {
    headers["X-Feature-Registrations-Enabled"] = "true";
  }
  
  const stripeSimulate = process.env.EXPO_PUBLIC_FEATURE_STRIPE_SIMULATE;
  if (stripeSimulate?.toLowerCase() === "true" || stripeSimulate === "1") {
    headers["X-Feature-Stripe-Simulate"] = "true";
  }
  
  const notifySimulate = process.env.EXPO_PUBLIC_FEATURE_NOTIFY_SIMULATE;
  if (notifySimulate?.toLowerCase() === "true" || notifySimulate === "1") {
    headers["X-Feature-Notify-Simulate"] = "true";
  }
  
  return headers;
}

export function setApiBase(url: string) { if (url) API_BASE = url.replace(/\/+$/, ""); }
export function setTenantId(tenantId: string) { if (tenantId) TENANT = tenantId; }
export function setBearerToken(token: string | null | undefined) { _bearerToken = token ?? null; }
export function getBearerToken(): string | null { return _bearerToken; }
export function clearBearerToken() { _bearerToken = null; }
export function getTenantId(): string | undefined { return TENANT; }
export function getApiBase(): string { return API_BASE; }

export function _debugConfig() {
  return { API_BASE, TENANT, hasBearer: Boolean(_bearerToken) };
}

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type RequestOpts = { idempotencyKey?: string; headers?: Record<string, string> };

export type ListPage<T> = { items: T[]; next?: string; pageInfo?: { hasNext?: boolean; nextCursor?: string | null; pageSize?: number } };

function normalizePage<T>(res: any): { items: T[]; next?: string; pageInfo?: { hasNext?: boolean; nextCursor?: string | null; pageSize?: number } } {
  if (Array.isArray(res)) return { items: res, pageInfo: undefined };
  if (res && typeof res === "object" && "items" in res) {
    const raw = (res as any).items;
    const items = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? Object.values(raw) : [];
    const next = (res as any).next;
    const pageInfo = (res as any).pageInfo ?? (next ? { hasNext: true, nextCursor: next } : undefined);
    return { items: items as T[], next, pageInfo };
  }
  if (res && typeof res === "object" && "data" in res) {
    const raw = (res as any).data;
    const items = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? Object.values(raw) : [];
    const next = (res as any).next;
    const pageInfo = (res as any).pageInfo ?? (next ? { hasNext: true, nextCursor: next } : undefined);
    return { items: items as T[], next, pageInfo };
  }
  if (res && typeof res === "object") return { items: Object.values(res) as T[], pageInfo: undefined };
  return { items: [], pageInfo: undefined };
}

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

/** Dev-only: silently re-login and set bearer, then return true if refreshed */
async function tryDevRelogin(): Promise<boolean> {
  // Only in dev-like environments where we have Expo envs
  const email   = process.env.EXPO_PUBLIC_DEV_EMAIL  || "dev@example.com";
  const tenant  = TENANT || process.env.EXPO_PUBLIC_TENANT_ID || "DemoTenant";
  try {
    const res = await apiClient.post<{ token: string }>("/auth/dev-login", { email, tenantId: tenant });
    if (res?.token) {
      setBearerToken(res.token);
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}

async function request<T>(path: string, method: HttpMethod = "GET", body?: any, opts: RequestOpts = {}, _retried = false): Promise<T> {
  const featureHeaders = getFeatureHeaders();
  const headers: Record<string, string> = {
    "accept": "application/json",
    "content-type": "application/json",
    // send both casings for tenant & auth (some middlewares normalize differently)
    "X-Tenant-Id": TENANT,
    "x-tenant-id": TENANT,
    ...featureHeaders,
    ...opts.headers,
  };
  if (_bearerToken) {
    headers["Authorization"] = `Bearer ${_bearerToken}`;
    headers["authorization"] = `Bearer ${_bearerToken}`;
  }
  if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;

  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    // If unauthorized once, try a dev re-login and retry exactly once
    if (res.status === 401 && !_retried && !path.startsWith("/auth/dev-login")) {
      const refreshed = await tryDevRelogin();
      if (refreshed) {
        return request<T>(path, method, body, opts, true);
      }
    }

    let detail = "";
    let parsed: any = null;
    try {
      parsed = await res.json();
      const code = parsed?.code ? ` ${parsed.code}` : "";
      const msg  = typeof parsed?.message === "string" ? parsed.message : JSON.stringify(parsed);
      detail = `${code} — ${msg}`;
    } catch {
      const text = await res.text().catch(() => "");
      detail = text;
    }
    const err: any = new Error(`HTTP ${res.status} ${res.statusText} for ${path}${detail ? ` — ${detail}` : ""}`);
    err.status = res.status;
    err.statusText = res.statusText;
    err.code = parsed?.code;
    err.body = parsed;
    throw err;
  }

  if (res.status === 204) return undefined as unknown as T;
  return (await res.json()) as T;
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

export async function patchSalesOrderLines(id: string, ops: PatchLinesOp[], opts: RequestOpts = {}) {
  return request(`/sales/so/${encodeURIComponent(id)}:patch-lines`, "POST", { ops }, opts);
}

export async function patchPurchaseOrderLines(id: string, ops: PatchLinesOp[], opts: RequestOpts = {}) {
  return request(`/purchasing/po/${encodeURIComponent(id)}:patch-lines`, "POST", { ops }, opts);
}

// Low-level pass-through
export const apiClient = {
  get:  <T>(p: string, headers?: Record<string, string>) => request<T>(p, "GET", undefined, { headers }),
  // NEW: GET with query params. Usage: apiClient.getQ('/inventory/abc/movements', { refId, poLineId, next, limit:50 })
  getQ: <T>(p: string, query?: Record<string, any>, headers?: Record<string, string>) =>
  request<T>(`${p}${qs(query)}`, "GET", undefined, { headers }),
  post: <T>(p: string, b: any, headers?: Record<string, string>) => request<T>(p, "POST", b, { headers }),
  put:  <T>(p: string, b: any, headers?: Record<string, string>) => request<T>(p, "PUT", b, { headers }),
  patch: <T>(p: string, b: any, headers?: Record<string, string>) => request<T>(p, "PATCH", b, { headers }),
  del:  <T>(p: string, headers?: Record<string, string>) => request<T>(p, "DELETE", undefined, { headers }),
};

export { getFeatureHeaders };
