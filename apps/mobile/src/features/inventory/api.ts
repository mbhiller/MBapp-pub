import type { InventoryItem, ListPage } from "./types";
// Reuse your existing objects client functions (as used by ScanScreen, etc.)
import {
  listObjects,
  getObject,
  createObject,
  updateObject,
} from "../../api/client";

export async function listInventory(params?: {
  next?: string;
  q?: string;
  kind?: string;
  signal?: AbortSignal;
}): Promise<ListPage<InventoryItem>> {
  return listObjects<InventoryItem>("inventory", params);
}

export async function getInventory(id: string, signal?: AbortSignal): Promise<InventoryItem> {
  return getObject<InventoryItem>("inventory", id, signal);
}

export async function createInventory(input: Partial<InventoryItem>, signal?: AbortSignal): Promise<InventoryItem> {
  const body = { ...input, type: "inventory" };
  return createObject<InventoryItem>("inventory", body, signal);
}

export async function updateInventory(id: string, patch: Partial<InventoryItem>, signal?: AbortSignal): Promise<InventoryItem> {
  const body = { ...patch, type: "inventory" };
  return updateObject<InventoryItem>("inventory", id, body, signal);
}
