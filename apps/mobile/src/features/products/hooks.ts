// apps/mobile/src/features/products/hooks.ts
import {
  useMutation,
  useQuery,
  useQueryClient,
  keepPreviousData,
  type UseQueryResult,
} from "@tanstack/react-query";
import type { Product, Page } from "./types";
import { listProducts, getProduct, createProduct, updateProduct } from "./api";

const keys = {
  list: () => ["products", "list"] as const,
  byId: (id?: string) => ["products", "byId", id] as const,
};

export const Products = {
  useList(opts: { limit?: number } = { limit: 20 }): UseQueryResult<Page<Product>, Error> {
    return useQuery<Page<Product>, Error>({
      queryKey: keys.list(),
      queryFn: () => listProducts({ limit: opts.limit }),
      staleTime: 60_000,
      placeholderData: keepPreviousData, // v5 replacement for keepPreviousData: true
    });
  },

  useGet(id?: string): UseQueryResult<Product | undefined, Error> {
    return useQuery<Product | undefined, Error>({
      queryKey: keys.byId(id),
      queryFn: () => getProduct(id),
      enabled: !!id,
      staleTime: 60_000,
    });
  },

  useCreate() {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: (body: Partial<Product>) => createProduct(body),
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: keys.list() });
      },
    });
  },

  useUpdate(id: string) {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: (patch: Partial<Product>) => updateProduct(id, patch),
      onSuccess: (updated) => {
        qc.invalidateQueries({ queryKey: keys.list() });
        qc.setQueryData(keys.byId(id), updated);
      },
    });
  },
};
