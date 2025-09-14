// apps/mobile/src/api/client.ts
const API_BASE = process.env.EXPO_PUBLIC_API_BASE ?? "https://ki8kgivz1f.execute-api.us-east-1.amazonaws.com";
const TENANT = process.env.EXPO_PUBLIC_TENANT_ID ?? "DemoTenant";

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
    const txt = await r.text().catch(() => "");
    let msg = txt;
    try { const j = JSON.parse(txt); msg = j?.message || j?.error || txt; } catch {}
    throw new Error(msg || `HTTP ${r.status}`);
  }
  return r.json() as Promise<T>;
}

export type ListPage<T> = { items: T[]; next?: string };
export type OrderDir = "asc" | "desc";

export type Product = {
  id: string;
  tenant: string;
  type: "product";
  name?: string;
  name_lc?: string;
  sku?: string;
  price?: number;
  uom?: string;
  taxCode?: string;
  kind?: "good" | "service";
  createdAt: string;
  updatedAt: string;
};

export type MbObject = {
  id: string;
  tenant: string;
  type: string;
  name?: string;
  createdAt: string;
  updatedAt: string;
  [k: string]: any;
};

export const api = {
  objects: {
    list: (type: string, opts?: { limit?: number; cursor?: string; order?: OrderDir }) => {
      const p = new URLSearchParams();
      if (opts?.limit) p.set("limit", String(opts.limit));
      if (opts?.cursor) p.set("cursor", opts.cursor);
      if (opts?.order) p.set("order", opts.order);
      const qs = p.toString() ? `?${p.toString()}` : "";
      return request<ListPage<MbObject>>(`/objects/${encodeURIComponent(type)}${qs}`);
    },
    get: (type: string, id: string) =>
      request<MbObject>(`/objects/${encodeURIComponent(type)}/${encodeURIComponent(id)}`),

    update: (type: string, id: string, patch: Partial<MbObject>) =>
      request<MbObject>(`/objects/${encodeURIComponent(type)}/${encodeURIComponent(id)}`, {
        method: "PUT", body: JSON.stringify(patch)
      }),
  },

  products: {
    list:   (opts?: { q?: string; sku?: string; limit?: number; cursor?: string; order?: OrderDir }) => {
      const p = new URLSearchParams();
      if (opts?.q) p.set("q", opts.q);
      if (opts?.sku) p.set("sku", opts.sku);
      if (opts?.limit) p.set("limit", String(opts.limit));
      if (opts?.cursor) p.set("cursor", opts.cursor);
      if (opts?.order) p.set("order", opts.order);
      const qs = p.toString() ? `?${p.toString()}` : "";
      return request<ListPage<Product>>(`/products${qs}`);
    },

    get:    (id: string) => request<Product>(`/products/${encodeURIComponent(id)}`),

    create: (body: Partial<Product>) =>
      request<Product>(`/products`, { method: "POST", body: JSON.stringify(body) }),

    update: (id: string, patch: Partial<Product>) =>
      request<Product>(`/products/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(patch) }),
  },
};

// Back-compat named exports used elsewhere
export const listProducts  = api.products.list;
export const getProduct    = api.products.get;
export const updateProduct = api.products.update;
export const createProduct = api.products.create;

export const listObjects   = api.objects.list;
export const getObject     = api.objects.get;
export const updateObject  = api.objects.update;
