// apps/mobile/src/features/salesOrders/hooks.ts
import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listSalesOrders,
  getSalesOrder,
  createSalesOrder,
  updateSalesOrder,
  appendLines,
  resolveEpc,
  postScannerAction,
} from "./api";

export const qkeys = {
  root: ["salesOrders"] as const,
  list: (limit?: number) => [...qkeys.root, "list", limit] as const,
  one: (id: string) => [...qkeys.root, "one", id] as const,
};

export function useSalesOrdersList(limit = 20) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: qkeys.list(limit),
    queryFn: () => listSalesOrders({ limit }),
  });

  const refetchStable = React.useCallback(() => {
    if (!q.isFetching) q.refetch();
  }, [q]);

  return { ...q, refetchStable, items: q.data?.items ?? [], next: q.data?.next, qc };
}

export function useSalesOrder(id?: string) {
  const enabled = Boolean(id);
  const q = useQuery({
    queryKey: id ? qkeys.one(id) : ["noop"],
    enabled,
    queryFn: () => getSalesOrder(id!),
  });
  return q;
}

export function useCreateSalesOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createSalesOrder,
    onSuccess: (so) => {
      qc.invalidateQueries({ queryKey: qkeys.list() as any });
      if (so?.id) qc.setQueryData(qkeys.one(so.id), so);
    },
  });
}

export function useUpdateSalesOrder(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: any) => updateSalesOrder(id, patch),
    onSuccess: (so) => {
      qc.invalidateQueries({ queryKey: qkeys.list() as any });
      qc.setQueryData(qkeys.one(id), so);
    },
  });
}

export function useAppendLine(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (line: { itemId: string; qty: number }) => appendLines(id, [line]),
    onSuccess: (so) => {
      qc.setQueryData(qkeys.one(id), so);
      qc.invalidateQueries({ queryKey: qkeys.list() as any });
    },
  });
}

// Scanner flows for Detail screen
export function useScanToAddLine(soId?: string) {
  const addLine = useAppendLine(soId!);
  return {
    addFromEpc: async (epc: string) => {
      const { itemId } = await resolveEpc(epc);
      return addLine.mutateAsync({ itemId, qty: 1 });
    },
    addLine,
  };
}

export function useScannerAction(
  _soId?: string,   // kept for future compat; ignored for now
  _lineId?: string  // kept for future compat; ignored for now
) {
  return useMutation({
    mutationFn: (args: { epc: string; action: "receive" | "pick" | "count"; sessionId?: string; qty?: number }) =>
      postScannerAction({
        action: args.action,
        epc: args.epc,
        sessionId: args.sessionId,
        // fromLocationId / toLocationId optional here if you add move later
      }),
  });
}
