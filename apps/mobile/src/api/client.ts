// apps/mobile/src/api/client.ts
// Canonical objects client used by all features.
// Reads Expo envs if present, otherwise falls back to hard-coded defaults.

const API_BASE =
  (process.env.EXPO_PUBLIC_API_BASE ?? "https://ki8kgivz1f.execute-api.us-east-1.amazonaws.com").replace(/\/+$/, "");
const TENANT = process.env.EXPO_PUBLIC_TENANT_ID ?? "DemoTenant";

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

async function request<T>(path: string, method: HttpMethod = "GET", body?: any): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-tenant-id": TENANT,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${path}${text ? ` — ${text}` : ""}`);
  }
  if (res.status === 204) return undefined as unknown as T;
  return (await res.json()) as T;
}

export type ListPage<T> = { items: T[]; next?: string };

function qs(params?: Record<string, any>) {
  const s = new URLSearchParams();
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === "") continue;
      s.set(k, String(v));
    }
  }
  const q = s.toString();
  return q ? `?${q}` : "";
}

// Canonical /objects helpers
export async function listObjects<T>(
  type: string,
  opts: { limit?: number; next?: string; sort?: "asc" | "desc" } & Record<string, any> = {}
): Promise<ListPage<T>> {
  return request<ListPage<T>>(`/objects/${encodeURIComponent(type)}${qs(opts)}`, "GET");
}

export async function getObject<T>(type: string, id: string): Promise<T> {
  return request<T>(`/objects/${encodeURIComponent(type)}/${encodeURIComponent(id)}`, "GET");
}

export async function createObject<T>(type: string, body: Partial<T>): Promise<T> {
  return request<T>(`/objects/${encodeURIComponent(type)}`, "POST", body);
}

export async function updateObject<T>(type: string, id: string, patch: Partial<T>): Promise<T> {
  return request<T>(`/objects/${encodeURIComponent(type)}/${encodeURIComponent(id)}`, "PUT", patch);
}

export const apiClient = {
  get: <T>(p: string) => request<T>(p, "GET"),
  post: <T>(p: string, b: any) => request<T>(p, "POST", b),
  put: <T>(p: string, b: any) => request<T>(p, "PUT", b),
  del: <T>(p: string) => request<T>(p, "DELETE"),
};
