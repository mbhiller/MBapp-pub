// apps/mobile/src/features/salesOrders/actions.ts
import { apiClient } from "../../api/client";
import type { components } from "../../api/generated-types";
type Schemas = components["schemas"];

export type FulfillBody = {
  idempotencyKey?: string;
  lines: { lineId: string; deltaQty: number; locationId?: string; lot?: string }[];
};

export async function commitSO(id: string) {
  return apiClient.post<Schemas["SalesOrder"]>(`/sales/so/${encodeURIComponent(id)}:commit`, { id });
}
export async function fulfillSO(id: string, body: FulfillBody) {
  return apiClient.post<Schemas["SalesOrder"]>(`/sales/so/${encodeURIComponent(id)}:fulfill`, { id, ...body });
}
export async function submitSO(id: string) {
  return apiClient.post<Schemas["SalesOrder"]>(`/sales/so/${encodeURIComponent(id)}:submit`, { id });
}
export async function cancelSO(id: string) {
  return apiClient.post<Schemas["SalesOrder"]>(`/sales/so/${encodeURIComponent(id)}:cancel`, { id });
}
export async function closeSO(id: string) {
  return apiClient.post<Schemas["SalesOrder"]>(`/sales/so/${encodeURIComponent(id)}:close`, { id });
}
