// apps/mobile/src/features/events/actions.ts
import { getObject, updateObject } from "../../api/client";
import type { components } from "../../api/generated-types";

type Event = components["schemas"]["Event"];

// Use your shared helper if you have one; this local keeps types happy
export const newIdempotencyKey = () =>
  `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export async function publishEvent(id: string) {
  const e = (await getObject("event", id)) as Event;
  const nextStatus =
    e.status === "draft" ? "scheduled" : e.status === "scheduled" ? "open" : "open";
  return updateObject(
    "event",
    id,
    { status: nextStatus, publishedAt: new Date().toISOString() } as Partial<Event>,
    { idempotencyKey: newIdempotencyKey() }
  );
}

export async function archiveEvent(id: string) {
  return updateObject(
    "event",
    id,
    { status: "archived" } as Partial<Event>,
    { idempotencyKey: newIdempotencyKey() }
  );
}

export async function cancelEvent(id: string) {
  return updateObject(
    "event",
    id,
    { status: "cancelled" } as Partial<Event>,
    { idempotencyKey: newIdempotencyKey() }
  );
}

export async function updateEventCapacity(id: string, capacity: number | null) {
  return updateObject(
    "event",
    id,
    { capacity } as Partial<Event>,
    { idempotencyKey: newIdempotencyKey() }
  );
}
