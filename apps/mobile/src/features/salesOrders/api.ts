// src/features/salesOrders/api.ts
import { apiClient } from "../../api/client";

/** ===== Types ===== */

export type SalesOrderLine = {
  id: string;
  itemId: string;
  qty: number;
  qtyFulfilled?: number;
  note?: string;
};

export type SalesOrder = {
  id: string; // soId
  type: "salesOrder";
  orderNumber?: string;
  status:
    | "draft"
    | "submitted"
    | "committed"
    | "partially_fulfilled"
    | "fulfilled"
    | "canceled"
    | "closed"
    | string;
  customerId?: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  customerAltPhone?: string;
  billingAddress?: string;
  shippingAddress?: string;
  customerNotes?: string;
  notes?: string;
  lines: SalesOrderLine[];
  metadata?: {
    reservedMap?: Record<string, number>;
    lastReserve?: Array<{ lineId: string; applied: number; requested: number }>;
  };
};

/** Create payload: lines don’t require an id (server will assign). */
export type CreateSalesOrderBody = {
  customerId?: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  customerAltPhone?: string;
  billingAddress?: string;
  shippingAddress?: string;
  customerNotes?: string;
  status?: string;
  notes?: string;
  lines?: Array<{ itemId: string; qty: number }>;
};

/** Update payload: patch allows replacing lines with id-less entries too */
export type UpdateSalesOrderPatch = Partial<Omit<SalesOrder, "lines">> & {
  lines?: Array<{ id?: string; itemId: string; qty: number; note?: string }>;
};

/** Action payloads */
export type LineDelta = { lineId: string; deltaQty: number };
export type CommitOptions = { strict?: boolean };

/** ===== CRUD via Objects API =====
 * Keeping all SO CRUD routed through /objects keeps things consistent across modules.
 */

export async function listSalesOrders(params?: {
  limit?: number;
  next?: string;
  by?: string;
  sort?: "asc" | "desc";
}) {
  const qs = new URLSearchParams();
  if (params?.limit != null) qs.set("limit", String(params.limit));
  if (params?.next) qs.set("next", params.next);
  if (params?.by) qs.set("by", params.by);
  if (params?.sort) qs.set("sort", params.sort);

  const path = `/objects/${encodeURIComponent("salesOrder")}${qs.toString() ? `?${qs.toString()}` : ""}`;
  return apiClient.get<{ items: SalesOrder[]; next?: string }>(path);
}

export async function getSalesOrder(id: string) {
  return apiClient.get<SalesOrder>(`/objects/salesOrder/${encodeURIComponent(id)}`);
}

export async function createSalesOrder(body: CreateSalesOrderBody) {
  // Response will be the full SalesOrder, including generated ids for lines
  return apiClient.post<SalesOrder>("/objects/salesOrder", body);
}

export async function updateSalesOrder(id: string, patch: UpdateSalesOrderPatch) {
  return apiClient.put<SalesOrder>(`/objects/salesOrder/${encodeURIComponent(id)}`, patch);
}

export async function appendLines(id: string, lines: Array<{ itemId: string; qty: number }>) {
  const so = await getSalesOrder(id);
  const next = Array.isArray(so?.lines)
    ? [...so.lines, ...lines.map(l => ({ itemId: l.itemId, qty: l.qty }))]
    : [...lines];
  return updateSalesOrder(id, { lines: next });
}

/** ===== Sales Order Actions (router-specific) =====
 * These hit the action endpoints implemented in apps/api index.ts
 */

export async function submitSalesOrder(id: string) {
  return apiClient.post<SalesOrder>(`/sales/so/${encodeURIComponent(id)}:submit`, {});
}

export async function commitSalesOrder(id: string, opts: CommitOptions = {}) {
  // `strict` query toggle (server can also accept body if you prefer)
  const qs = new URLSearchParams();
  if (opts.strict) qs.set("strict", "1");
  const path = `/sales/so/${encodeURIComponent(id)}:commit${qs.toString() ? `?${qs.toString()}` : ""}`;
  return apiClient.post<SalesOrder>(path, {});
}

export async function reserveSalesOrder(id: string, lines: LineDelta[]) {
  return apiClient.post<SalesOrder>(`/sales/so/${encodeURIComponent(id)}:reserve`, { lines });
}

export async function fulfillSalesOrder(id: string, lines: LineDelta[]) {
  return apiClient.post<SalesOrder>(`/sales/so/${encodeURIComponent(id)}:fulfill`, { lines });
}

export async function releaseSalesOrder(id: string, lines: LineDelta[]) {
  // Your OpenAPI defines /sales/so/{id}:release with { lineId, deltaQty, reason? }.
  return apiClient.post<{ ok: true } | SalesOrder>(`/sales/so/${encodeURIComponent(id)}:release`, { lines });
}

export async function cancelSalesOrder(id: string) {
  return apiClient.post<SalesOrder>(`/sales/so/${encodeURIComponent(id)}:cancel`, {});
}

export async function closeSalesOrder(id: string) {
  return apiClient.post<SalesOrder>(`/sales/so/${encodeURIComponent(id)}:close`, {});
}

/** ===== Scanner helpers re-export =====
 * Keep scanner/EPC utilities in the shared module and re-export them here
 * so screens importing from salesOrders/api.ts don’t need another import path.
 */
export { resolveEpc } from "../_shared/epc";

export async function postScannerAction(payload: {
  action: "receive" | "pick" | "count" | "move";
  epc: string;
  sessionId?: string;
  fromLocationId?: string;
  toLocationId?: string;
}) {
  const headers: Record<string, string> = {};
  if (payload.action === "receive") headers["Idempotency-Key"] = `scan-${payload.epc}`;
  return apiClient.post("/scanner/actions", payload, headers);
}