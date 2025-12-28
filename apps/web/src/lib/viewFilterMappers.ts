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
