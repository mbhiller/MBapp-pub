import { listObjects, getObject, createObject, updateObject, deleteObject } from "../../api/client";
import type { Page } from "./types";
import type { components } from "../../api/generated-types";
type PurchaseOrder = components["schemas"]["PurchaseOrder"];

/** Normalize any server page shape into Page<T> */
function toPage<T>(res: any, limit?: number): Page<T> {
  if (Array.isArray(res)) return { items: res as T[], next: null, limit };
  if (res?.items && Array.isArray(res.items)) return { items: res.items as T[], next: res.next ?? null, limit };
  if (res?.data && Array.isArray(res.data)) return { items: res.data as T[], next: res.next ?? null, limit };
  return { items: [], next: null, limit };
}

/** List POs (sorted newest first) */
export async function listPurchaseOrders(opts: {
  limit?: number;
  next?: string;
  sort?: "asc" | "desc";
  q?: string;
} = {}): Promise<Page<PurchaseOrder>> {
  const res = await listObjects<PurchaseOrder>("purchaseOrder", {
    by: "updatedAt",
    sort: opts.sort ?? "desc",
    limit: opts.limit ?? 20,
    next: opts.next,
    q: opts.q,
  });
  return toPage<PurchaseOrder>(res, opts.limit);
}

/** Get one PO */
export const getPurchaseOrder = (id: string) => getObject<PurchaseOrder>("purchaseOrder", id);

/** Create/Update PO (idempotency supported by client via opts.idempotencyKey if you pass it) */
export async function savePurchaseOrder(input: Partial<PurchaseOrder>) {
  if (input.id) {
    return updateObject<PurchaseOrder>("purchaseOrder", String(input.id), input);
  }
  return createObject<PurchaseOrder>("purchaseOrder", { ...input, type: "purchaseOrder" });
}

/** Optional delete */
export async function deletePurchaseOrder(id: string): Promise<{ ok: true }> {
  await deleteObject("purchaseOrder", id);
  return { ok: true };
}
