// apps/mobile/src/features/products/hooks.ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listProducts as _list,
  getProduct as _get,
  createProduct as _create,
  updateProduct as _update,
} from "./api";
import type { Product, Page } from "./types";

const keys = {
  list: (limit?: number, next?: string, q?: string) =>
    ["products", "list", limit ?? 20, next ?? "", q ?? ""] as const,
  byId: (id?: string) => ["products", "byId", id ?? ""] as const,
};

export const Products = {
  useList(opts: { limit?: number; next?: string | null; q?: string } = {}) {
    const limit = opts.limit ?? 20;
    const next = opts.next ?? null;
    const q = opts.q ?? "";

    return useQuery<Page<Product>>({
      queryKey: keys.list(limit, next ?? undefined, q),
      queryFn: () => _list({ limit, next, q }),
      // Explicit typing avoids TS7006 implicit-any
      placeholderData: (prev: Page<Product> | undefined) => prev,
    });
  },

  useGet(id?: string) {
    return useQuery<Product | undefined>({
      queryKey: keys.byId(id),
      queryFn: () => (id ? _get(id) : Promise.resolve(undefined)),
      enabled: Boolean(id),
      placeholderData: (prev: Product | undefined) => prev,
    });
  },

  useCreate() {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: (body: Partial<Product>) => _create(body),
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ["products"] });
      },
    });
  },

  useUpdate(id: string) {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: (patch: Partial<Product>) => _update(id, patch),
      onSuccess: (updated) => {
        qc.setQueryData(keys.byId(id), updated);
        qc.invalidateQueries({ queryKey: ["products"] });
      },
    });
  },
};
