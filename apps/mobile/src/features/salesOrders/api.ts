// apps/mobile/src/features/salesOrders/api.ts
import { listObjects, getObject, createObject, updateObject, deleteObject } from "../../api/client";
import type { Page } from "./types";
import type { components } from "../../api/generated-types";

type Schemas = components["schemas"];
type SalesOrder = Schemas["SalesOrder"];

export async function listSalesOrders(opts: { limit?: number; next?: string; sort?: "asc" | "desc" } = {}): Promise<Page<SalesOrder>> {
  const res = await listObjects<SalesOrder>("salesOrder", opts);
  return { items: res.items, next: res.next ?? null, limit: (opts.limit ?? undefined) as any };
}

export async function getSalesOrder(id: string): Promise<SalesOrder> {
  return getObject<SalesOrder>("salesOrder", id);
}

export async function saveSalesOrder(input: Partial<SalesOrder>): Promise<SalesOrder> {
  if (input.id) {
    return updateObject<SalesOrder>("salesOrder", String(input.id), input);
  }
  return createObject<SalesOrder>("salesOrder", { ...input, type: "salesOrder" });
}

export async function deleteSalesOrder(id: string): Promise<{ ok: true }> {
  await deleteObject("salesOrder", id);
  return { ok: true };
}
