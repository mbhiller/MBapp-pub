// apps/mobile/src/features/products/api.ts
// Minimal client for /products endpoints only (no shared client).

export type Product = {
  id: string;
  name: string;
  sku?: string;
  price?: number;
  uom?: string;
  taxCode?: string;
  kind?: "good" | "service";
};

export type ListPage<T> = { items: T[]; nextCursor?: string };

const API_BASE = (process.env.EXPO_PUBLIC_API_BASE || "").replace(/\/+$/, "");
const TENANT = process.env.EXPO_PUBLIC_TENANT
  || process.env.EXPO_PUBLIC_TENANT_ID
  || "DemoTenant";

function hdr(extra?: Record<string,string>) {
  return {
    accept: "application/json",
    "content-type": "application/json",
    "x-tenant-id": TENANT,
    ...(extra ?? {}),
  };
}
async function okJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function listProducts(opts?: { q?: string; sku?: string; limit?: number; cursor?: string; signal?: AbortSignal; }) {
  const p = new URLSearchParams();
  if (opts?.q) p.set("q", opts.q);
  if (opts?.sku) p.set("sku", opts.sku);
  if (opts?.limit) p.set("limit", String(opts.limit));
  if (opts?.cursor) p.set("cursor", opts.cursor);
  const url = `${API_BASE}/products${p.toString() ? `?${p.toString()}` : ""}`;
  const res = await fetch(url, { method: "GET", headers: hdr(), signal: opts?.signal });
  return okJson<ListPage<Product>>(res);
}

export async function getProduct(id: string) {
  const res = await fetch(`${API_BASE}/products/${encodeURIComponent(id)}`, { method: "GET", headers: hdr() });
  return okJson<Product>(res);
}

export async function createProduct(body: Partial<Product>) {
  const res = await fetch(`${API_BASE}/products`, { method: "POST", headers: hdr(), body: JSON.stringify(body) });
  return okJson<Product>(res);
}

export async function updateProduct(id: string, body: Partial<Product>) {
  const res = await fetch(`${API_BASE}/products/${encodeURIComponent(id)}`, { method: "PUT", headers: hdr(), body: JSON.stringify(body) });
  return okJson<Product>(res);
}
