import { listObjects, getObject, createObject, updateObject, type ListPage } from "../../api/client";
import type { Registration } from "./types";

export const RegistrationsAPI = {
  list: (opts: { limit?: number; next?: string; eventId?: string; clientId?: string; order?: "asc" | "desc" } = {}) =>
    listObjects<Registration>("registration", opts),
  get: (id: string) => getObject<Registration>("registration", id),
  create: (body: Partial<Registration>) => createObject<Registration>("registration", body),
  update: (id: string, patch: Partial<Registration>) => updateObject<Registration>("registration", id, patch),
};

export type RegistrationsPage = ListPage<Registration>;
