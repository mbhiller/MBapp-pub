import { useInfiniteQuery, InfiniteData, UseInfiniteQueryResult } from "@tanstack/react-query";
import { listProducts, updateProduct, type ListPage, type Product, type UpdateProductPatch } from "./api";

export function useProducts(q?: string) {
  const query = useInfiniteQuery<ListPage, Error, InfiniteData<ListPage>, readonly unknown[], unknown>({
    queryKey: ["products", q ?? ""],
    queryFn: async ({ pageParam }) => {
      const cursor = typeof pageParam === "string" && pageParam.length ? pageParam : undefined;
      return listProducts({ q, limit: 25, cursor });
    },
    initialPageParam: undefined,
    getNextPageParam: (last) => last.nextCursor,
  });

  return query as UseInfiniteQueryResult<InfiniteData<ListPage>, Error>;
}

export function useUpdateProduct(id: string) {
  return {
    mutateAsync: async (patch: UpdateProductPatch) => updateProduct(id, patch),
  };
}

export type { Product, ListPage, UpdateProductPatch };
