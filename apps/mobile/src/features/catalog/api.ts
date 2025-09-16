// apps/mobile/src/features/catalog/api.ts
import { listObjects, getObject, updateObject, createObject } from "../../api/client";

export type ProductId = string;

export type ProductType = "product" | "good" | "service";

export interface Product {
  id: ProductId;
  type: ProductType;
  name?: string;
  sku?: string;
  price?: number;
  uom?: string;            // e.g., "each"
  kind?: string;           // optional categorization/bucket
  metadata?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

export interface ListPage<T> {
  items: T[];
  next?: string;
}

// Use "product" as the canonical type bucket for catalog.
// (If your API stores goods/services under a different bucket, tell me and I'll align it.)
const TYPE: ProductType = "product";

export function listProducts(params?: {
  next?: string;
  q?: string;
  kind?: string;
  signal?: AbortSignal;
}): Promise<ListPage<Product>> {
  return listObjects<Product>(TYPE, {
    cursor: params?.next,
    q: params?.q,
    kind: params?.kind,
    signal: params?.signal,
  }) as unknown as Promise<ListPage<Product>>;
}

export function getProduct(id: string, signal?: AbortSignal): Promise<Product> {
  return getObject<Product>(TYPE, id, signal);
}

export function updateProduct(id: string, patch: Partial<Product>, signal?: AbortSignal): Promise<Product> {
  return updateObject<Product>(TYPE, id, { ...patch, type: TYPE }, signal);
}

// Optional but handy: creating products from the Catalog module.
export function createProduct(input: Partial<Product>, signal?: AbortSignal): Promise<Product> {
  return createObject<Product>(TYPE, { ...input, type: TYPE }, signal);
}
