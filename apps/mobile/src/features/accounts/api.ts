// apps/mobile/src/features/accounts/api.ts
import { listObjects, getObject, createObject } from "../../api/client";
import type { Account, Page } from "./types";
const TYPE = "account";

const toOpts = (o?: { limit?: number; next?: string | null; q?: string }) => ({
  by: "updatedAt" as const, sort: "desc" as const,
  ...(o?.limit != null ? { limit: o.limit } : {}),
  ...(o?.next != null ? { next: o.next ?? "" } : {}),
  ...(o?.q ? { q: o.q } : {}),
});

export const listAccounts = (o?: { limit?: number; next?: string | null; q?: string }) =>
  listObjects<Account>(TYPE, toOpts(o)) as unknown as Promise<Page<Account>>;
export const getAccount = (id: string) => getObject<Account>(TYPE, id);
export const upsertAccount = (body: Partial<Account>) => createObject<Account>(TYPE, { ...body, type: "account" });
