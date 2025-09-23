// apps/mobile/src/features/inventory/hooks.ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listInventory, getInventoryItem, upsertInventoryItem } from "./api";
import type { InventoryItem, Page } from "./types";

const keys = {
  list: (limit?: number, next?: string, q?: string) => ["inventory", "list", limit ?? 20, next ?? "", q ?? ""] as const,
  byId: (id?: string) => ["inventory", "byId", id ?? ""] as const,
};

export const Inventory = {
  useList(o?: { limit?: number; next?: string | null; q?: string }) {
    return useQuery({
      queryKey: keys.list(o?.limit, o?.next ?? undefined, o?.q),
      queryFn: () => listInventory(o) as Promise<Page<InventoryItem>>,
      placeholderData: (p) => p,
    });
  },
  useGet(id?: string) {
    return useQuery({ enabled: !!id, queryKey: keys.byId(id), queryFn: () => getInventoryItem(id!) });
  },
  useSave() {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: (b: Partial<InventoryItem>) => upsertInventoryItem(b),
      onSuccess: (saved) => {
        qc.setQueryData(keys.byId(saved.id), saved);
        qc.invalidateQueries({ queryKey: ["inventory"] });
      },
    });
  },
};
