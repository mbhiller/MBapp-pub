import type { components } from "../../api/generated-types";

type Schemas = components["schemas"];
export type SalesOrder = Schemas["SalesOrder"];
export type Page<T> = { items: T[]; next?: string | null; limit?: number };
