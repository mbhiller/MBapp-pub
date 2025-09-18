// apps/mobile/src/features/_shared/objectHooks.ts
import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from "@tanstack/react-query";
import { listObjects, getObject, createObject, updateObject, type ListPage } from "../../api/client";

type Order = "asc" | "desc";
type ListParams = { limit?: number; next?: string; order?: Order } & Record<string, any>;

export function createObjectHooks<T extends { id: string }>(type: string) {
  const key = {
    base: [type] as const,
    list: (params?: Omit<ListParams, "next">) => [...key.base, "list", params ?? {}] as const,
    one: (id: string) => [...key.base, "one", id] as const,
    infinite: (params?: Omit<ListParams, "next">) => [...key.base, "infinite", params ?? {}] as const,
  };

  function useList(params?: Omit<ListParams, "next">) {
    return useQuery({
      queryKey: key.list(params),
      queryFn: () => listObjects<T>(type, params ?? {}),
    });
  }

  function useInfinite(params?: Omit<ListParams, "next">) {
    return useInfiniteQuery<
      ListPage<T>,         // TData
      Error,               // TError
      ListPage<T>,         // TSelectedData
      readonly unknown[],  // TQueryKey
      string | undefined   // TPageParam
    >({
      queryKey: key.infinite(params) as unknown as readonly unknown[],
      initialPageParam: undefined,
      queryFn: ({ pageParam }) =>
        listObjects<T>(type, { ...(params ?? {}), next: pageParam }),
      getNextPageParam: (last) => last?.next,
    });
  }

  function useGet(id?: string) {
    return useQuery({
      queryKey: id ? key.one(id) : key.base,
      queryFn: () => (id ? getObject<T>(type, id) : Promise.resolve(null as unknown as T)),
      enabled: !!id,
    });
  }

  function useCreate() {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: (payload: Partial<T>) => createObject<T>(type, payload),
      onSuccess: (created: T) => {
        qc.invalidateQueries({ queryKey: key.base });
        if (created?.id) qc.setQueryData(key.one(created.id), created);
      },
    });
  }

  function useUpdate(id: string) {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: (patch: Partial<T>) => updateObject<T>(type, id, patch),
      onMutate: async (patch) => {
        await qc.cancelQueries({ queryKey: key.one(id) });
        const prev = qc.getQueryData<T>(key.one(id));
        if (prev) qc.setQueryData<T>(key.one(id), { ...prev, ...patch, id } as T);
        return { prev };
      },
      onError: (_e, _p, ctx) => { if (ctx?.prev) qc.setQueryData(key.one(id), ctx.prev); },
      onSuccess: (updated: T) => {
        qc.invalidateQueries({ queryKey: key.base });
        if (updated?.id) qc.setQueryData(key.one(updated.id), updated);
      },
    });
  }

  return { key, useList, useInfinite, useGet, useCreate, useUpdate };
}
