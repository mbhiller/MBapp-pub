/**
 * Inverse of mapViewToMobileState: converts mobile list state back to View filter/sort format.
 *
 * Round-trip guarantee (for mapped fields):
 * buildViewFromState(entityType, mapViewToMobileState(entityType, view).applied) 
 * should produce a view that, when re-applied via mapViewToMobileState, yields the same state.
 *
 * Note: q is stored as a filter field (not a dedicated property) to match server schema expectations.
 */

export type MobileState = {
  q?: string;
  filter?: Record<string, any>;
  sort?: { by?: string; dir?: "asc" | "desc" };
};

export type ViewFiltersAndSort = {
  filters: Array<{ field: string; op: string; value: any }>;
  sort?: { field: string; dir?: "asc" | "desc" };
};

/**
 * Convert mobile list state to View filters/sort.
 * Only includes fields supported by applyView mappings for the given entityType.
 * Normalizes by dropping empty values and validating operator choices.
 */
export function buildViewFromState(
  entityType: string,
  state: MobileState
): ViewFiltersAndSort {
  const filters: Array<{ field: string; op: string; value: any }> = [];
  let sort: ViewFiltersAndSort["sort"] | undefined;

  // Normalize and map state back to View filters
  switch (entityType) {
    case "purchaseOrder": {
      // q -> { field: "q", op: "contains" }
      if (state.q && typeof state.q === "string" && state.q.trim()) {
        filters.push({ field: "q", op: "contains", value: state.q.trim() });
      }

      // filter.status -> { field: "status", op: "eq" }
      if (state.filter?.status) {
        const val = state.filter.status;
        if (typeof val === "string" && val.trim()) {
          filters.push({ field: "status", op: "eq", value: val });
        }
      }

      // filter.vendorId -> { field: "vendorId", op: "eq" }
      if (state.filter?.vendorId) {
        const val = state.filter.vendorId;
        if (typeof val === "string" && val.trim()) {
          filters.push({ field: "vendorId", op: "eq", value: val });
        }
      }

      // Sort: only include if field is one of the allowed ones
      if (state.sort?.by && ["createdAt", "updatedAt"].includes(state.sort.by)) {
        sort = { field: state.sort.by, dir: state.sort.dir ?? "asc" };
      }
      break;
    }

    case "salesOrder": {
      // q -> { field: "q", op: "contains" }
      if (state.q && typeof state.q === "string" && state.q.trim()) {
        filters.push({ field: "q", op: "contains", value: state.q.trim() });
      }

      // filter.status -> { field: "status", op: "eq" }
      if (state.filter?.status) {
        const val = state.filter.status;
        if (typeof val === "string" && val.trim()) {
          filters.push({ field: "status", op: "eq", value: val });
        }
      }

      // Sort: only include if field is one of the allowed ones
      if (state.sort?.by && ["createdAt", "updatedAt"].includes(state.sort.by)) {
        sort = { field: state.sort.by, dir: state.sort.dir ?? "asc" };
      }
      break;
    }

    case "inventoryItem": {
      // q -> { field: "q", op: "contains" }
      if (state.q && typeof state.q === "string" && state.q.trim()) {
        filters.push({ field: "q", op: "contains", value: state.q.trim() });
      }

      // filter.productId -> { field: "productId", op: "eq" }
      if (state.filter?.productId) {
        const val = state.filter.productId;
        if (typeof val === "string" && val.trim()) {
          filters.push({ field: "productId", op: "eq", value: val });
        }
      }

      // Sort: only include if field is one of the allowed ones
      if (state.sort?.by && ["createdAt", "updatedAt"].includes(state.sort.by)) {
        sort = { field: state.sort.by, dir: state.sort.dir ?? "asc" };
      }
      break;
    }

    case "party": {
      // q -> { field: "q", op: "contains" }
      if (state.q && typeof state.q === "string" && state.q.trim()) {
        filters.push({ field: "q", op: "contains", value: state.q.trim() });
      }

      // filter.role -> { field: "role", op: "eq" }
      if (state.filter?.role) {
        const val = state.filter.role;
        if (typeof val === "string" && val.trim()) {
          filters.push({ field: "role", op: "eq", value: val });
        }
      }

      // Sort: only include if field is one of the allowed ones
      if (state.sort?.by && ["createdAt", "updatedAt"].includes(state.sort.by)) {
        sort = { field: state.sort.by, dir: state.sort.dir ?? "asc" };
      }
      break;
    }

    case "product": {
      // q -> { field: "q", op: "contains" }
      if (state.q && typeof state.q === "string" && state.q.trim()) {
        filters.push({ field: "q", op: "contains", value: state.q.trim() });
      }

      // Sort: only include if field is one of the allowed ones
      if (state.sort?.by && ["createdAt", "updatedAt"].includes(state.sort.by)) {
        sort = { field: state.sort.by, dir: state.sort.dir ?? "asc" };
      }
      break;
    }

    default: {
      // Fallback: only include q if provided
      if (state.q && typeof state.q === "string" && state.q.trim()) {
        filters.push({ field: "q", op: "contains", value: state.q.trim() });
      }
      break;
    }
  }

  return { filters, sort };
}
