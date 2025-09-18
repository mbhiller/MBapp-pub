import { listObjects, getObject, createObject, updateObject, type ListPage } from "../../api/client";
import type { Event } from "./types";

export const EventsAPI = {
  list: (opts: { limit?: number; next?: string; order?: "asc" | "desc" } = {}) =>
    listObjects<Event>("event", opts),
  get: (id: string) => getObject<Event>("event", id),
  create: (body: Partial<Event>) => createObject<Event>("event", body),
  update: (id: string, patch: Partial<Event>) => updateObject<Event>("event", id, patch),
};

export type EventsPage = ListPage<Event>;
