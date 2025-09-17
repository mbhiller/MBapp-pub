// apps/web/src/lib/api.ts — canonical + compatibility bundle for legacy App.tsx

const API_BASE = import.meta.env.VITE_API_BASE!;
const TENANT   = import.meta.env.VITE_TENANT ?? "DemoTenant";

export type ListPage<T> = { items: T[]; next?: string };

async function req<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "x-tenant-id": TENANT,
      "content-type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`) as Error & { status?: number; data?: any };
    (err as any).status = res.status;
    (err as any).data = data;
    throw err;
  }
  return data as T;
}

// ---------- Canonical generic objects (/objects/:type) ----------
export function listObjects<T>(
  type: string,
  opts: { limit?: number; next?: string; sort?: "asc" | "desc"; [k: string]: any } = {}
): Promise<ListPage<T>> {
  const p = new URLSearchParams();
  if (opts.limit != null) p.set("limit", String(opts.limit));
  if (opts.next) p.set("next", opts.next);
  if (opts.sort) p.set("sort", opts.sort);
  Object.entries(opts).forEach(([k, v]) => {
    if (!["limit", "next", "sort"].includes(k) && v != null) p.set(k, String(v));
  });
  const qs = p.toString();
  return req(`/objects/${encodeURIComponent(type)}${qs ? `?${qs}` : ""}`);
}

export function getObject<T>(type: string, id: string): Promise<T> {
  return req(`/objects/${encodeURIComponent(type)}/${encodeURIComponent(id)}`);
}

// Overload to support BOTH canonical (type, body) and legacy (type, name, tag)
export function createObject<T>(type: string, body: any): Promise<T>;
export function createObject(type: string, name?: string, tag?: string): Promise<{ id?: string }>;
export function createObject(type: string, a?: any, b?: any): Promise<any> {
  const isBody = typeof a === "object" && a !== null;
  const body = isBody ? a : { ...(a ? { name: a } : {}), ...(b ? { tag: b } : {}) };
  return req(`/objects/${encodeURIComponent(type)}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updateObject<T>(type: string, id: string, patch: any): Promise<T> {
  return req(`/objects/${encodeURIComponent(type)}/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(patch),
  });
}

export function deleteObject(type: string, id: string): Promise<{ ok: true }> {
  return req(`/objects/${encodeURIComponent(type)}/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// ---------- Products alias (/products, /products/search, /products/:id) ----------
export type Product = {
  id: string;
  tenant?: string;
  type: "product";
  name?: string;
  sku?: string;
  price?: number;
  uom?: string;
  taxCode?: string;
  kind?: "good" | "service";
  createdAt?: string;
  updatedAt?: string;
};

export function listProducts(opts: {
  limit?: number; next?: string; order?: "asc" | "desc";
} = {}): Promise<ListPage<Product>> {
  const p = new URLSearchParams();
  if (opts.limit != null) p.set("limit", String(opts.limit));
  if (opts.next) p.set("next", opts.next);
  if (opts.order) p.set("order", opts.order);
  const qs = p.toString();
  return req(`/products${qs ? `?${qs}` : ""}`);
}

export function searchProducts(opts: {
  sku?: string; q?: string; limit?: number; order?: "asc" | "desc";
} = {}): Promise<ListPage<Product>> {
  const p = new URLSearchParams();
  if (opts.sku) p.set("sku", opts.sku);
  if (opts.q) p.set("q", opts.q);
  if (opts.limit != null) p.set("limit", String(opts.limit));
  if (opts.order) p.set("order", opts.order);
  const qs = p.toString();
  return req(`/products/search${qs ? `?${qs}` : ""}`);
}

export function getProduct(id: string): Promise<Product> {
  return req(`/products/${encodeURIComponent(id)}`);
}
export function createProduct(body: Partial<Product>): Promise<Product> {
  return req(`/products`, { method: "POST", body: JSON.stringify(body) });
}
export function updateProduct(id: string, patch: Partial<Product>): Promise<Product> {
  return req(`/products/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(patch) });
}

// ---------- Tenants (best-effort) ----------
export async function getTenants(): Promise<Array<{ key: string; name?: string }>> {
  try {
    const r = await req<Array<{ key: string; name?: string }>>(`/tenants`);
    if (Array.isArray(r) && r.length) return r;
  } catch { /* ignore */ }
  // Fallback so demo keeps working
  return [{ key: TENANT, name: TENANT }];
}

// ---------- Legacy compatibility helpers used by existing App.tsx ----------
type LegacyPage<T> = { items: T[]; cursor?: string | null; next?: string | null };

// getObjectByQuery(type, id): try path, then legacy query shape
export async function getObjectByQuery<T>(type: string, id: string): Promise<T> {
  try {
    return await getObject<T>(type, id);
  } catch {
    const p = new URLSearchParams({ type, id });
    const data = await req<{ items?: T[]; item?: T; cursor?: string; next?: string }>(`/objects?${p.toString()}`);
    if ((data as any)?.item) return (data as any).item as T;
    if ((data as any)?.items?.length) return (data as any).items[0] as T;
    throw new Error("Not found");
  }
}

// getObjectByPath(type, id): direct path wrapper
export const getObjectByPath = getObject;

// listByType(type, limit=5, cursor?) — keep null in the signature to satisfy App.tsx’s conditional arg
export async function listByType<T>(
  type: string,
  limit = 5,
  cursor?: string | null
): Promise<LegacyPage<T>> {
  const p = new URLSearchParams();
  if (limit != null) p.set("limit", String(limit));
  if (cursor) p.set("cursor", cursor);
  const data = await req<LegacyPage<T>>(`/objects/${encodeURIComponent(type)}/list?${p.toString()}`);
  // Normalize: if only `next` exists, surface it as `cursor` too
  if (data && !data.cursor && (data as any).next) (data as any).cursor = (data as any).next;
  return data;
}

// searchByTag(tag, limit=5, cursor?) — same null-friendly signature + normalization
export async function searchByTag<T>(
  tag: string,
  limit = 5,
  cursor?: string | null
): Promise<LegacyPage<T>> {
  const p = new URLSearchParams({ tag });
  if (limit != null) p.set("limit", String(limit));
  if (cursor) p.set("cursor", cursor);
  const data = await req<LegacyPage<T>>(`/objects/search?${p.toString()}`);
  if (data && !data.cursor && (data as any).next) (data as any).cursor = (data as any).next;
  return data;
}

// ---------- Convenience: bundle for `import { api } from "./lib/api"`
export const api = {
  // canonical
  listObjects, getObject, createObject, updateObject, deleteObject,
  listProducts, searchProducts, getProduct, createProduct, updateProduct,
  getTenants,
  // legacy helpers kept for App.tsx
  getObjectByQuery, getObjectByPath, listByType, searchByTag,
};
