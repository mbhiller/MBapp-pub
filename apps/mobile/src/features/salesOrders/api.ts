// src/features/salesOrders/api.ts
import { apiClient } from "../../api/client";

export type CreateSalesOrderBody = {
  customerName?: string;
  status?: string;
  notes?: string;
  lines?: Array<{ itemId: string; qty: number }>;
};

export async function listSalesOrders(params?: { limit?: number; next?: string }) {
  const qs = new URLSearchParams();
  if (params?.limit) qs.set("limit", String(params.limit));
  if (params?.next) qs.set("next", params.next);
  const path = `/sales/so${qs.toString() ? `?${qs.toString()}` : ""}`;
  return apiClient.get<any>(path);
}

export async function getSalesOrder(id: string) {
  return apiClient.get<any>(`/sales/so/${encodeURIComponent(id)}`);
}

export async function createSalesOrder(body: CreateSalesOrderBody) {
  return apiClient.post<any>("/sales/so", body);
}

export async function updateSalesOrder(id: string, patch: Partial<CreateSalesOrderBody>) {
  return apiClient.put<any>(`/sales/so/${encodeURIComponent(id)}`, patch);
}

export async function appendLines(id: string, lines: Array<{ itemId: string; qty: number }>) {
  const so = await getSalesOrder(id);
  const next = Array.isArray(so?.lines) ? [...so.lines, ...lines] : [...lines];
  return updateSalesOrder(id, { lines: next });
}

// Scanner helpers
export async function resolveEpc(epc: string): Promise<{ itemId: string; status?: string }> {
  const res = await apiClient.get<{ itemId: string; status?: string }>(
    `/epc/resolve?epc=${encodeURIComponent(epc)}`
  );
  if (!res?.itemId) throw new Error(`EPC not found (${epc})`);
  return res;
}

export async function postScannerAction(payload: {
  action: "receive" | "pick" | "count" | "move";
  epc: string;
  sessionId?: string;
  // NOTE: backend does not accept soId/lineId today
  fromLocationId?: string;
  toLocationId?: string;
}) {
  const headers: Record<string, string> = {};
  if (payload.action === "receive") headers["Idempotency-Key"] = `scan-${payload.epc}`;
  return apiClient.post("/scanner/actions", payload, headers);
}
