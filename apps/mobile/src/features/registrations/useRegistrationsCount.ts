// apps/mobile/src/features/registrations/useRegistrationsCount.ts
import { useQuery } from "@tanstack/react-query";
import { getRegistrationsCount } from "./api";

export function useRegistrationsCount(eventId?: string) {
  return useQuery({
    queryKey: ["registrations", "count", eventId],
    queryFn: async () => {
      if (!eventId) return 0;
      return getRegistrationsCount(eventId);
    },
    enabled: Boolean(eventId),
    staleTime: 30_000,
  });
}
