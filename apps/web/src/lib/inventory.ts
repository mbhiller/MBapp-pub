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
