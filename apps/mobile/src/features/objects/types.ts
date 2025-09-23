// apps/mobile/src/features/objects/types.ts
import type { components } from "../../api/generated-types";
type Schemas = components["schemas"];
export type Base = Schemas["Base"];
export type AnyObject =
  | Schemas["Product"]
  | Schemas["Client"]
  | Schemas["Account"]
  | Schemas["InventoryItem"]
  | Schemas["Resource"]
  | Schemas["Event"]
  | Schemas["Registration"]
  | Schemas["Reservation"]
  | Schemas["Vendor"]
  | Schemas["Employee"];
export type Page<T> = { items: T[]; next?: string | null; limit?: number };
