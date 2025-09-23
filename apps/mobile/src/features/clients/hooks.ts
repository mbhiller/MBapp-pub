// apps/mobile/src/features/clients/hooks.ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listClients, getClient, upsertClient } from "./api";
import type { Client, Page } from "./types";

const keys = {
  list: (limit?: number, next?: string, q?: string) => ["clients", "list", limit ?? 20, next ?? "", q ?? ""] as const,
  byId: (id?: string) => ["clients", "byId", id ?? ""] as const,
};

export const Clients = {
  useList(o?: { limit?: number; next?: string | null; q?: string }) {
    return useQuery({
      queryKey: keys.list(o?.limit, o?.next ?? undefined, o?.q),
      queryFn: () => listClients(o) as Promise<Page<Client>>,
      placeholderData: (p) => p,
    });
  },
  useGet(id?: string) {
    return useQuery({ enabled: !!id, queryKey: keys.byId(id), queryFn: () => getClient(id!) });
  },
  useSave() {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: (b: Partial<Client>) => upsertClient(b),
      onSuccess: (saved) => {
        qc.setQueryData(keys.byId(saved.id), saved);
        qc.invalidateQueries({ queryKey: ["clients"] });
      },
    });
  },
};
