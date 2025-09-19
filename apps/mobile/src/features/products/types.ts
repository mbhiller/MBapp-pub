export type ProductKind = "good" | "service" | string;
export type Product = {
  id: string;
  type: "product";
  sku?: string;
  name?: string;
  kind?: ProductKind;
  price?: number;
  createdAt?: string;
  updatedAt?: string;
};
/* export type Product = {
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
};*/