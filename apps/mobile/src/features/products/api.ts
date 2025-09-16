// Products API client (canonical /objects routes)
// Uses EXPO_PUBLIC_API_BASE and EXPO_PUBLIC_TENANT_ID at runtime.

export type ListPage<T> = { items: T[]; next?: string };

export type Product = {
  id: string;
  type: "product";
  name: string;
  sku?: string;
  price?: number;
  uom?: string;
  taxCode?: string;
  kind?: "good" | "service";
  tenantId?: string;
  createdAt?: string;
  updatedAt?: string;
};

const API_BASE = process.env.EXPO_PUBLIC_API_BASE || "";
const TENANT_ID = process.env.EXPO_PUBLIC_TENANT_ID || "DemoTenant";

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(API_BASE + path, {
    method: init.method || "GET",
    headers: {
      "content-type": "application/json",
      "x-tenant-id": TENANT_ID,
      ...(init.headers || {}),
    },
    body: init.body,
  });
  const text = await res.text();
  if (!res.ok) {
    try {
      const j = JSON.parse(text);
      const msg = j?.error || j?.message || text;
      throw new Error(`${res.status} ${res.statusText}: ${msg}`);
    } catch {
      throw new Error(`${res.status} ${res.statusText}: ${text}`);
    }
  }
  try { return JSON.parse(text) as T; } catch { return text as unknown as T; }
}

type ListOpts = {
  limit?: number;
  /** Accept both 'order' and 'sort' to match older callers */
  order?: "asc" | "desc";
  sort?: "asc" | "desc";
  next?: string;
};

// Overloads to preserve older call sites
export function listProducts(): Promise<ListPage<Product>>;
export function listProducts(next: string): Promise<ListPage<Product>>;
export function listProducts(opts: ListOpts): Promise<ListPage<Product>>;
export function listProducts(arg: undefined): Promise<ListPage<Product>>;
export async function listProducts(arg?: string | ListOpts): Promise<ListPage<Product>> {
  const p = new URLSearchParams();
  if (typeof arg === "string") {
    p.set("sort", "desc");
    p.set("next", arg);
  } else {
    const opts = arg ?? {};
    const limit = opts.limit;
    const sort = (opts.sort ?? opts.order ?? "desc"); // default newest first
    const next = opts.next;
    if (limit != null) p.set("limit", String(limit));
    if (sort) p.set("sort", sort);
    if (next) p.set("next", next);
  }
  return request<ListPage<Product>>(`/objects/product?${p.toString()}`);
}

export const getProduct = (id: string) =>
  request<Product>(`/objects/product/${encodeURIComponent(id)}`);

export const createProduct = (input: Partial<Product>) =>
  request<Product>(`/objects/product`, { method: "POST", body: JSON.stringify(input) });

export const updateProduct = (id: string, input: Partial<Product>) =>
  request<Product>(`/objects/product/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(input) });
