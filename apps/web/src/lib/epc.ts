// apps/web/src/lib/epc.ts
// Helper to resolve EPC codes to itemIds using the shared API endpoint.

import { apiFetch } from "./http";

export type EpcResolveResponse = {
  itemId: string;
  status?: string;
};

/**
 * Resolve an EPC code to its itemId via GET /epc/resolve.
 * @param epc The EPC or barcode string to resolve
 * @param opts.token Bearer token (can be null)
 * @param opts.tenantId Tenant ID (required by apiFetch)
 * @throws Error if EPC is empty, not found, or request fails
 */
export async function resolveEpc(
  epc: string,
  opts: { token: string | null; tenantId: string }
): Promise<EpcResolveResponse> {
  const tag = String(epc || "").trim();
  if (!tag) throw new Error("Empty code");

  try {
    const res = await apiFetch<EpcResolveResponse>(
      `/epc/resolve?epc=${encodeURIComponent(tag)}`,
      { token: opts.token ?? undefined, tenantId: opts.tenantId }
    );

    if (!res?.itemId) throw new Error("EPC not found");
    return res;
  } catch (err: any) {
    // apiFetch already throws on non-2xx status, so just re-throw
    if (err?.status === 404 || err?.message === "EPC not found") {
      throw new Error("EPC not found");
    }
    throw err;
  }
}
