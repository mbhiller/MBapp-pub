// apps/web/src/lib/purchasing.ts
// Purchasing API helpers using apiFetch for consistent error handling

import { apiFetch } from "./http";

export type SuggestPoResponse = {
  draft?: any;
  drafts?: any[];
  skipped?: Array<{ backorderRequestId: string; reason: string }>;
};

export type PurchaseOrderCreateResponse = {
  id?: string;
  ids: string[];
};

export type ReceivePurchaseOrderRequest = {
  lines: Array<{
    lineId: string;
    deltaQty: number;
    lot?: string;
    locationId?: string;
  }>;
};

// Generate a safe idempotency key (uuid v4 if available, else timestamp-random)
function generateIdempotencyKey(prefix = "web-receive"): string {
  const uuid = typeof crypto !== "undefined" && (crypto as any).randomUUID
    ? (crypto as any).randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${uuid}`;
}

/**
 * Call POST /purchasing/suggest-po to generate draft PO(s) from backorder requests.
 * Returns single draft or multiple drafts grouped by vendor.
 */
export async function suggestPo(
  args: { backorderRequestIds: string[]; vendorId?: string },
  opts: { token?: string; tenantId: string }
): Promise<SuggestPoResponse> {
  const { backorderRequestIds, vendorId } = args;
  const body: any = {
    requests: backorderRequestIds.map((id) => ({ backorderRequestId: id })),
  };
  if (vendorId) body.vendorId = vendorId;

  return apiFetch<SuggestPoResponse>("/purchasing/suggest-po", {
    method: "POST",
    body,
    token: opts.token,
    tenantId: opts.tenantId,
  });
}

/**
 * Create persisted PO(s) from suggestion draft(s).
 * Endpoint: POST /objects/purchaseOrder/create-from-suggestion
 */
export async function createPurchaseOrderFromSuggestion(
  payload: { draft?: any; drafts?: any[] },
  opts: { token?: string; tenantId: string }
): Promise<PurchaseOrderCreateResponse> {
  return apiFetch<PurchaseOrderCreateResponse>("/objects/purchaseOrder/create-from-suggestion", {
    method: "POST",
    body: payload,
    token: opts.token,
    tenantId: opts.tenantId,
  });
}

/**
 * Submit a draft PO (draft → submitted).
 * Endpoint: POST /purchasing/po/{id}:submit
 */
export async function submitPurchaseOrder(
  id: string,
  opts: { token?: string; tenantId: string }
): Promise<any> {
  return apiFetch(`/purchasing/po/${encodeURIComponent(id)}:submit`, {
    method: "POST",
    token: opts.token,
    tenantId: opts.tenantId,
  });
}

/**
 * Approve a submitted PO (submitted → approved).
 * Endpoint: POST /purchasing/po/{id}:approve
 */
export async function approvePurchaseOrder(
  id: string,
  opts: { token?: string; tenantId: string }
): Promise<any> {
  return apiFetch(`/purchasing/po/${encodeURIComponent(id)}:approve`, {
    method: "POST",
    token: opts.token,
    tenantId: opts.tenantId,
  });
}

/**
 * Receive inventory for PO lines.
 * Endpoint: POST /purchasing/po/{id}:receive
 * Optionally include Idempotency-Key header.
 */
export async function receivePurchaseOrder(
  id: string,
  req: ReceivePurchaseOrderRequest,
  opts: { token?: string; tenantId: string; idempotencyKey?: string }
): Promise<any> {
  const headers: Record<string, string> = {};
  const idk = opts.idempotencyKey || generateIdempotencyKey();
  headers["Idempotency-Key"] = idk;

  return apiFetch(`/purchasing/po/${encodeURIComponent(id)}:receive`, {
    method: "POST",
    body: req,
    headers,
    token: opts.token,
    tenantId: opts.tenantId,
  });
}

/**
 * Cancel a PO (draft/submitted → cancelled).
 * Endpoint: POST /purchasing/po/{id}:cancel
 */
export async function cancelPurchaseOrder(
  id: string,
  opts: { token?: string; tenantId: string }
): Promise<any> {
  return apiFetch(`/purchasing/po/${encodeURIComponent(id)}:cancel`, {
    method: "POST",
    token: opts.token,
    tenantId: opts.tenantId,
  });
}

/**
 * Close a PO (approved/fulfilled → closed).
 * Endpoint: POST /purchasing/po/{id}:close
 */
export async function closePurchaseOrder(
  id: string,
  opts: { token?: string; tenantId: string }
): Promise<any> {
  return apiFetch(`/purchasing/po/${encodeURIComponent(id)}:close`, {
    method: "POST",
    token: opts.token,
    tenantId: opts.tenantId,
  });
}
