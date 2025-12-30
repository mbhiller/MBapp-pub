// src/features/purchaseOrders/api.ts
import { getObject, createObject, updateObject, apiClient } from "../../api/client";

/** ===== Types (use qty, same as Sales) ===== */

export type PurchaseOrderLine = {
  id: string;
  itemId: string;
  qty: number;                 // unified name
  qtyReceived?: number;
  note?: string;
};

export type PurchaseOrder = {
  id: string;
  poNumber?: string;
  status:
    | "draft"
    | "submitted"
    | "approved"
    | "partiallyReceived"
    | "received"
    | "cancelled"
    | "closed";
  vendorId?: string;
  vendorName?: string;
  vendorEmail?: string;
  vendorPhone?: string;
  vendorAltPhone?: string;
  billingAddress?: string;
  shippingAddress?: string;
  notes?: string;
  lines?: PurchaseOrderLine[];
  createdAt?: string;
  updatedAt?: string;
};

export type CreatePOBody = Partial<PurchaseOrder> & {
  lines?: Array<Pick<PurchaseOrderLine, "itemId" | "qty" | "note">>;
};

/** allow id? so new lines can be created by backend */
export type UpdatePOBody = Partial<PurchaseOrder> & {
  lines?: Array<{ id?: string; itemId: string; qty: number; note?: string }>;
};

/** ===== CRUD via Objects API ===== */

export async function getPO(id: string) {
  return getObject<PurchaseOrder>("purchaseOrder", id);
}

export async function createPO(body: CreatePOBody) {
  // server expects qty for lines
  return createObject<PurchaseOrder>("purchaseOrder", { type: "purchaseOrder", ...body } as any);
}

export async function updatePO(id: string, body: UpdatePOBody) {
  // server expects qty for lines
  return updateObject<PurchaseOrder>("purchaseOrder", id, body as any);
}

/** ===== Actions that map to apps/api/src/purchasing ===== */

export async function submitPO(id: string) {
  return apiClient.post<PurchaseOrder>(`/purchaseOrders/${id}/submit`, {});
}
export async function approvePO(id: string) {
  return apiClient.post<PurchaseOrder>(`/purchaseOrders/${id}/approve`, {});
}
export async function cancelPO(id: string) {
  return apiClient.post<PurchaseOrder>(`/purchaseOrders/${id}/cancel`, {});
}
export async function closePO(id: string) {
  return apiClient.post<PurchaseOrder>(`/purchaseOrders/${id}/close`, {});
}

/** ===== Receiving ===== */

export type ReceiveLine = { id: string; deltaQty: number };
export async function receivePO(id: string, lines: ReceiveLine[]) {
  return apiClient.post<PurchaseOrder>(`/purchaseOrders/${id}/receive`, { lines });
}
