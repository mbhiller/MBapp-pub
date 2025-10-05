// apps/mobile/src/features/_shared/useObjectsList.ts
import * as React from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { listObjects } from "../../api/client";

type Page<T> = { items: T[]; next?: string | null };

function stableStringify(v: unknown): string {
  if (v == null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o).sort();
  const body = keys
    .map((k: string) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
    .join(",");
  return `{${body}}`;
}

export function useObjectsList<T>(opts: {
  type: string;
  limit?: number;
  q?: string;
  sort?: "asc" | "desc";
  by?: string;
  enabled?: boolean;
  /** Server-side filters to pass through to listObjects */
  filters?: Record<string, unknown>;
  /** Optional client-side filter */
  localFilter?: (item: T) => boolean;
}) {
  const {
    type,
    limit = 20,
    q,
    sort = "desc",
    by = "updatedAt",
    enabled = true,
    filters,
    localFilter,
  } = opts;

  const filtersKey = React.useMemo<string | undefined>(
    () => (filters ? stableStringify(filters) : undefined),
    [filters]
  );

  const query = useInfiniteQuery<Page<T>, Error>({
    queryKey: ["objects", type, "list", { limit, q, sort, by, filters: filtersKey }],
    enabled,
    queryFn: async ({ pageParam }) => {
      const res = await listObjects<T>(type, {
        limit,
        sort,
        by,
        ...(q ? { q } : {}),
        ...(filters ? { ...filters } : {}),
        ...(pageParam ? { next: String(pageParam) } : {}),
      });
      return res as Page<T>;
    },
    initialPageParam: undefined,
    getNextPageParam: (last) => (last?.next ? String(last.next) : undefined),
    staleTime: 15_000,
    gcTime: 300_000,
    refetchOnWindowFocus: false,
  });

  const items = React.useMemo<T[]>(() => {
    const flat = (query.data?.pages ?? []).flatMap((p) => p.items ?? []);
    return localFilter ? flat.filter(localFilter) : flat;
  }, [query.data, localFilter]);

  const refetchStable = React.useCallback(() => {
    if (!query.isFetching) query.refetch();
  }, [query]);

  return {
    ...query,
    items,
    hasNext: !!query.hasNextPage,
    loadMore: () => query.fetchNextPage(),
    refetchStable,
  };
}
