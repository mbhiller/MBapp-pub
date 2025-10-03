// Use generated OpenAPI types to stay in lockstep with the spec
import type { components } from "../../api/generated-types";
type Schemas = components["schemas"];

/** Strong type from OpenAPI generator */
export type PurchaseOrder = Schemas["PurchaseOrder"];

/** Keep Page shape consistent with your other modules (e.g., Products) */
export type Page<T> = { items: T[]; next?: string | null; limit?: number };

/** Convenience: status values if you want pills in UI without hardcoding */
export type PurchaseOrderStatus = Schemas["PurchaseOrder"]["status"];
