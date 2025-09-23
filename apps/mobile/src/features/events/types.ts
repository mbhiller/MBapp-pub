// apps/mobile/src/features/events/types.ts
import type { components } from "../../api/generated-types";
type Schemas = components["schemas"];
export type Event = Schemas["Event"];
export type Page<T> = { items: T[]; next?: string | null; limit?: number };
