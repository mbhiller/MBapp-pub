// apps/api/src/objects/type-alias.ts
// Helpers for inventory/inventoryItem alias handling. Keeps scope narrow so callers can opt-in per route.

import { getObjectById, listObjects, searchObjects, type GetArgs, type ListArgs } from "./repo";

export function expandTypeAliases(type: string): string[] {
  const raw = (type || "").trim();
  const norm = raw.toLowerCase();

  // Alias map keyed by lowercase route param; values preserve canonical casing and ordering preference.
  if (norm === "inventory") return ["inventory", "inventoryItem"]; // legacy-first for inventory callers
  if (norm === "inventoryitem") return ["inventoryItem", "inventory"]; // canonical-first for inventoryItem callers

  // Non-aliased types must preserve the caller's original casing (e.g., backorderRequest).
  // Provide lowercase fallback second to tolerate legacy lowercased SK prefixes, but keep caller casing first.
  return norm !== raw ? [raw, norm] : [raw];
}

// Lightweight sanity check (no throw in prod; logs warn if regression detected).
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
