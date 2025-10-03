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
  const raw = await apiClient.get<any>(`/inventory/${encodeURIComponent(itemId)}/onhand`);

  // Accept either spec shape or legacy:
  // Spec: { id, qtyOnHand, qtyAvailable }
  // Legacy: { itemId, onHand, reserved, available }
  const id = raw?.id ?? raw?.itemId ?? itemId;
  const onHand =
    raw?.qtyOnHand != null ? Number(raw.qtyOnHand) :
    raw?.onHand != null    ? Number(raw.onHand)    :
    0;

  const reserved =
    raw?.reserved != null ? Number(raw.reserved) : undefined;

  const available =
    raw?.available != null   ? Number(raw.available) :
    raw?.qtyAvailable != null? Number(raw.qtyAvailable) :
    (reserved != null ? onHand - reserved : undefined);

  return { itemId: id, onHand, reserved, available };
}


export async function fetchMovements(itemId: string): Promise<Movement[]> {
  const data = await apiClient.get<any>(`/inventory/${encodeURIComponent(itemId)}/movements`);
  if (Array.isArray(data)) return data;
  if (data?.items && Array.isArray(data.items)) return data.items;
  return [];
}

