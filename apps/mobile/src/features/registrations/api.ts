// apps/mobile/src/features/registrations/api.ts
import { listObjects, getObject, createObject } from "../../api/client";
import type { Registration, Page } from "./types";

const TYPE = "registration";

export function listRegistrations(o?: {
  limit?: number; next?: string | null; q?: string; eventId?: string;
}): Promise<Page<Registration>> {
  const base: Record<string, any> = {
    by: "updatedAt",
    sort: "desc",
  };
  if (o?.limit != null) base.limit = o.limit;
  if (o?.next != null) base.next = o.next ?? "";
  if (o?.q) base.q = o.q;

  if (o?.eventId) {
    base.eventId = o.eventId;   // preferred
    base.event = o.eventId;     // alt
    base.event_id = o.eventId;  // alt
  }
  return listObjects<Registration>("registration", base) as unknown as Promise<Page<Registration>>;
}

export const getRegistration = (id: string) => getObject<Registration>(TYPE, id);

export const upsertRegistration = (body: Partial<Registration>) =>
  createObject<Registration>(TYPE, { ...body, type: "registration" });
