// apps/web/src/lib/inventory.ts
// Inventory API helpers using apiFetch for consistent error handling

import { apiFetch } from "./http";

export type InventoryOnHandByLocationItem = {
  itemId: string;
  locationId: string | null;
  onHand: number;
  reserved: number;
  available: number;
  asOf: string;
};

export type InventoryOnHandByLocationResponse = {
  items: InventoryOnHandByLocationItem[];
};

export type InventoryAdjustmentRequest = {
  deltaQty: number;
  locationId?: string;
  lot?: string;
  note?: string;
};

/**
 * Generate idempotency key for inventory mutations.
 * Pattern: idem_<timestamp>_<random>
 */
function generateIdempotencyKey(): string {
  return `idem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Get inventory on-hand counters grouped by location.
 * Endpoint: GET /inventory/{id}/onhand:by-location
 * Returns per-location breakdown of onHand, reserved, available.
 */
export async function getOnHandByLocation(
  itemId: string,
  opts: { token?: string; tenantId: string }
): Promise<InventoryOnHandByLocationItem[]> {
  const response = await apiFetch<InventoryOnHandByLocationResponse>(
    `/inventory/${encodeURIComponent(itemId)}/onhand:by-location`,
    {
      token: opts.token,
      tenantId: opts.tenantId,
    }
  );
  return response.items;
}

/**
 * Adjust inventory for an item.
 * Endpoint: POST /inventory/{id}:adjust
 * Supports positive (increase) or negative (decrease) deltaQty.
 */
export async function adjustInventory(
  itemId: string,
  req: InventoryAdjustmentRequest,
  opts: { token?: string; tenantId: string }
): Promise<any> {
  return apiFetch(`/inventory/${encodeURIComponent(itemId)}:adjust`, {
    method: "POST",
    body: req,
    headers: { "Idempotency-Key": generateIdempotencyKey() },
    token: opts.token,
    tenantId: opts.tenantId,
  });
}
