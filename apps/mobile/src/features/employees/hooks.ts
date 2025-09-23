// apps/mobile/src/features/employees/hooks.ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listEmployees, getEmployee, upsertEmployee } from "./api";
import type { Employee, Page } from "./types";

const keys = {
  list: (limit?: number, next?: string, q?: string) =>
    ["employees", "list", limit ?? 20, next ?? "", q ?? ""] as const,
  byId: (id?: string) => ["employees", "byId", id ?? ""] as const,
};

export const Employees = {
  useList(opts?: { limit?: number; next?: string | null; q?: string }) {
    return useQuery({
      queryKey: keys.list(opts?.limit, opts?.next ?? undefined, opts?.q),
      queryFn: () => listEmployees(opts) as Promise<Page<Employee>>,
      placeholderData: (prev) => prev,
    });
  },

  useGet(id?: string) {
    return useQuery({
      enabled: !!id,
      queryKey: keys.byId(id),
      queryFn: () => getEmployee(id!),
    });
  },

  useSave() {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: (body: Partial<Employee>) => upsertEmployee(body),
      onSuccess: (saved) => {
        qc.setQueryData(keys.byId(saved.id), saved);
        qc.invalidateQueries({ queryKey: ["employees"] });
      },
    });
  },
};
