import { apiClient } from "../../api/client";

export type ReserveLine = { lineId: string; deltaQty: number };
export type ReleaseLine = { lineId: string; deltaQty: number; reason?: string };
export type FulfillLine = { lineId: string; deltaQty: number; locationId?: string; lot?: string };
export type CommitOptions = { strict?: boolean };

function unwrap<T = any>(res: any): T {
  return (res as any)?.body ?? res;
}

export async function submitSalesOrder(id: string) {
  const res = await apiClient.post(`/sales/so/${encodeURIComponent(id)}:submit`, {});
  return unwrap(res);
}

export async function commitSalesOrder(id: string, opts?: CommitOptions) {
  const res = await apiClient.post(`/sales/so/${encodeURIComponent(id)}:commit`, opts ?? {});
  return unwrap(res);
}

export async function reserveSalesOrder(id: string, payload: { lines: ReserveLine[] }) {
  const res = await apiClient.post(`/sales/so/${encodeURIComponent(id)}:reserve`, payload);
  return unwrap(res);
}

export async function releaseSalesOrder(id: string, payload: { lines: ReleaseLine[] }) {
  const res = await apiClient.post(`/sales/so/${encodeURIComponent(id)}:release`, payload);
  return unwrap(res);
}

export async function fulfillSalesOrder(id: string, payload: { lines: FulfillLine[] }) {
  const res = await apiClient.post(`/sales/so/${encodeURIComponent(id)}:fulfill`, payload);
  return unwrap(res);
}

export async function cancelSalesOrder(id: string) {
  const res = await apiClient.post(`/sales/so/${encodeURIComponent(id)}:cancel`, {});
  return unwrap(res);
}

export async function closeSalesOrder(id: string) {
  const res = await apiClient.post(`/sales/so/${encodeURIComponent(id)}:close`, {});
  return unwrap(res);
}
