// apps/mobile/src/features/catalog/useProducts.ts
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, Product, ListPage } from "../../api/client";

/** We use an empty string as the initial pageParam to keep TPageParam strictly `string`. */
const START = "";

export function useProducts(opts: { q?: string; sku?: string; limit?: number } = {}) {
  return useInfiniteQuery({
    queryKey: ["products", { q: opts.q ?? "", sku: opts.sku ?? "" }],
    initialPageParam: START, // string (not undefined) keeps types happy
    queryFn: async ({ pageParam, signal }) => {
      const cursor = pageParam || undefined; // treat "" as undefined for the API
      const page = await api.products.list({
        q: opts.q,
        sku: opts.sku,
        limit: opts.limit ?? 25,
        cursor,
        signal,
      });
      return page;
    },
    getNextPageParam: (last: ListPage<Product>) => last.nextCursor ?? "", // always return string
  });
}

export function useProduct(id?: string) {
  return useQuery({
    queryKey: ["product", id ?? "new"],
    enabled: !!id,
    queryFn: () => api.products.get(id!),
  });
}

export function useCreateProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<Product>) => api.products.create(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["products"] });
    },
  });
}

export function useUpdateProduct(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<Product>) => api.products.update(id, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["product", id] });
      qc.invalidateQueries({ queryKey: ["products"] });
    },
  });
}
