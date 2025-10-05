import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getOrganization, createOrganization, updateOrganization, listOrganizations } from "./api";
import type { Organization } from "./types";

const QK = {
  list: (args: any) => ["objects", "organization", "list", args],
  get:  (id?: string) => ["objects", "organization", "get", id ?? "new"],
};

export function useList(opts: {
  limit?: number; q?: string; sort?: "asc" | "desc"; by?: string; filters?: Record<string, any>;
  enabled?: boolean;
} = {}) {
  const { limit = 20, q, sort = "desc", by = "updatedAt", filters, enabled = true } = opts;
  return useQuery({
    queryKey: QK.list({ limit, q, sort, by, filters }),
    queryFn: () => listOrganizations({ limit, q, sort, by, ...(filters ? { filters } : {}) }),
    enabled,
    staleTime: 15_000,
    gcTime: 300_000,
  });
}

export function useGet(id?: string) {
  return useQuery({
    queryKey: QK.get(id),
    queryFn: () => (id ? getOrganization(id) : Promise.resolve(undefined as unknown as Organization)),
    enabled: Boolean(id),
    staleTime: 10_000,
  });
}

export function useCreate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<Organization>) => createOrganization(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["objects", "organization"] });
    },
  });
}

export function useUpdate(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<Organization>) => updateOrganization(id, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["objects", "organization"] });
      qc.invalidateQueries({ queryKey: ["objects", "organization", "get", id] });
    },
  });
}
