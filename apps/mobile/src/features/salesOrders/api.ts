import { listObjects, getObject, createObject, updateObject, deleteObject } from "../../api/client";
import type { Page } from "./types";
import type { components } from "../../api/generated-types";
type SalesOrder = components["schemas"]["SalesOrder"];

function toPage<T>(res: any, limit?: number): Page<T> {
  if (Array.isArray(res)) return { items: res as T[], next: null, limit };
  if (res?.items && Array.isArray(res.items)) return { items: res.items as T[], next: res.next ?? null, limit };
  if (res?.data && Array.isArray(res.data)) return { items: res.data as T[], next: res.next ?? null, limit };
  return { items: [], next: null, limit };
}

/** List SOs */
export async function listSalesOrders(opts: {
  limit?: number;
  next?: string;
  sort?: "asc" | "desc";
  q?: string;
} = {}): Promise<Page<SalesOrder>> {
  const res = await listObjects<SalesOrder>("salesOrder", {
    by: "updatedAt",
    sort: opts.sort ?? "desc",
    limit: opts.limit ?? 20,
    next: opts.next,
    q: opts.q,
  });
  return toPage<SalesOrder>(res, opts.limit);
}

/** Get one SO */
export const getSalesOrder = (id: string) => getObject<SalesOrder>("salesOrder", id);

/** Create/Update SO */
export async function saveSalesOrder(input: Partial<SalesOrder>) {
  if (input.id) {
    return updateObject<SalesOrder>("salesOrder", String(input.id), input);
  }
  return createObject<SalesOrder>("salesOrder", { ...input, type: "salesOrder" });
}

/** Optional delete */
export async function deleteSalesOrder(id: string): Promise<{ ok: true }> {
  await deleteObject("salesOrder", id);
  return { ok: true };
}
