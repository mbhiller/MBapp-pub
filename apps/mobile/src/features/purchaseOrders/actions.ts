// apps/mobile/src/features/purchaseOrders/actions.ts
import { apiClient } from "../../api/client";
import type { components } from "../../api/generated-types";
type Schemas = components["schemas"];

export type ReceiveBody = {
  idempotencyKey?: string;
  lines: { lineId: string; deltaQty: number; locationId?: string; lot?: string }[];
};

export async function approvePO(id: string) {
  return apiClient.post<Schemas["PurchaseOrder"]>(`/purchasing/po/${encodeURIComponent(id)}:approve`, { id });
}
export async function receivePO(id: string, body: ReceiveBody) {
  return apiClient.post<Schemas["PurchaseOrder"]>(`/purchasing/po/${encodeURIComponent(id)}:receive`, { id, ...body });
}
export async function submitPO(id: string) {
  return apiClient.post<Schemas["PurchaseOrder"]>(`/purchasing/po/${encodeURIComponent(id)}:submit`, { id });
}
export async function cancelPO(id: string) {
  return apiClient.post<Schemas["PurchaseOrder"]>(`/purchasing/po/${encodeURIComponent(id)}:cancel`, { id });
}
export async function closePO(id: string) {
  return apiClient.post<Schemas["PurchaseOrder"]>(`/purchasing/po/${encodeURIComponent(id)}:close`, { id });
}
