// apps/api/src/inventory/onhand-helpers.ts
// Shared helper for computing on-hand inventory from movements

import { listMovementsByItem } from "./movements";
import { deriveCounters } from "./counters";

export interface OnhandResult {
  itemId: string;
  onHand: number;
  reserved: number;
  available: number;
  asOf: string;
  // Debug fields (present only if MBAPP_DEBUG_ONHAND=1)
  movementSource?: "timeline" | "fallback";
  timelineTotal?: number;
  timelineForItem?: number;
  fallbackForItem?: number;
}

/**
 * Compute on-hand inventory for a single item.
 * Queries movements via base table (ConsistentRead: true, no GSI).
 * Returns zero counters if no movements found.
 */
export async function computeOnhandForItem(
  tenantId: string,
  itemId: string
): Promise<OnhandResult> {
  // Query movements using base table query (ConsistentRead: true)
  // NOTE: listMovementsByItem queries pk=tenantId, begins_with(sk, "inventoryMovementAt#")
  //       then filters by itemId in-memory. No IndexName (GSI) used.
  const result = await listMovementsByItem(tenantId, itemId, { limit: 1000, sort: "desc" });
  const movs = result.items;

  if (movs && movs.length > 0) {
    if (process.env.MBAPP_DEBUG_ONHAND === "1") {
      console.log(`[computeOnhandForItem] Found ${movs.length} movements for itemId=${itemId}: ${movs.map(m => `[${m.action}:${m.qty}]`).join(",")}`);
    }
    const c = deriveCounters(movs);
    if (process.env.MBAPP_DEBUG_ONHAND === "1") {
      console.log(`[computeOnhandForItem] Derived counters: onHand=${c.onHand}, reserved=${c.reserved}, available=${c.available}`);
    }
    const onhand: OnhandResult = { itemId, ...c, asOf: new Date().toISOString() };
    
    // Include debug fields if enabled
    if (process.env.MBAPP_DEBUG_ONHAND === "1" && result.debug) {
      onhand.movementSource = result.debug.source;
      onhand.timelineTotal = result.debug.timelineTotal;
      onhand.timelineForItem = result.debug.timelineForItem;
      onhand.fallbackForItem = result.debug.fallbackForItem;
    }
    
    return onhand;
  }

  // No movements found - return zero counters
  const onhand: OnhandResult = { itemId, onHand: 0, reserved: 0, available: 0, asOf: new Date().toISOString() };
  
  // Include debug fields if enabled (all zeros except source=timeline)
  if (process.env.MBAPP_DEBUG_ONHAND === "1" && result.debug) {
    onhand.movementSource = result.debug.source;
    onhand.timelineTotal = result.debug.timelineTotal;
    onhand.timelineForItem = result.debug.timelineForItem;
    onhand.fallbackForItem = result.debug.fallbackForItem;
  }
  
  return onhand;
}
