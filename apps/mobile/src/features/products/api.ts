// apps/mobile/src/features/products/api.ts
import { listObjects, getObject, createObject, updateObject } from "../../api/client";
import type { Product, Page } from "./types";

const TYPE = "product";

// Match your client's options shape:
// - `next` is string (no null)
// - uses `sort` instead of `order`
// - add `by: "updatedAt"` so newest items stay on top
function toClientOpts(opts?: { limit?: number; next?: string | null; q?: string }) {
  const out: { limit?: number; next?: string; sort?: "asc" | "desc"; by?: string; [k: string]: any } = {};
  if (opts?.limit != null) out.limit = opts.limit;
  if (opts?.next) out.next = opts.next; // only pass if truthy; avoids null
  if (opts?.q) out.q = opts.q;
  out.sort = "desc";
  out.by = "updatedAt";
  return out;
}

// --- Named exports to mirror Events module ---
export function listProducts(opts: { limit?: number; next?: string | null; q?: string } = {}): Promise<Page<Product>> {
  return listObjects<Product>(TYPE, toClientOpts(opts)) as unknown as Promise<Page<Product>>;
}

export function getProduct(id: string): Promise<Product> {
  return getObject<Product>(TYPE, id);
}

export function createProduct(body: Partial<Product>): Promise<Product> {
  return createObject<Product>(TYPE, body);
}

export function updateProduct(id: string, patch: Partial<Product>): Promise<Product> {
  return updateObject<Product>(TYPE, id, patch);
}
