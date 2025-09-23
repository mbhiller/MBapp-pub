// apps/mobile/src/features/clients/api.ts
import { listObjects, getObject, createObject } from "../../api/client";
import type { Client, Page } from "./types";
const TYPE = "client";

const toOpts = (o?: { limit?: number; next?: string | null; q?: string }) => ({
  by: "updatedAt" as const,
  sort: "desc" as const,
  ...(o?.limit != null ? { limit: o.limit } : {}),
  ...(o?.next != null ? { next: o.next ?? "" } : {}),
  ...(o?.q ? { q: o.q } : {}),
});

export const listClients = (o?: { limit?: number; next?: string | null; q?: string }) =>
  listObjects<Client>(TYPE, toOpts(o)) as unknown as Promise<Page<Client>>;

export const getClient = (id: string) => getObject<Client>(TYPE, id);

export const upsertClient = (body: Partial<Client>) =>
  createObject<Client>(TYPE, { ...body, type: "client" });
