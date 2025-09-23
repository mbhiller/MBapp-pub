// apps/mobile/src/features/employees/api.ts
import { listObjects, getObject, createObject } from "../../api/client";
import type { Employee, Page } from "./types";

const TYPE = "employee";

function toClientOpts(opts?: { limit?: number; next?: string | null; q?: string }) {
  const out: { limit?: number; next?: string; q?: string; sort: "asc" | "desc"; by: "updatedAt" } = {
    sort: "desc",
    by: "updatedAt",
  } as any;
  if (opts?.limit != null) out.limit = opts.limit;
  if (opts?.next || opts?.next === "") out.next = opts?.next ?? "";
  if (opts?.q) out.q = opts.q;
  return out;
}

export function listEmployees(opts?: { limit?: number; next?: string | null; q?: string }): Promise<Page<Employee>> {
  return listObjects<Employee>(TYPE, toClientOpts(opts)) as unknown as Promise<Page<Employee>>;
}

export function getEmployee(id: string): Promise<Employee> {
  return getObject<Employee>(TYPE, id);
}

export function upsertEmployee(body: Partial<Employee>): Promise<Employee> {
  return createObject<Employee>(TYPE, { ...body, type: "employee" });
}
