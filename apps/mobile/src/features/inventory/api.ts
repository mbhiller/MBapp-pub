import { listObjects, getObject, createObject, updateObject, type ListPage } from "../../api/client";
import type { InventoryItem } from "./types";

export const InventoryAPI = {
  list: (opts: { limit?: number; next?: string; order?: "asc" | "desc" } = {}) =>
    listObjects<InventoryItem>("product", { ...opts, kind: "good" }),
  get: (id: string) => getObject<InventoryItem>("product", id),
  create: (body: Partial<InventoryItem>) => createObject<InventoryItem>("product", { kind: "good", ...body }),
  update: (id: string, patch: Partial<InventoryItem>) => updateObject<InventoryItem>("product", id, patch),
};

export type InventoryPage = ListPage<InventoryItem>;
