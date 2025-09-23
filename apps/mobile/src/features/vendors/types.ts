// apps/mobile/src/features/vendors/types.ts
import type { components } from "../../api/generated-types";
type Schemas = components["schemas"];
export type Vendor = Schemas["Vendor"];
export type Page<T> = { items: T[]; next?: string | null; limit?: number };
