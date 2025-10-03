import { listObjects, getObject, createObject, updateObject } from "../../api/client";
import type { PurchaseOrder, Page } from "./types";

function toPage<T>(res: any, limit?: number): Page<T> {
  if (Array.isArray(res)) return { items: res as T[], next: null, limit };
  if (res?.items && Array.isArray(res.items)) return { items: res.items as T[], next: res.next ?? null, limit };
  if (res?.data && Array.isArray(res.data)) return { items: res.data as T[],  next: res.next ?? null, limit };
  return { items: [], next: null, limit };
}

/** List */
export async function listPurchaseOrders(opts: {
  limit?: number;
  next?: string;
  sort?: "asc" | "desc";
} = {}): Promise<Page<PurchaseOrder>> {
  const res = await listObjects<PurchaseOrder>("purchaseOrder", opts);
  return toPage<PurchaseOrder>(res, opts.limit);
}

/** Get by id */
export async function getPurchaseOrder(id: string): Promise<PurchaseOrder> {
  return getObject<PurchaseOrder>("purchaseOrder", id);
}

/** Create/Update (matches your module pattern) */
export async function savePurchaseOrder(input: Partial<PurchaseOrder>): Promise<PurchaseOrder> {
  const body: Partial<PurchaseOrder> = {
    ...input,
    type: "purchaseOrder" as any,
  };
  return input.id
    ? updateObject<PurchaseOrder>("purchaseOrder", String(input.id), body)
    : createObject<PurchaseOrder>("purchaseOrder", body);
}
