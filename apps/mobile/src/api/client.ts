// apps/mobile/src/api/client.ts
// Centralized API client for the mobile app.
// Ensures correct base URL, tenant header, lowercase paths, and JSON error handling.

export type ObjectRecord = {
  id: string;
  type: string;
  name?: string;
  tags?: Record<string, any>;
  [k: string]: any;
};

export type Product = {
  id: string;
  name: string;
  sku?: string;
  type?: "good" | "service";
  uom?: string;
  price?: number;
};

export type ListPage<T> = { items: T[]; nextCursor?: string };

const API_BASE = (process.env.EXPO_PUBLIC_API_BASE || "").replace(/\/+$/, "");
const TENANT   = process.env.EXPO_PUBLIC_TENANT_ID || "DemoTenant";

function toUrl(path: string, params?: Record<string, string | number | boolean | undefined>) {
  const url = new URL(API_BASE + path.toLowerCase());
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

async function request<T = any>(path: string, init?: RequestInit, params?: Record<string, any>): Promise<T> {
  const url = toUrl(path, params);
  const resp = await fetch(url, {
    ...init,
    headers: {
      accept: "application/json",
      "x-tenant-id": TENANT,
      ...(init?.headers || {}),
    },
  });

  const text = await resp.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }

  if (!resp.ok) {
    const msg = (data && (data.message || data.error)) || resp.statusText;
    throw new Error(msg);
  }
  return data as T;
}

/* --------------------------- Generic helpers ----------------------------- */
function get<T = any>(path: string, params?: Record<string, any>) {
  return request<T>(path, undefined, params);
}
function post<T = any>(path: string, body?: any) {
  return request<T>(path, { method: "POST", headers: { "content-type": "application/json" }, body: body == null ? undefined : JSON.stringify(body) });
}

/* --------------------------- Objects endpoints --------------------------- */
export async function listObjects(opts: { type: string; limit?: number; cursor?: string }): Promise<ListPage<ObjectRecord>> {
  return request<ListPage<ObjectRecord>>("/objects", undefined, { type: opts.type, limit: opts.limit ?? 25, cursor: opts.cursor });
}
export async function getObject(type: string, id: string): Promise<ObjectRecord> {
  return request<ObjectRecord>(`/objects/${encodeURIComponent(type)}/${encodeURIComponent(id)}`);
}
export async function createObject(type: string, body: Partial<ObjectRecord>): Promise<ObjectRecord> {
  return request<ObjectRecord>(`/objects/${encodeURIComponent(type)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}
export async function updateObject(type: string, id: string, patch: Partial<ObjectRecord> & { tags?: Record<string, any> }): Promise<ObjectRecord> {
  return request<ObjectRecord>(`/objects/${encodeURIComponent(type)}/${encodeURIComponent(id)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
}

/* --------------------------- Products endpoints -------------------------- */
export type UpdateProductPatch = Partial<Pick<Product, "name" | "sku" | "type" | "uom" | "price">>;
export async function listProducts(opts: { q?: string; limit?: number; cursor?: string }): Promise<ListPage<Product>> {
  return request<ListPage<Product>>("/products", undefined, { q: opts.q, limit: opts.limit ?? 25, cursor: opts.cursor });
}
export async function getProduct(id: string): Promise<Product> {
  return request<Product>(`/products/${encodeURIComponent(id)}`);
}
export async function updateProduct(id: string, patch: UpdateProductPatch): Promise<Product> {
  return request<Product>(`/products/${encodeURIComponent(id)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
}

/* ----------------------------- Public facade ----------------------------- */
export const api = {
  // generic
  get,
  post,
  // grouped
  objects: { list: listObjects, get: getObject, create: createObject, update: updateObject },
  products: { list: listProducts, get: getProduct, update: updateProduct },
};
