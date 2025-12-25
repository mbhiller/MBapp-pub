import { apiFetch } from "./http";

export type InventoryMovement = {
  id?: string;
  docType?: string;
  action?: string;
  qty?: number;
  refId?: string;
  poLineId?: string;
  lot?: string;
  locationId?: string;
  createdAt?: string;
  updatedAt?: string;
  [k: string]: any;
};

export type ListInventoryMovementsArgs = {
  itemId: string;
  refId?: string;
  poLineId?: string;
  limit?: number;
  next?: string;
  sort?: "asc" | "desc";
};

export type ListInventoryMovementsPage = {
  itemId: string;
  items?: InventoryMovement[];
  next?: string | null;
  pageInfo?: any;
};

// Preferred usage: provide token/tenantId via opts to satisfy apiFetch requirements
export async function listInventoryMovements(
  args: ListInventoryMovementsArgs,
  opts: { token?: string; tenantId: string }
): Promise<ListInventoryMovementsPage> {
  const { itemId, refId, poLineId, limit = 50, next, sort = "desc" } = args;

  const query: Record<string, string | number | undefined> = {
    limit,
    sort,
    next,
  };
  if (refId) query.refId = refId;
  if (poLineId) query.poLineId = poLineId;

  return apiFetch<ListInventoryMovementsPage>(`/inventory/${encodeURIComponent(itemId)}/movements`, {
    token: opts.token,
    tenantId: opts.tenantId,
    query,
  });
}
