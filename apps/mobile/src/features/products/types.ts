// apps/mobile/src/features/products/types.ts
import type { components } from "../../api/generated-types";
type Schemas = components["schemas"];
export type Product = Schemas["Product"];
export type Page<T> = { items: T[]; next?: string | null; limit?: number };
