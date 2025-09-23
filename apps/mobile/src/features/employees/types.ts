// apps/mobile/src/features/employees/types.ts
import type { components } from "../../api/generated-types";
type Schemas = components["schemas"];
export type Employee = Schemas["Employee"];
export type Page<T> = { items: T[]; next?: string | null; limit?: number };
