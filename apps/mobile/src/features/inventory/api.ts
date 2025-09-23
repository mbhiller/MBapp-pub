// apps/mobile/src/features/inventory/api.ts
import { listObjects, getObject, createObject } from "../../api/client";
import type { InventoryItem, Page } from "./types";
const TYPE = "inventory";

const toOpts = (o?: { limit?: number; next?: string | null; q?: string }) => ({
  by: "updatedAt" as const, sort: "desc" as const,
  ...(o?.limit != null ? { limit: o.limit } : {}),
  ...(o?.next != null ? { next: o.next ?? "" } : {}),
  ...(o?.q ? { q: o.q } : {}),
});

export const listInventory = (o?: { limit?: number; next?: string | null; q?: string }) =>
  listObjects<InventoryItem>(TYPE, toOpts(o)) as unknown as Promise<Page<InventoryItem>>;
export const getInventoryItem = (id: string) => getObject<InventoryItem>(TYPE, id);
export const upsertInventoryItem = (body: Partial<InventoryItem>) =>
  createObject<InventoryItem>(TYPE, { ...body, type: "inventory" });
