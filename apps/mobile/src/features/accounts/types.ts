// apps/mobile/src/features/accounts/types.ts
import type { components } from "../../api/generated-types";
type Schemas = components["schemas"];
export type Account = Schemas["Account"];
export type Page<T> = { items: T[]; next?: string | null; limit?: number };
