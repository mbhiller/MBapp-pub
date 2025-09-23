// apps/mobile/src/features/resources/api.ts
import { listObjects, getObject, createObject } from "../../api/client";
import type { Resource, Page } from "./types";
const TYPE = "resource";

const toOpts = (o?: { limit?: number; next?: string | null; q?: string }) => ({
  by: "updatedAt" as const, sort: "desc" as const,
  ...(o?.limit != null ? { limit: o.limit } : {}),
  ...(o?.next != null ? { next: o.next ?? "" } : {}),
  ...(o?.q ? { q: o.q } : {}),
});

export const listResources = (o?: { limit?: number; next?: string | null; q?: string }) =>
  listObjects<Resource>(TYPE, toOpts(o)) as unknown as Promise<Page<Resource>>;
export const getResource = (id: string) => getObject<Resource>(TYPE, id);
export const upsertResource = (body: Partial<Resource>) =>
  createObject<Resource>(TYPE, { ...body, type: "resource" });
