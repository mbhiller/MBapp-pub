// apps/mobile/src/features/objects/types.ts
import type { components } from "../../api/generated-types";
type Schemas = components["schemas"];
export type Base = Schemas["ObjectBase"];
export type AnyObject =
  | Schemas["Product"]
  | Schemas["Account"]
  | Schemas["InventoryItem"]
  | Schemas["Resource"]
  | Schemas["Event"]
  | Schemas["Registration"]
  | Schemas["Reservation"]
  | Schemas["Employee"];
export type Page<T> = { items: T[]; next?: string | null; limit?: number };
