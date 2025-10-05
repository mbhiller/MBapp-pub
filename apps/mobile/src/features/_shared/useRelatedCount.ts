import { useQuery } from "@tanstack/react-query";
import { searchObjects } from "../../api/client";

/** Returns a number for items of a type matching a filter (best-effort). */
export function useRelatedCount(
  type: string,
  filter: Record<string, any>,
  opts?: { enabled?: boolean }
) {
  const qk = ["count", type, JSON.stringify(filter)];
  return useQuery<number>({
    enabled: opts?.enabled ?? true,
    queryKey: qk,
    queryFn: async () => {
      // If your API gets a /count later, swap this body and everything improves automatically.
      const res = await searchObjects<any>(type, filter, { limit: 1 });
      // Some backends return { total }, others just items; be tolerant.
      const total = (res as any)?.total;
      if (typeof total === "number") return total;
      const items = Array.isArray((res as any)?.items) ? (res as any).items : [];
      return items.length; // minimal fallback
    },
    staleTime: 10_000,
  });
}
