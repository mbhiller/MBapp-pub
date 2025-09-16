// apps/mobile/src/features/inventory/types.ts
export type InventoryId = string;

export interface InventoryItem {
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
}

export interface ListPage<T> {
  items: T[];
  next?: string;
}
