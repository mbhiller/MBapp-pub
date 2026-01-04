// apps/api/src/objects/type-alias.ts
// Helpers for type normalization, alias handling, and casing consistency.

import { getObjectById, listObjects, searchObjects, type GetArgs, type ListArgs } from "./repo";

/**
 * Map of lowercase type strings to their canonical (properly-cased) forms.
 * Includes all core object types used in SK prefixes, routes, and business logic.
 */
const CANONICAL_TYPE_BY_LOWER: Record<string, string> = {
  // Inventory (alias pair)
  "inventory": "inventoryItem",      // legacy alias; canonical form is inventoryItem
  "inventoryitem": "inventoryItem",  // already canonical
  
  // Core modules
  "product": "product",
  "party": "party",
  "parties": "party",                // alias for party
  "salesorder": "salesOrder",
  "sales": "salesOrder",             // permission prefix; resolve to salesOrder
  "purchaseorder": "purchaseOrder",
  "purchase": "purchaseOrder",       // permission prefix; resolve to purchaseOrder
  
  // Inventory-related
  "inventorymovement": "inventoryMovement",
  "movement": "inventoryMovement",   // shorthand
  
  // Backorder handling
  "backorderrequest": "backorderRequest",
  "backorder": "backorderRequest",   // alias for backorderRequest
  
  // UI/structural
  "view": "view",
  "workspace": "workspace",
};

/**
 * Normalize an incoming type parameter to canonical (properly-cased) form.
 * - Null/undefined → undefined
 * - Empty (after trim) → undefined
 * - Known type (case-insensitive) → canonical form from CANONICAL_TYPE_BY_LOWER
 * - Unknown type → preserve trimmed original casing (do NOT lowercase)
 */
export function normalizeTypeParam(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  
  const lower = trimmed.toLowerCase();
  const canonical = CANONICAL_TYPE_BY_LOWER[lower];
  
  // If we have a canonical mapping, return it
  if (canonical) return canonical;
  
  // Otherwise, preserve the original trimmed casing (unknown types should not be lowercased)
  return trimmed;
}

export function expandTypeAliases(type: string): string[] {
  const raw = (type || "").trim();
  if (!raw) return [];
  
  const lower = raw.toLowerCase();
  
  // Alias map: if type is one half of an alias pair, return both (canonical-first where applicable)
  if (lower === "inventory") return ["inventoryItem", "inventory"];    // inventory callers prefer legacy-first per old logic, but return canonical-cased
  if (lower === "inventoryitem") return ["inventoryItem", "inventory"]; // canonical-first for inventoryItem callers

  // Non-aliased types: normalize via normalizeTypeParam, then return as singleton
  const normalized = normalizeTypeParam(raw);
  return normalized ? [normalized] : [];
}

// Lightweight sanity check (no throw in prod; logs warn if regression detected).
function selfCheckNormalizeTypeParam() {
  try {
    // Test known types (lowercase input)
    if (normalizeTypeParam("inventory") !== "inventoryItem") {
      console.warn("[type-normalize] inventory -> inventoryItem mapping failed", {
        got: normalizeTypeParam("inventory"),
      });
    }
    if (normalizeTypeParam("salesorder") !== "salesOrder") {
      console.warn("[type-normalize] salesorder -> salesOrder mapping failed", {
        got: normalizeTypeParam("salesorder"),
      });
    }
    // Test unknown types (preserve casing)
    if (normalizeTypeParam("customType") !== "customType") {
      console.warn("[type-normalize] unknown type casing not preserved", {
        got: normalizeTypeParam("customType"),
      });
    }
    // Test null/undefined
    if (normalizeTypeParam(null) !== undefined || normalizeTypeParam(undefined) !== undefined) {
      console.warn("[type-normalize] null/undefined handling failed");
    }
  } catch {
    // Do not throw in runtime paths; this is a best-effort guard.
  }
}

function selfCheckExpandTypeAliases() {
  try {
    const backorder = expandTypeAliases("backorderRequest");
    if (backorder[0] !== "backorderRequest") {
      console.warn("[type-alias] backorderRequest casing regression", { got: backorder });
    }
    const inv = expandTypeAliases("inventoryitem");
    if (!inv.includes("inventoryItem") || !inv.includes("inventory")) {
      console.warn("[type-alias] inventory alias regression", { got: inv });
    }
  } catch {
    // Do not throw in runtime paths; this is a best-effort guard.
  }
}

selfCheckNormalizeTypeParam();
selfCheckExpandTypeAliases();

type ResolveArgs = Omit<GetArgs, "type"> & { type: string };
export async function resolveObjectByIdWithAliases({ tenantId, type, id, fields }: ResolveArgs) {
  for (const t of expandTypeAliases(type)) {
    const obj = await getObjectById({ tenantId, type: t, id, fields, acceptAliasType: true });
    if (obj) return { typeUsed: t, obj } as const;
  }
  return null;
}

type ListWithAliasesArgs = Omit<ListArgs, "type"> & { type: string };
export async function listObjectsWithAliases(args: ListWithAliasesArgs) {
  const { type, next, limit = 20 } = args;
  const aliases = expandTypeAliases(type);

  // If no aliases, defer to base list behavior.
  if (aliases.length === 1) return await listObjects(args);

  // Minimal union support: only when not paginating (no next token) and small limits.
  if (next) return await listObjects(args);
  const maxUnion = Math.max(50, limit);
  const collected: any[] = [];

  for (const t of aliases) {
    const res = await listObjects({ ...args, type: t, limit: maxUnion });
    if (Array.isArray(res?.items)) collected.push(...res.items);
  }

  // Deterministic ordering: updatedAt desc if present, else id asc.
  collected.sort((a, b) => {
    const aUpdated = (a?.updatedAt as string) || "";
    const bUpdated = (b?.updatedAt as string) || "";
    if (aUpdated && bUpdated && aUpdated !== bUpdated) return aUpdated > bUpdated ? -1 : 1;
    const aId = (a?.id as string) || "";
    const bId = (b?.id as string) || "";
    return aId.localeCompare(bId);
  });

  return {
    items: collected.slice(0, limit),
    next: null, // union paging not supported in minimal helper
    unionApplied: true,
  } as const;
}

type SearchWithAliasesArgs = {
  tenantId?: string;
  type: string;
  q?: string;
  filters?: Record<string, string>;
  next?: string;
  limit?: number;
  fields?: string[];
};

export async function searchObjectsWithAliases(args: SearchWithAliasesArgs) {
  const { type, next, limit = 20 } = args;
  const aliases = expandTypeAliases(type);
  if (aliases.length === 1) return await searchObjects(args);

  // Minimal union: only when not paginating (no next cursor). Suitable for smokes and small lists.
  if (next) return await searchObjects(args);
  const maxUnion = Math.max(50, limit);
  const collected: any[] = [];

  for (const t of aliases) {
    const page = await searchObjects({ ...args, type: t, limit: maxUnion });
    if (Array.isArray(page?.items)) collected.push(...page.items);
  }

  collected.sort((a, b) => {
    const aUpdated = (a?.updatedAt as string) || "";
    const bUpdated = (b?.updatedAt as string) || "";
    if (aUpdated && bUpdated && aUpdated !== bUpdated) return aUpdated > bUpdated ? -1 : 1;
    const aId = (a?.id as string) || "";
    const bId = (b?.id as string) || "";
    return aId.localeCompare(bId);
  });

  return {
    items: collected.slice(0, limit),
    next: null,
    unionApplied: true,
  } as const;
}
