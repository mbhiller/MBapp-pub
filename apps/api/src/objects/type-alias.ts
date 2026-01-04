// apps/api/src/objects/type-alias.ts
// Helpers for inventory/inventoryItem alias handling. Keeps scope narrow so callers can opt-in per route.

import { getObjectById, listObjects, searchObjects, type GetArgs, type ListArgs } from "./repo";

export function expandTypeAliases(type: string): string[] {
  const t = (type || "").trim();
  if (t === "inventory") return ["inventory", "inventoryItem"];
  if (t === "inventoryItem") return ["inventoryItem", "inventory"];
  return [t];
}

type ResolveArgs = Omit<GetArgs, "type"> & { type: string };
export async function resolveObjectByIdWithAliases({ tenantId, type, id, fields }: ResolveArgs) {
  for (const t of expandTypeAliases(type)) {
    const obj = await getObjectById({ tenantId, type: t, id, fields });
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
