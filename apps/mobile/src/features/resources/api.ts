import { listObjects, getObject, createObject, updateObject, type ListPage } from "../../api/client";
import type { Resource } from "./types";

export const ResourcesAPI = {
  list: (opts: { limit?: number; next?: string; order?: "asc" | "desc" } = {}) =>
    listObjects<Resource>("resource", opts),
  get: (id: string) => getObject<Resource>("resource", id),
  create: (body: Partial<Resource>) => createObject<Resource>("resource", body),
  update: (id: string, patch: Partial<Resource>) => updateObject<Resource>("resource", id, patch),
};

export type ResourcesPage = ListPage<Resource>;
