import * as React from "react";
import { apiClient } from "../../api/client";

export type AvailabilityEntry = {
  itemId: string;
  onHand: number;
  reserved: number;
  available: number;
  asOf?: string;
};

function normalize(raw: any): AvailabilityEntry | null {
  if (!raw) return null;
  const itemId = raw?.itemId ?? raw?.id;
  if (!itemId) return null;

  const onHand = Number(raw?.onHand ?? raw?.qtyOnHand ?? 0);
  const reserved = Number(raw?.reserved ?? raw?.qtyReserved ?? 0);
  const availableRaw = raw?.available ?? raw?.qtyAvailable;
  const available = availableRaw != null
    ? Number(availableRaw)
    : (Number.isFinite(onHand) && Number.isFinite(reserved) ? onHand - reserved : 0);
  const asOf = raw?.asOf || raw?.timestamp || raw?.ts;

  return {
    itemId: String(itemId),
    onHand,
    reserved,
    available,
    asOf,
  };
}

export function useSalesOrderAvailability(itemIds?: string[]) {
  const ids = React.useMemo(() => {
    const dedup = new Set<string>();
    for (const id of itemIds ?? []) {
      if (id) dedup.add(String(id));
    }
    return Array.from(dedup);
  }, [Array.isArray(itemIds) ? itemIds.join("|") : ""]);

  const [availabilityMap, setAvailabilityMap] = React.useState<Record<string, AvailabilityEntry>>({});
  const [isLoading, setIsLoading] = React.useState(false);

  const fetchAll = React.useCallback(async () => {
    if (ids.length === 0) {
      setAvailabilityMap({});
      return;
    }
    setIsLoading(true);
    try {
      const res = await apiClient.post<any>("/inventory/onhand:batch", { itemIds: ids });
      const body = (res as any)?.body ?? res;
      const items = Array.isArray(body?.items) ? body.items : [];
      const next: Record<string, AvailabilityEntry> = {};
      for (const raw of items) {
        const parsed = normalize(raw);
        if (parsed) next[parsed.itemId] = parsed;
      }
      setAvailabilityMap(next);
    } catch (err) {
      console.error("Failed to fetch availability batch", err);
    } finally {
      setIsLoading(false);
    }
  }, [ids]);

  React.useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  return { availabilityMap, isLoading, refetch: fetchAll } as const;
}
