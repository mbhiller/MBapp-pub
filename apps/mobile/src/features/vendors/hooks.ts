// apps/mobile/src/features/vendors/hooks.ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listVendors, getVendor, upsertVendor } from "./api";
import type { Vendor, Page } from "./types";

const keys = {
  list: (limit?: number, next?: string, q?: string) =>
    ["vendors", "list", limit ?? 20, next ?? "", q ?? ""] as const,
  byId: (id?: string) => ["vendors", "byId", id ?? ""] as const,
};

export const Vendors = {
  useList(opts?: { limit?: number; next?: string | null; q?: string }) {
    return useQuery({
      queryKey: keys.list(opts?.limit, opts?.next ?? undefined, opts?.q),
      queryFn: () => listVendors(opts) as Promise<Page<Vendor>>,
      placeholderData: (prev) => prev,
    });
  },

  useGet(id?: string) {
    return useQuery({
      enabled: !!id,
      queryKey: keys.byId(id),
      queryFn: () => getVendor(id!),
    });
  },

  useSave() {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: (body: Partial<Vendor>) => upsertVendor(body),
      onSuccess: (saved) => {
        qc.setQueryData(keys.byId(saved.id), saved);
        qc.invalidateQueries({ queryKey: ["vendors"] });
      },
    });
  },
};
