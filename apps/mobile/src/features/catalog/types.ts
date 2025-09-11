export type Product = {
  id: string;
  sku: string;
  name: string;
  type: "product" | "good" | "service";
  kind?: "good" | "service";
  uom?: string;
  price?: number;
  [k: string]: any;
};
export type ListResponse<T> = { items: T[]; nextCursor?: string };
