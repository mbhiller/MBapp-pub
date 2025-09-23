// apps/mobile/src/features/resources/hooks.ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listResources, getResource, upsertResource } from "./api";
import type { Resource, Page } from "./types";

const keys = {
  list: (limit?: number, next?: string, q?: string) => ["resources", "list", limit ?? 20, next ?? "", q ?? ""] as const,
  byId: (id?: string) => ["resources", "byId", id ?? ""] as const,
};

export const Resources = {
  useList(o?: { limit?: number; next?: string | null; q?: string }) {
    return useQuery({
      queryKey: keys.list(o?.limit, o?.next ?? undefined, o?.q),
      queryFn: () => listResources(o) as Promise<Page<Resource>>,
      placeholderData: (p) => p,
    });
  },
  useGet(id?: string) {
    return useQuery({ enabled: !!id, queryKey: keys.byId(id), queryFn: () => getResource(id!) });
  },
  useSave() {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: (b: Partial<Resource>) => upsertResource(b),
      onSuccess: (saved) => {
        qc.setQueryData(keys.byId(saved.id), saved);
        qc.invalidateQueries({ queryKey: ["resources"] });
      },
    });
  },
};
