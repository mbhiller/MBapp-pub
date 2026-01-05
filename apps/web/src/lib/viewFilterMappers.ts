import { ViewConfig, FilterMapResult } from "../hooks/useViewFilters";

/**
 * Maps a saved View's filters to PurchaseOrdersListPage filter state.
 *
 * Supported fields in Views:
 * - status: eq, ne
 * - vendorId: eq, ne, contains
 *
 * Example View filters:
 * [{ field: "status", op: "eq", value: "approved" }]
 */
export function mapViewToPOFilters(view: ViewConfig): FilterMapResult {
  const applied: Record<string, any> = {};
  const unsupported: Array<{ field: string; reason: string }> = [];

  view.filters?.forEach((filter) => {
    const { field, op, value } = filter;

    // Map supported fields
    if (field === "status") {
      if (op === "eq" || op === "ne") {
        applied.statusFilter = op === "eq" ? value : "";
      } else {
        unsupported.push({ field, reason: `operator '${op}' not supported` });
      }
    } else if (field === "vendorId") {
      if (op === "eq" || op === "contains") {
        applied.vendorFilter = value || "";
      } else {
        unsupported.push({ field, reason: `operator '${op}' not supported` });
      }
    } else {
      unsupported.push({ field, reason: "field not mapped for PO list" });
    }
  });

  // Map sort if present
  if (view.sort?.field) {
    // For now, PO list doesn't expose sort UI control, so we log unsupported
    unsupported.push({ field: view.sort.field, reason: "sort not yet supported in UI" });
  }

  return { applied, unsupported };
}

/**
 * Maps a saved View's filters to SalesOrdersListPage filter state.
 *
 * Supported fields in Views:
 * - status: eq, ne
 * - q (search): contains
 *
 * Example View filters:
 * [{ field: "status", op: "eq", value: "committed" }]
 */
export function mapViewToSOFilters(view: ViewConfig): FilterMapResult {
  const applied: Record<string, any> = {};
  const unsupported: Array<{ field: string; reason: string }> = [];

  view.filters?.forEach((filter) => {
    const { field, op, value } = filter;

    // Map supported fields
    if (field === "status") {
      if (op === "eq" || op === "ne") {
        applied.status = op === "eq" ? value : "all";
      } else {
        unsupported.push({ field, reason: `operator '${op}' not supported` });
      }
    } else if (field === "q" || field === "search") {
      if (op === "contains" || op === "startsWith") {
        applied.q = value || "";
      } else {
        unsupported.push({ field, reason: `operator '${op}' not supported` });
      }
    } else {
      unsupported.push({ field, reason: "field not mapped for SO list" });
    }
  });

  if (view.sort?.field) {
    unsupported.push({ field: view.sort.field, reason: "sort not yet supported in UI" });
  }

  return { applied, unsupported };
}

/**
 * Maps a saved View's filters to ProductsListPage filter state.
 *
 * Supported fields in Views:
 * - q (search): contains, startsWith
 * - name: contains, startsWith (alias for q)
 *
 * Example View filters:
 * [{ field: "q", op: "contains", value: "Widget" }]
 */
export function mapViewToProductFilters(view: ViewConfig): FilterMapResult {
  const applied: Record<string, any> = {};
  const unsupported: Array<{ field: string; reason: string }> = [];

  view.filters?.forEach((filter) => {
    const { field, op, value } = filter;

    // Map supported fields
    if (field === "q" || field === "search" || field === "name") {
      if (op === "contains" || op === "startsWith") {
        applied.q = value || "";
      } else {
        unsupported.push({ field, reason: `operator '${op}' not supported` });
      }
    } else {
      unsupported.push({ field, reason: "field not mapped for product list" });
    }
  });

  if (view.sort?.field) {
    unsupported.push({ field: view.sort.field, reason: "sort not yet supported in UI" });
  }

  return { applied, unsupported };
}

