export type InventoryItem = {
  id: string;
  type: "product";
  sku?: string;
  name?: string;
  kind?: "good";
  price?: number;
  createdAt?: string;
  updatedAt?: string;
};

/*export interface InventoryItem {
  id: InventoryId;
  tenantId?: string;

  // core
  type: "inventory";
  productId?: string;
  sku?: string;
  name?: string;
  qtyOnHand: number;
  uom?: string;
  cost?: number;
  location?: string;
  kind?: string;

  createdAt?: string;
  updatedAt?: string;
  metadata?: Record<string, unknown>;
}*/