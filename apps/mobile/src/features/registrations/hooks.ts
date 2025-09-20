// apps/mobile/src/features/registrations/hooks.ts
import {
  useMutation,
  useQuery,
  useQueryClient,
  keepPreviousData,
  type UseQueryResult,
} from "@tanstack/react-query";
import type { Registration, Page } from "./types";
import {
  listRegistrations,
  getRegistration,
  createRegistration,
  updateRegistration,
  getRegistrationsCount,
} from "./api";

const keys = {
  list: (eventId?: string) => ["registrations", "list", { eventId: eventId ?? null }] as const,
  byId: (id?: string) => ["registrations", "byId", id] as const,
  count: (eventId?: string) => ["registrations", "count", eventId ?? ""] as const,
};

export const Registrations = {
  useList(opts: { eventId?: string; limit?: number } = {}): UseQueryResult<Page<Registration>, Error> {
    return useQuery<Page<Registration>, Error>({
      queryKey: keys.list(opts.eventId),
      queryFn: () => listRegistrations({ eventId: opts.eventId, limit: opts.limit ?? 20 }),
      staleTime: 30_000,
      placeholderData: keepPreviousData, // v5 replacement
    });
  },

  useGet(id?: string): UseQueryResult<Registration | undefined, Error> {
    return useQuery<Registration | undefined, Error>({
      queryKey: keys.byId(id),
      queryFn: () => getRegistration(id),
      enabled: !!id,
      staleTime: 60_000,
    });
  },

  useCreate() {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: (body: Partial<Registration>) => createRegistration(body),
      onSuccess: (created) => {
        qc.invalidateQueries({ queryKey: keys.list(created.eventId) });
        if (created.eventId) qc.invalidateQueries({ queryKey: keys.count(created.eventId) });
      },
    });
  },

  useUpdate(id: string) {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: (patch: Partial<Registration>) => updateRegistration(id, patch),
      onSuccess: (updated) => {
        qc.invalidateQueries({ queryKey: keys.list(updated.eventId) });
        if (updated.eventId) qc.invalidateQueries({ queryKey: keys.count(updated.eventId) });
        qc.setQueryData(keys.byId(id), updated);
      },
    });
  },

  useCount(eventId?: string): UseQueryResult<number, Error> {
    return useQuery<number, Error>({
      queryKey: keys.count(eventId),
      queryFn: () => (eventId ? getRegistrationsCount(eventId) : Promise.resolve(0)),
      enabled: !!eventId,
      staleTime: 10_000,
    });
  },
};

// convenience export to match your earlier import style
export function useRegistrationsCount(eventId?: string) {
  return Registrations.useCount(eventId);
}
