// apps/mobile/src/features/products/api.ts
import { apiClient } from "../../api/client";
import type { Product, Page } from "./types";

export async function listProducts(opts: { limit?: number; next?: string | null } = {}): Promise<Page<Product>> {
  const p = new URLSearchParams();
  if (opts.limit != null) p.set("limit", String(opts.limit));
  if (opts.next) p.set("next", opts.next);
  const q = p.toString();
  return apiClient.get<Page<Product>>(`/objects/product${q ? `?${q}` : ""}`);
}

export async function getProduct(id?: string): Promise<Product | undefined> {
  if (!id) return undefined;
  return apiClient.get<Product>(`/objects/product/${encodeURIComponent(id)}`);
}

export async function createProduct(body: Partial<Product>): Promise<Product> {
  // guard rails
  if (!body.name && !body.sku) {
    throw new Error("Either SKU or Name is required.");
  }
  const payload: Partial<Product> = {
    ...body,
    kind: (body.kind as any) || "good",
  };
  return apiClient.post<Product>(`/objects/product`, payload);
}

export async function updateProduct(id: string, patch: Partial<Product>): Promise<Product> {
  if (!id) throw new Error("id required");
  return apiClient.put<Product>(`/objects/product/${encodeURIComponent(id)}`, patch);
}
