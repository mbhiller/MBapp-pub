// apps/mobile/src/api/client.ts
const API_BASE = process.env.EXPO_PUBLIC_API_BASE ?? "https://ki8kgivz1f.execute-api.us-east-1.amazonaws.com";
const TENANT = process.env.EXPO_PUBLIC_TENANT ?? "DemoTenant";

type ReqInit = RequestInit & { tenant?: string };

async function request<T>(path: string, init?: ReqInit): Promise<T> {
  const url = `${API_BASE}${path}`;
  const r = await fetch(url, {
    ...init,
    headers: {
      accept: "application/json",
      "content-type": init?.body ? "application/json" : "application/json",
      "x-tenant-id": init?.tenant ?? TENANT,
      ...(init?.headers ?? {}),
    },
  });
  if (!r.ok) {
    let detail: any = undefined;
    try {
      detail = await r.json();
    } catch {}
    const msg = `HTTP ${r.status} ${r.statusText}${detail?.message ? `: ${detail.message}` : ""}`;
    throw Object.assign(new Error(msg), { status: r.status, detail });
  }
  return (await r.json()) as T;
}

function qs(params: Record<string, any | undefined>) {
  const u = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined || v === null || v === "") return;
    u.set(k, String(v));
  });
  const s = u.toString();
  return s ? `?${s}` : "";
}

export type ListPage<T> = { items: T[]; nextCursor?: string };

// Domain types
export type Product = {
  id: string;
  sku: string;
  name: string;
  type: "good" | "service";
  uom: string;
  price: number;
  taxCode?: string;
  tags?: any;
  createdAt?: number;
  updatedAt?: number;
};

export const api = {
  get:    <T>(path: string, init?: ReqInit) => request<T>(path, { ...init, method: "GET" }),
  post:   <T>(path: string, body?: any, init?: ReqInit) =>
    request<T>(path, { ...init, method: "POST", body: body ? JSON.stringify(body) : undefined }),
  put:    <T>(path: string, body?: any, init?: ReqInit) =>
    request<T>(path, { ...init, method: "PUT", body: body ? JSON.stringify(body) : undefined }),
  del:    <T>(path: string, init?: ReqInit) => request<T>(path, { ...init, method: "DELETE" }),

  objects: {
    list: (opts: { type: string; limit?: number; cursor?: string; name?: string; signal?: AbortSignal }) =>
      request<ListPage<any>>(`/objects${qs({ type: opts.type, limit: opts.limit, cursor: opts.cursor, name: opts.name })}`, {
        signal: opts.signal,
      }),
    get: (type: string, id: string) => request<any>(`/objects/${encodeURIComponent(type)}/${encodeURIComponent(id)}`),
    create: (type: string, body: Partial<any>) =>
      request<any>(`/objects/${encodeURIComponent(type)}`, { method: "POST", body: JSON.stringify(body) }),
    update: (type: string, id: string, patch: Partial<any>) =>
      request<any>(`/objects/${encodeURIComponent(type)}/${encodeURIComponent(id)}`, {
        method: "PUT",
        body: JSON.stringify(patch),
      }),
    delete: (type: string, id: string) =>
      request<{ ok: true }>(`/objects/${encodeURIComponent(type)}/${encodeURIComponent(id)}`, { method: "DELETE" }),
  },

  products: {
    list: (opts: { q?: string; sku?: string; limit?: number; cursor?: string; signal?: AbortSignal }) =>
      request<ListPage<Product>>(`/products${qs({ q: opts.q, sku: opts.sku, limit: opts.limit, cursor: opts.cursor })}`, {
        signal: opts.signal,
      }),
    get:    (id: string) => request<Product>(`/products/${encodeURIComponent(id)}`),
    create: (body: Partial<Product>) => request<Product>(`/products`, { method: "POST", body: JSON.stringify(body) }),
    update: (id: string, patch: Partial<Product>) =>
      request<Product>(`/products/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(patch) }),
  },
};

/** -------- Back-compat named exports (used by older modules) -------- */
export const listProducts = api.products.list;
export const getProduct   = api.products.get;
export const updateProduct = api.products.update;

export const getObject    = (type: string, id: string) => api.objects.get(type, id);
export const updateObject = (type: string, id: string, patch: Partial<any>) => api.objects.update(type, id, patch);