/**
 * Maps a saved View's filters to InventoryListPage filter state.
 *
 * Supported fields in Views:
 * - q/search/name: contains, startsWith -> q
 * - productId: eq -> productId
 */
export function mapViewToInventoryFilters(view: ViewConfig): FilterMapResult {
  const applied: Record<string, any> = {};
  const unsupported: Array<{ field: string; reason: string }> = [];

  view.filters?.forEach((filter) => {
    const { field, op, value } = filter;

    if (field === "q" || field === "search" || field === "name") {
      if (op === "contains" || op === "startsWith" || !op) {
        applied.q = value || "";
      } else {
        unsupported.push({ field, reason: `operator '${op}' not supported` });
      }
    } else if (field === "productId") {
      if (op === "eq" || !op) {
        applied.productId = value || "";
      } else {
        unsupported.push({ field, reason: `operator '${op}' not supported` });
      }
    } else {
      unsupported.push({ field, reason: "field not mapped for inventory list" });
    }
  });

  if (view.sort?.field) {
    unsupported.push({ field: view.sort.field, reason: "sort not supported in UI" });
  }

  return { applied, unsupported };
}

/**
 * Maps a saved View's filters to PartiesListPage filter state.
 *
 * Supported fields in Views:
 * - q/search/name: contains, startsWith -> q
 *
 * Notes:
 * - role is not currently supported on the web party list endpoint; mark as unsupported.
 */
export function mapViewToPartyFilters(view: ViewConfig): FilterMapResult {
  const applied: Record<string, any> = {};
  const unsupported: Array<{ field: string; reason: string }> = [];

  view.filters?.forEach((filter) => {
    const { field, op, value } = filter;

    if (field === "q" || field === "search" || field === "name") {
      if (op === "contains" || op === "startsWith" || !op) {
        applied.q = value || "";
      } else {
        unsupported.push({ field, reason: `operator '${op}' not supported` });
      }
    } else if (field === "role") {
      unsupported.push({ field, reason: "role filter not supported on web party list" });
    } else {
      unsupported.push({ field, reason: "field not mapped for party list" });
    }
  });

  if (view.sort?.field) {
    unsupported.push({ field: view.sort.field, reason: "sort not supported in UI" });
  }

  return { applied, unsupported };
}

/**
 * Maps a saved View's filters to BackordersListPage filter state.
 *
 * Supported fields in Views:
 * - status: eq, ne -> status
 * - soId: eq, contains -> soId
 * - vendorId: eq, contains -> vendorId (via preferredVendorId)
 * - itemId: eq, contains -> itemId
 *
 * Example View filters:
 * [{ field: "status", op: "eq", value: "open" }]
 */
export function mapViewToBackorderFilters(view: ViewConfig): FilterMapResult {
  const applied: Record<string, any> = {};
  const unsupported: Array<{ field: string; reason: string }> = [];

  view.filters?.forEach((filter) => {
    const { field, op, value } = filter;

    if (field === "status") {
      if (op === "eq" || op === "ne") {
        applied.status = op === "eq" ? value : "open";
      } else {
        unsupported.push({ field, reason: `operator '${op}' not supported` });
      }
    } else if (field === "soId") {
      if (op === "eq" || op === "contains") {
        applied.soId = value || "";
      } else {
        unsupported.push({ field, reason: `operator '${op}' not supported` });
      }
    } else if (field === "vendorId" || field === "preferredVendorId") {
      if (op === "eq" || op === "contains") {
        applied.vendorId = value || "";
      } else {
        unsupported.push({ field, reason: `operator '${op}' not supported` });
      }
    } else if (field === "itemId") {
      if (op === "eq" || op === "contains") {
        applied.itemId = value || "";
      } else {
        unsupported.push({ field, reason: `operator '${op}' not supported` });
      }
    } else {
      unsupported.push({ field, reason: "field not mapped for backorder list" });
    }
  });

  if (view.sort?.field) {
    unsupported.push({ field: view.sort.field, reason: "sort not supported in UI" });
  }

  return { applied, unsupported };
}
