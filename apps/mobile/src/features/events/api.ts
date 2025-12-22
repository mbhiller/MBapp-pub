// apps/mobile/src/features/events/api.ts
import { listObjects, getObject, createObject, updateObject } from "../../api/client";
import type { Event, Page } from "./types";

const TYPE = "event";

function toClientOpts(opts?: { limit?: number; next?: string | null; q?: string }) {
  return {
    by: "updatedAt" as const,
    sort: "desc" as const,
    ...(opts?.limit != null ? { limit: opts.limit } : {}),
    ...(opts?.next ? { next: opts.next } : {}),
    ...(opts?.q ? { q: opts.q } : {}),
  };
}

export function listEvents(opts: { limit?: number; next?: string | null; q?: string } = {}): Promise<Page<Event>> {
  return listObjects<Event>(TYPE, toClientOpts(opts)) as unknown as Promise<Page<Event>>;
}

export function getEvent(id: string): Promise<Event> {
  return getObject<Event>(TYPE, id);
}

export function createEvent(body: Partial<Event>): Promise<Event> {
  // ✅ ensure type is present for the generic /objects router
  return createObject<Event>(TYPE, { ...body, type: TYPE } as Partial<Event>);
}

export function updateEvent(id: string, patch: Partial<Event>): Promise<Event> {
  return updateObject<Event>(TYPE, id, patch);
}
