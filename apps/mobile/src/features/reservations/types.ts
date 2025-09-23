// apps/mobile/src/features/reservations/types.ts
import type { components } from "../../api/generated-types";
type Schemas = components["schemas"];
export type Reservation = Schemas["Reservation"];
export type Page<T> = { items: T[]; next?: string | null; limit?: number };
