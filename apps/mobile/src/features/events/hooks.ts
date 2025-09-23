import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listEvents as _list, getEvent as _get, createEvent as _create, updateEvent as _update } from "./api";
import type { Event, Page } from "./types";

const keys = {
  list: (limit?: number, next?: string, q?: string) => ["events", "list", limit ?? 20, next ?? "", q ?? ""] as const,
  byId: (id?: string) => ["events", "byId", id ?? ""] as const,
};

export const Events = {
  useList(opts: { limit?: number; next?: string | null; q?: string } = {}) {
    const limit = opts.limit ?? 20;
    const next = opts.next ?? null;
    const q = opts.q ?? "";
    return useQuery<Page<Event>>({
      queryKey: keys.list(limit, next ?? undefined, q),
      queryFn: () => _list({ limit, next, q }),
      placeholderData: (prev) => prev, // list can use previous page as skeleton
    });
  },

  useGet(id?: string) {
    return useQuery<Event | undefined>({
      enabled: Boolean(id),
      queryKey: keys.byId(id),
      queryFn: () => (id ? _get(id) : Promise.resolve(undefined)),
      // IMPORTANT: always fetch a fresh copy when we mount the detail screen
      staleTime: 0,
      gcTime: 5 * 60 * 1000,
      refetchOnMount: "always",
      refetchOnReconnect: true,
      refetchOnWindowFocus: true,
      // DO NOT use placeholderData here — we want real server data, not a stale shape
    });
  },

  useCreate() {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: (body: Partial<Event>) => _create(body),
      onSuccess: (created) => {
        qc.invalidateQueries({ queryKey: ["events", "list"] });
        if (created?.id) qc.setQueryData(keys.byId(created.id), created);
      },
    });
  },

  useUpdate(id: string) {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: (patch: Partial<Event>) => _update(id, patch),
      onSuccess: (updated) => {
        if (updated?.id) qc.setQueryData(keys.byId(updated.id), updated);
        qc.invalidateQueries({ queryKey: ["events", "list"] });
      },
    });
  },
};
