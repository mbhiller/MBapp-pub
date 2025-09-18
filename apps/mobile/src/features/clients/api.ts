import { listObjects, getObject, createObject, updateObject, type ListPage } from "../../api/client";
import type { Client } from "./types";

export const ClientsAPI = {
  list: (opts: { limit?: number; next?: string; order?: "asc" | "desc" } = {}) =>
    listObjects<Client>("client", opts),
  get: (id: string) => getObject<Client>("client", id),
  create: (body: Partial<Client>) => createObject<Client>("client", body),
  update: (id: string, patch: Partial<Client>) => updateObject<Client>("client", id, patch),
};

export type ClientsPage = ListPage<Client>;
