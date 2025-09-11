import { listProducts as _list, updateProduct as _update, getProduct as _get } from "../../api/client";

export type Product = {
  id: string;
  name: string;
  sku?: string;
  type?: "good" | "service";
  uom?: string;
  price?: number;
};

export type ListPage = { items: Product[]; nextCursor?: string };
export type UpdateProductPatch = Partial<Pick<Product, "name" | "sku" | "type" | "uom" | "price">>;

export async function listProducts(opts: { q?: string; limit?: number; cursor?: string }): Promise<ListPage> {
  return _list(opts);
}

export async function updateProduct(id: string, patch: UpdateProductPatch): Promise<Product> {
  return _update(id, patch);
}

export async function getProduct(id: string): Promise<Product> {
  return _get(id);
}
