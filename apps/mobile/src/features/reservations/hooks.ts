// apps/mobile/src/features/reservations/hooks.ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listReservations, getReservation, upsertReservation } from "./api";
import type { Reservation, Page } from "./types";

const keys = {
  list: (limit?: number, next?: string, q?: string) => ["reservations", "list", limit ?? 20, next ?? "", q ?? ""] as const,
  byId: (id?: string) => ["reservations", "byId", id ?? ""] as const,
};

export const Reservations = {
  useList(o?: { limit?: number; next?: string | null; q?: string }) {
    return useQuery({
      queryKey: keys.list(o?.limit, o?.next ?? undefined, o?.q),
      queryFn: () => listReservations(o) as Promise<Page<Reservation>>,
      placeholderData: (p) => p,
    });
  },
  useGet(id?: string) {
    return useQuery({ enabled: !!id, queryKey: keys.byId(id), queryFn: () => getReservation(id!) });
  },
  useSave() {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: (b: Partial<Reservation>) => upsertReservation(b),
      onSuccess: (saved) => {
        qc.setQueryData(keys.byId(saved.id), saved);
        qc.invalidateQueries({ queryKey: ["reservations"] });
      },
    });
  },
};
