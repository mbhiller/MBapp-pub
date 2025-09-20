// apps/mobile/src/features/products/types.ts
export type Product = {
  id: string;
  type: "product";
  tenantId?: string;

  sku?: string;
  name?: string;
  kind?: "good" | "service";
  price?: number;
  uom?: string;
  taxCode?: string;

  createdAt?: string;
  updatedAt?: string;
};

export type Page<T> = { items: T[]; next?: string };
