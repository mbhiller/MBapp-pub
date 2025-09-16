// Lightweight client for Products built on fetch.
// Uses EXPO_PUBLIC_API_BASE and EXPO_PUBLIC_TENANT_ID if present.

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
  try {
    return JSON.parse(text) as T;
  } catch {
    // In case endpoint returns plain text
    return text as unknown as T;
  }
}

// List products (default DESC order). Pass next token to paginate.
export async function listProducts(next?: string, sort: "asc" | "desc" = "desc") {
  const p = new URLSearchParams({ sort });
  if (next) p.set("next", next);
  return request<ListPage<Product>>(`/objects/product?${p.toString()}`);
}


export async function getProduct(id: string): Promise<Product> {
  return request<Product>(`/objects/product/${encodeURIComponent(id)}`);
}

export async function createProduct(input: Partial<Product>): Promise<Product> {
  return request<Product>(`/objects/product`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateProduct(id: string, input: Partial<Product>): Promise<Product> {
  return request<Product>(`/objects/product/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}
