// apps/mobile/src/features/resources/types.ts
import type { components } from "../../api/generated-types";
type Schemas = components["schemas"];
export type Resource = Schemas["Resource"];
export type Page<T> = { items: T[]; next?: string | null; limit?: number };
