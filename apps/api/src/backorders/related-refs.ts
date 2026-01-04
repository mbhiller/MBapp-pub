// apps/api/src/backorders/related-refs.ts
// Shared helpers to resolve backorder-related references (inventory + salesOrder) with legacy compatibility

import { getObjectById } from "../objects/repo";

export type InventoryLookupResult = { type: "inventoryItem" | "inventory"; obj: Record<string, any> } | null;

/**
 * Resolve inventory by trying canonical inventoryItem first, then legacy inventory.
 * Returns the matched object and which type was used, or null if neither exists.
 */
export async function resolveInventoryByEitherType({ tenantId, itemId }: { tenantId: string; itemId: string }): Promise<InventoryLookupResult> {
  // Try canonical inventoryItem
  try {
    const invItem = await getObjectById({ tenantId, type: "inventoryItem", id: itemId });
    if (invItem) return { type: "inventoryItem", obj: invItem };
  } catch {}

  // Fallback to legacy inventory
  try {
    const legacy = await getObjectById({ tenantId, type: "inventory", id: itemId });
    if (legacy) return { type: "inventory", obj: legacy };
  } catch {}

  return null;
}

/**
 * Resolve sales order by id (returns null when not found).
 */
export async function resolveSalesOrder({ tenantId, soId }: { tenantId: string; soId: string }) {
  return getObjectById({ tenantId, type: "salesOrder", id: soId });
}

/**
 * Conservatively check whether a sales order contains a line matching the given soLineId.
 * Searches common line identifiers: id, lineId, _key, cid.
 */
export function salesOrderHasLine(so: any, soLineId: string | undefined): boolean {
  if (!soLineId) return false;

  const candidates: any[] = [];
  if (Array.isArray(so?.lines)) candidates.push(...so.lines);

  // Fallback: scan other array fields that look like lines
  for (const [key, value] of Object.entries(so || {})) {
    if (Array.isArray(value) && key.toLowerCase().includes("line")) {
      candidates.push(...value);
    }
  }

  return candidates.some((ln) => {
    if (!ln || typeof ln !== "object") return false;
    const ids = [ln.id, ln.lineId, (ln as any)?._key, (ln as any)?.cid].filter(Boolean);
    return ids.includes(soLineId);
  });
}

function httpError(statusCode: number, message: string, details?: Record<string, any>) {
  const err = new Error(message) as any;
  err.statusCode = statusCode;
  err.body = {
    code: statusCode === 409 ? "conflict" : "invalid_reference",
    message,
    ...(details ? { details } : {}),
  };
  return err;
}

/**
 * Validate that itemId resolves (inventoryItem or inventory) and sales order + line exist.
 * Throws an HTTP-friendly error (409/422) describing the missing reference.
 */
export async function validateBackorderRefsOrThrow(
  { tenantId, soId, soLineId, itemId }: { tenantId: string; soId: string; soLineId: string; itemId: string },
  { requestId }: { requestId?: string } = {}
): Promise<{ inventory: InventoryLookupResult; salesOrder: any }> {
  const inventory = await resolveInventoryByEitherType({ tenantId, itemId });
  if (!inventory) {
    throw httpError(422, `Invalid backorder reference: itemId ${itemId} not found`, {
      requestId,
      itemId,
    });
  }

  const salesOrder = await resolveSalesOrder({ tenantId, soId });
  if (!salesOrder) {
    throw httpError(422, `Invalid backorder reference: sales order ${soId} not found`, {
      requestId,
      soId,
    });
  }

  const hasLine = salesOrderHasLine(salesOrder, soLineId);
  if (!hasLine) {
    throw httpError(422, `Invalid backorder reference: sales order line ${soLineId} not found on ${soId}`, {
      requestId,
      soId,
      soLineId,
    });
  }

  return { inventory, salesOrder };
}
