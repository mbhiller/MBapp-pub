// apps/web/src/lib/backorders.ts
// Backorder request API helpers using apiFetch for consistent error handling

import { apiFetch } from "./http";

export type BackorderRequest = {
  id: string;
  type: "backorderRequest";
  soId?: string;
  soLineId?: string;
  itemId?: string;
  qty?: number;
  status?: "open" | "ignored" | "converted";
  preferredVendorId?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type BackorderSearchFilter = {
  status?: string;
  soId?: string;
  itemId?: string;
  preferredVendorId?: string;
};

export type BackorderSearchResponse = {
  items?: BackorderRequest[];
  next?: string;
};

/**
 * Search backorder requests with optional filters.
 * Endpoint: POST /objects/backorderRequest/search
 */
export async function searchBackorderRequests(
  filter: BackorderSearchFilter,
  opts: { token?: string; tenantId: string; limit?: number; next?: string }
): Promise<BackorderSearchResponse> {
  const body: any = { ...filter };
  if (opts.limit) body.limit = opts.limit;
  if (opts.next) body.next = opts.next;

  return apiFetch<BackorderSearchResponse>("/objects/backorderRequest/search", {
    method: "POST",
    body,
    token: opts.token,
    tenantId: opts.tenantId,
  });
}

/**
 * Ignore a backorder request (status → "ignored").
 * Endpoint: POST /objects/backorderRequest/{id}:ignore
 */
export async function ignoreBackorderRequest(
  id: string,
  opts: { token?: string; tenantId: string }
): Promise<any> {
  return apiFetch(`/objects/backorderRequest/${encodeURIComponent(id)}:ignore`, {
    method: "POST",
    token: opts.token,
    tenantId: opts.tenantId,
  });
}

/**
 * Convert a backorder request to a PO line (status → "converted").
 * Endpoint: POST /objects/backorderRequest/{id}:convert
 */
export async function convertBackorderRequest(
  id: string,
  opts: { token?: string; tenantId: string }
): Promise<any> {
  return apiFetch(`/objects/backorderRequest/${encodeURIComponent(id)}:convert`, {
    method: "POST",
    token: opts.token,
    tenantId: opts.tenantId,
  });
}
