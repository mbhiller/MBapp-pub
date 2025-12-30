// apps/mobile/src/features/views/hooks.ts
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiClient, type ListPage } from "../../api/client";
import type { components } from "../../api/generated-types"; // openapi-typescript output

// Type from components.schemas (not paths)
export type View = components["schemas"]["View"];

type ListOpts = { entityType?: string; q?: string; limit?: number; nextToken?: string | null };
type ListResult<T> = { items: T[]; nextToken?: string | null; next?: string | null };

type CreateViewPayload = {
  name: string;
  entityType: string;
  filters?: Array<{ field: string; op: string; value: any }>;
  sort?: { field: string; dir?: "asc" | "desc" };
  description?: string;
  shared?: boolean;
};

type PatchViewPayload = Partial<CreateViewPayload>;

function normalizeList<T>(res: ListPage<T> | any): ListResult<T> {
  if (!res) return { items: [], nextToken: null, next: null };
  const items = Array.isArray(res.items) ? res.items : [];
  const nextToken = res.next ?? res.nextToken ?? res.pageInfo?.next ?? res.pageInfo?.nextCursor ?? null;
  return { items, nextToken: nextToken ?? null, next: nextToken ?? null };
}

export function useViewsApi() {
  const list = useCallback(async (opts?: ListOpts): Promise<ListResult<View>> => {
    const params: Record<string, any> = {};
    if (opts?.entityType) params.entityType = opts.entityType;
    if (opts?.q) params.q = opts.q;
    if (opts?.limit) params.limit = opts.limit;
    if (opts?.nextToken) params.nextToken = opts.nextToken;
    const res = await apiClient.getQ<ListPage<View> | any>("/views", params);
    return normalizeList<View>(res);
  }, []);

  const get = useCallback(async (id: string) => {
    return apiClient.get<View>(`/views/${encodeURIComponent(id)}`);
  }, []);

  const create = useCallback(async (payload: CreateViewPayload) => {
    return apiClient.post<View>("/views", payload);
  }, []);

  const patch = useCallback(async (id: string, payload: PatchViewPayload) => {
    try {
      return await apiClient.patch<View>(`/views/${encodeURIComponent(id)}`, payload);
    } catch (err: any) {
      if (err?.status === 405) {
        return apiClient.put<View>(`/views/${encodeURIComponent(id)}`, payload);
      }
      throw err;
    }
  }, []);

  const del = useCallback(async (id: string) => {
    return apiClient.del(`/views/${encodeURIComponent(id)}`);
  }, []);

  return { list, get, create, patch, del };
}

export function useViewsPaged(entityType: string | undefined) {
  const { list } = useViewsApi();
  const [q, setQ] = useState("");
  const [items, setItems] = useState<View[]>([]);
  const [nextToken, setNextToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const loadPage = useCallback(
    async (cursor?: string | null, append = false) => {
      if (!entityType) return;
      const setLoad = append ? setLoadingMore : setLoading;
      setLoad(true);
      try {
        const res = await list({ entityType, q: q.trim() || undefined, limit: 25, nextToken: cursor ?? undefined });
        setItems((prev) => (append ? [...prev, ...res.items] : res.items));
        setNextToken(res.nextToken ?? null);
      } finally {
        setLoad(false);
      }
    },
    [entityType, list, q]
  );

  const refresh = useCallback(() => {
    setItems([]);
    setNextToken(null);
    return loadPage(undefined, false);
  }, [loadPage]);

  const loadMore = useCallback(() => {
    if (!nextToken || loadingMore) return;
    return loadPage(nextToken, true);
  }, [loadPage, loadingMore, nextToken]);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityType, q]);

  return useMemo(
    () => ({ items, q, setQ, loadMore, refresh, loading, loadingMore, nextToken }),
    [items, q, loadMore, refresh, loading, loadingMore, nextToken]
  );
}
