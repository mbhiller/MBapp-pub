// apps/mobile/src/features/events/api.ts
import { listObjects, getObject, createObject, updateObject } from "../../api/client";
import type { Event, Page } from "./types";

const TYPE = "event";

function toClientOpts(opts?: { limit?: number; next?: string | null; q?: string }) {
  const out: { limit?: number; next?: string; sort?: "asc" | "desc"; by?: string; q?: string } = {};
  if (opts?.limit != null) out.limit = opts.limit;
  if (opts?.next) out.next = opts.next;            // keep as string; client will pass through
  if (opts?.q) out.q = opts.q;
  out.by = "updatedAt";
  out.sort = "desc";
  return out;
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
