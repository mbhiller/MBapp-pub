// apps/mobile/src/features/clients/types.ts
import type { components } from "../../api/generated-types";
type Schemas = components["schemas"];
export type Client = Schemas["Client"];
export type Page<T> = { items: T[]; next?: string | null; limit?: number };
