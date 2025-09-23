// apps/mobile/src/features/registrations/types.ts
import type { components } from "../../api/generated-types";
type Schemas = components["schemas"];
export type Registration = Schemas["Registration"];
export type Page<T> = { items: T[]; next?: string | null; limit?: number };
