// apps/mobile/src/features/inventory/types.ts
import type { components } from "../../api/generated-types";
type Schemas = components["schemas"];
export type InventoryItem = Schemas["InventoryItem"];
// convenience alias so either name compiles
export type Inventory = Schemas["InventoryItem"];
export type Page<T> = { items: T[]; next?: string | null; limit?: number };
