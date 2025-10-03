import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Page } from "./types";
import type { PurchaseOrder } from "./types";
import { listPurchaseOrders, getPurchaseOrder, savePurchaseOrder } from "./api";

const listKey = (opts: any) => ["purchaseOrders", "list", opts] as const;
const getKey = (id?: string) => ["purchaseOrders", "get", id ?? "new"] as const;

function useList(opts: { limit?: number; next?: string; sort?: "asc" | "desc" } = {}) {
  return useQuery<Page<PurchaseOrder>, Error>({
    queryKey: listKey(opts),
    queryFn: () => listPurchaseOrders(opts),
    staleTime: 15_000,
    gcTime: 300_000,
    refetchOnWindowFocus: false,
  });
}

function useGet(id?: string) {
  return useQuery<PurchaseOrder | undefined, Error>({
    queryKey: getKey(id),
    queryFn: () => (id ? getPurchaseOrder(id) : Promise.resolve(undefined)),
    enabled: !!id,
    staleTime: 10_000,
    gcTime: 300_000,
    refetchOnWindowFocus: false,
  });
}

function useSave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<PurchaseOrder>) => savePurchaseOrder(input),
    onSuccess: (po) => {
      qc.invalidateQueries({ queryKey: ["purchaseOrders", "list"] });
      if (po?.id) qc.setQueryData(getKey(po.id), po);
    },
  });
}

export const PurchaseOrders = { useList, useGet, useSave };
