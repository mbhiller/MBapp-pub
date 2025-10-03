import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { listSalesOrders, getSalesOrder, saveSalesOrder, deleteSalesOrder } from "./api";
import type { SalesOrder } from "./types";

export const SalesOrders = {
  useList(params?: { limit?: number }) {
    return useQuery({
      queryKey: ["salesOrders", params?.limit],
      queryFn: () => listSalesOrders({ limit: params?.limit ?? 50 }),
    });
  },

  useGet(id?: string) {
    return useQuery({
      queryKey: ["salesOrder", id],
      queryFn: () => getSalesOrder(id as string),
      enabled: !!id,
    });
  },

  useSave() {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: (body: Partial<SalesOrder>) => saveSalesOrder(body),
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ["salesOrders"] });
        qc.invalidateQueries({ queryKey: ["salesOrder"] });
      },
    });
  },

  useDelete() {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: (id: string) => deleteSalesOrder(id),
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ["salesOrders"] });
      },
    });
  },
};
