// apps/mobile/src/features/registrations/hooks.ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listRegistrations, getRegistration, upsertRegistration } from "./api";
import type { Registration, Page } from "./types";

const keys = {
  list: (limit?: number, next?: string, q?: string, eventId?: string) =>
    ["registrations", "list", limit ?? 20, next ?? "", q ?? "", eventId ?? ""] as const,
  byId: (id?: string) => ["registrations", "byId", id ?? ""] as const,
};

export const Registrations = {
  useList(o?: { limit?: number; next?: string | null; q?: string; eventId?: string }) {
    return useQuery({
      queryKey: keys.list(o?.limit, o?.next ?? undefined, o?.q, o?.eventId),
      queryFn: () => listRegistrations(o) as Promise<Page<Registration>>,
      placeholderData: (p) => p,
    });
  },
  useGet(id?: string) {
    return useQuery({ enabled: !!id, queryKey: keys.byId(id), queryFn: () => getRegistration(id!) });
  },
  useSave() {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: (b: Partial<Registration>) => upsertRegistration(b),
      onSuccess: (saved) => {
        qc.setQueryData(keys.byId(saved.id), saved);
        qc.invalidateQueries({ queryKey: ["registrations"] });
      },
    });
  },
};
