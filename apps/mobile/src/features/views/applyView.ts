import type { View as ApiView } from "./hooks";

export type SavedView = ApiView & { id?: string; name?: string };

export type AppliedState = {
  q?: string;
  filter?: Record<string, any>;
  sort?: { by?: string; dir?: "asc" | "desc" };
};

/**
 * ROUND-TRIP MAPPING GUARANTEE:
 * buildViewFromState(entityType, mapViewToMobileState(entityType, view).applied)
 * should produce filters/sort that, when re-applied via mapViewToMobileState,
 * yield the same AppliedState (for fields supported by mapViewToMobileState).
 *
 * See: apps/mobile/src/features/views/buildViewFromState.ts (inverse mapper)
 */

function logUnsupported(entityType: string, unsupported: Array<{ field: string; reason: string }>) {
  if (__DEV__ && unsupported.length > 0) {
    console.warn(
      `[views] Unsupported filters for ${entityType}: ${unsupported
        .map((u) => `${u.field} (${u.reason})`)
        .join(", ")}`
    );
  }
}

function mapGenericSort(view: SavedView, allowedFields: string[]): AppliedState["sort"] | undefined {
  const field = view.sort?.field;
  if (!field) return undefined;
  if (!allowedFields.includes(field)) return undefined;
  return { by: field, dir: view.sort?.dir ?? "desc" };
}

export function mapViewToMobileState(entityType: string, view: SavedView) {
  const applied: AppliedState = {};
  const unsupported: Array<{ field: string; reason: string }> = [];

  const addFilter = (field: string, value: any) => {
    if (value === undefined || value === null || value === "") return;
    applied.filter = { ...(applied.filter ?? {}), [field]: value };
  };

  const handleSearch = (value: any) => {
    applied.q = typeof value === "string" ? value : String(value ?? "");
  };

  view.filters?.forEach((f) => {
    const field = f?.field;
    const op = f?.op;
    const value = (f as any)?.value;

    switch (entityType) {
      case "salesOrder": {
        if (field === "q" || field === "search") {
          if (!op || op === "contains" || op === "startsWith") handleSearch(value);
          else unsupported.push({ field, reason: `op ${op} not supported` });
        } else if (field === "status") {
          if (!op || op === "eq") addFilter("status", value);
          else unsupported.push({ field, reason: `op ${op} not supported` });
        } else if (field) {
          unsupported.push({ field, reason: "field not mapped" });
        }
        break;
      }
      case "purchaseOrder": {
        if (field === "q" || field === "search") {
          if (!op || op === "contains" || op === "startsWith") handleSearch(value);
          else unsupported.push({ field, reason: `op ${op} not supported` });
        } else if (field === "status") {
          if (!op || op === "eq") addFilter("status", value);
          else unsupported.push({ field, reason: `op ${op} not supported` });
        } else if (field === "vendorId") {
          if (!op || op === "eq" || op === "contains") addFilter("vendorId", value);
          else unsupported.push({ field, reason: `op ${op} not supported` });
        } else if (field) {
          unsupported.push({ field, reason: "field not mapped" });
        }
        break;
      }
      case "inventoryItem": {
        if (field === "q" || field === "search") {
          if (!op || op === "contains" || op === "startsWith") handleSearch(value);
          else unsupported.push({ field, reason: `op ${op} not supported` });
        } else if (field === "productId") {
          if (!op || op === "eq" || op === "contains") addFilter("productId", value);
          else unsupported.push({ field, reason: `op ${op} not supported` });
        } else if (field) {
          unsupported.push({ field, reason: "field not mapped" });
        }
        break;
      }
      case "party": {
        if (field === "q" || field === "search") {
          if (!op || op === "contains" || op === "startsWith") handleSearch(value);
          else unsupported.push({ field, reason: `op ${op} not supported` });
        } else if (field === "role") {
          if (!op || op === "eq" || op === "contains") addFilter("role", value);
          else unsupported.push({ field, reason: `op ${op} not supported` });
        } else if (field) {
          unsupported.push({ field, reason: "field not mapped" });
        }
        break;
      }
      case "product": {
        if (field === "q" || field === "search" || field === "name" || field === "sku") {
          if (!op || op === "contains" || op === "startsWith" || op === "eq") handleSearch(value);
          else unsupported.push({ field, reason: `op ${op} not supported` });
        } else if (field) {
          unsupported.push({ field, reason: "field not mapped" });
        }
        break;
      }
      default: {
        if (field) unsupported.push({ field, reason: "entity not mapped" });
        break;
      }
    }
  });

  // Sort mapping (best-effort; only allow known fields per entity)
  switch (entityType) {
    case "salesOrder":
    case "purchaseOrder":
      applied.sort = mapGenericSort(view, ["createdAt", "updatedAt"]);
      break;
    case "inventoryItem":
    case "product":
    case "party":
      applied.sort = mapGenericSort(view, ["createdAt", "updatedAt"]);
      break;
    default:
      break;
  }

  logUnsupported(entityType, unsupported);
  return { applied, unsupported };
}
