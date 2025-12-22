import { apiClient } from "../../api/client";
import type { components } from "../../api/generated-types";

type Schemas = components["schemas"];

/** Server payload shape we expect from GET /inventory/:id/onhand */
export type OnHandResponse = {
  itemId: string;
  onHand: number;
  reserved?: number;
  available?: number;
};

/** Optional: recent movement entry from GET /inventory/:id/movements */
export type Movement = {
  id?: string;
  ts?: string;           // ISO timestamp
  kind?: string;         // "receipt" | "fulfill" | "adjustment" | ...
  delta?: number;        // signed quantity change
  refType?: string;      // "purchaseOrder" | "salesOrder" | ...
  refId?: string;
  note?: string;
};

export async function fetchOnHand(itemId: string): Promise<OnHandResponse> {
  const res = await apiClient.get<any>(`/inventory/${encodeURIComponent(itemId)}/onhand`);
  const raw = (res as any)?.body ?? res;

  // Support shapes:
  // A) { items: [ { onHand, reserved, available, ... } ] }
  // B) { itemId, onHand, reserved, available, ... }
  // C) { qtyOnHand, qtyReserved, qtyAvailable, ... }
  // D) { items: [ { qtyOnHand, qtyReserved, qtyAvailable } ] }
  const src = Array.isArray(raw?.items) && raw.items.length ? raw.items[0] : raw;

  const id = src?.itemId ?? src?.id ?? raw?.itemId ?? raw?.id ?? itemId;
  const onHand = Number(src?.onHand ?? src?.qtyOnHand ?? 0);
  const reserved = Number(src?.reserved ?? src?.qtyReserved ?? 0);
  const available = Number(src?.available ?? src?.qtyAvailable ?? 0);

  return { itemId: id, onHand, reserved, available };
}


export async function fetchMovements(itemId: string): Promise<Movement[]> {
  const res = await apiClient.get<any>(`/inventory/${encodeURIComponent(itemId)}/movements`);
  const raw = (res as any)?.body ?? res;
  const src = Array.isArray(raw) ? raw : (Array.isArray(raw?.items) ? raw.items : []);
  return src ?? [];
}

