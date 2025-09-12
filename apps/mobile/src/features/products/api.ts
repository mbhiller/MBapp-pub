// Products API client (calls /products only)

export type Product = {
  id: string;
  name: string;
  sku?: string;
  price?: number;
  uom?: string;
  taxCode?: string;
  kind?: "good" | "service";
};

const API_BASE = (process.env.EXPO_PUBLIC_API_BASE || "").replace(/\/+$/, "");
const TENANT_ID = process.env.EXPO_PUBLIC_TENANT_ID || "";

function must(v: string, hint: string) {
  if (!v) throw new Error(`${hint} not set`);
  return v;
}
function hdr() {
  return {
    "content-type": "application/json",
    "x-tenant-id": must(TENANT_ID, "EXPO_PUBLIC_TENANT_ID"),
  };
}
async function okJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function listProducts(limit = 50, q?: string, sku?: string): Promise<Product[]> {
  must(API_BASE, "EXPO_PUBLIC_API_BASE");
  const params = new URLSearchParams({ limit: String(limit) });
  if (q) params.set("q", q);
  if (sku) params.set("sku", sku);
  const res = await fetch(`${API_BASE}/products?${params.toString()}`, { headers: hdr() });
  const data = (await okJson<{ items?: Product[] }>(res));
  return data.items ?? [];
}

export async function getProduct(id: string): Promise<Product> {
  must(API_BASE, "EXPO_PUBLIC_API_BASE");
  const res = await fetch(`${API_BASE}/products/${encodeURIComponent(id)}`, { headers: hdr() });
  return okJson<Product>(res);
}

export async function createProduct(body: Partial<Product>): Promise<Product> {
  must(API_BASE, "EXPO_PUBLIC_API_BASE");
  const res = await fetch(`${API_BASE}/products`, {
    method: "POST",
    headers: hdr(),
    body: JSON.stringify(body),
  });
  return okJson<Product>(res);
}

export async function updateProduct(id: string, body: Partial<Product>): Promise<Product> {
  must(API_BASE, "EXPO_PUBLIC_API_BASE");
  const res = await fetch(`${API_BASE}/products/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: hdr(),
    body: JSON.stringify(body),
  });
  return okJson<Product>(res);
}
