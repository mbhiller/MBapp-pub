// apps/mobile/src/features/vendors/api.ts
import { listObjects, getObject, createObject } from "../../api/client";
import type { Vendor, Page } from "./types";

const TYPE = "vendor";

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

export function listVendors(opts?: { limit?: number; next?: string | null; q?: string }): Promise<Page<Vendor>> {
  return listObjects<Vendor>(TYPE, toClientOpts(opts)) as unknown as Promise<Page<Vendor>>;
}

export function getVendor(id: string): Promise<Vendor> {
  return getObject<Vendor>(TYPE, id);
}

export function upsertVendor(body: Partial<Vendor>): Promise<Vendor> {
  return createObject<Vendor>(TYPE, { ...body, type: "vendor" });
}
