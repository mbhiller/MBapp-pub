// apps/mobile/src/features/accounts/hooks.ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listAccounts, getAccount, upsertAccount } from "./api";
import type { Account, Page } from "./types";

const keys = {
  list: (limit?: number, next?: string, q?: string) => ["accounts", "list", limit ?? 20, next ?? "", q ?? ""] as const,
  byId: (id?: string) => ["accounts", "byId", id ?? ""] as const,
};

export const Accounts = {
  useList(o?: { limit?: number; next?: string | null; q?: string }) {
    return useQuery({
      queryKey: keys.list(o?.limit, o?.next ?? undefined, o?.q),
      queryFn: () => listAccounts(o) as Promise<Page<Account>>,
      placeholderData: (p) => p,
    });
  },
  useGet(id?: string) {
    return useQuery({ enabled: !!id, queryKey: keys.byId(id), queryFn: () => getAccount(id!) });
  },
  useSave() {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: (b: Partial<Account>) => upsertAccount(b),
      onSuccess: (saved) => {
        qc.setQueryData(keys.byId(saved.id), saved);
        qc.invalidateQueries({ queryKey: ["accounts"] });
      },
    });
  },
};
