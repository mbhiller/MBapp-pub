// apps/api/src/shared/movement.ts
export type MovementAction = "receive" | "reserve" | "release" | "fulfill";

export interface InventoryMovement {
  id: string;
  pk: string;             // tenantId
  sk: string;             // "inventoryMovement#<id>"
  type: "inventoryMovement";
  itemId: string;
  qty: number;            // positive for in, negative for out (we use positive deltas and infer by action)
  action: MovementAction; // receive|reserve|release|fulfill
  soId?: string;          // if tied to an SO
  poId?: string;          // if tied to a PO
  lineId?: string;        // line identifier
  locationId?: string;
  lot?: string;
  createdAt: string;
  updatedAt: string;
}
