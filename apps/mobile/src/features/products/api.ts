import { listObjects, getObject, createObject, updateObject, type ListPage } from "../../api/client";
import type { Product } from "./types";

export const ProductsAPI = {
  list: (opts: { limit?: number; next?: string; kind?: string; order?: "asc" | "desc" } = {}) =>
    listObjects<Product>("product", opts),
  get: (id: string) => getObject<Product>("product", id),
  create: (body: Partial<Product>) => createObject<Product>("product", body),
  update: (id: string, patch: Partial<Product>) => updateObject<Product>("product", id, patch),
};

export type ProductsPage = ListPage<Product>;
