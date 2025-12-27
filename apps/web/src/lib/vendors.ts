// apps/web/src/lib/vendors.ts
// Minimal vendor list helper using apiFetch

import { apiFetch } from "./http";

export type Vendor = {
  id?: string | number;
  name?: string;
  label?: string;
  displayName?: string;
  roles?: string[];
  [key: string]: unknown;
};

export type VendorListResponse = {
  items?: Vendor[];
  next?: string;
};

/**
 * List vendors (parties with vendor role) with optional pagination.
 * Endpoint: POST /objects/party/search
 * Client-side filters parties to only those with vendor role
 */
export async function listVendors(
  args: { limit?: number; next?: string } = {},
  opts: { token?: string; tenantId: string }
): Promise<VendorListResponse> {
  const { limit = 200, next } = args;
  const response = await apiFetch<any>("/objects/party/search", {
    token: opts.token,
    tenantId: opts.tenantId,
    method: "POST",
    body: {
      limit,
      next,
    },
  });

  // Filter to only vendors on the client side
  const vendors = (response.items ?? []).filter((party: any) =>
    Array.isArray(party.roles) && party.roles.includes("vendor")
  );

  return {
    items: vendors,
    next: response.next,
  };
}
