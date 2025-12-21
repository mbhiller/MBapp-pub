// apps/mobile/src/features/reservations/api.ts
import { listObjects, getObject } from "../../api/client";
import type { Reservation, Page } from "./types";

const TYPE = "reservation";

const toOpts = (o?: { limit?: number; next?: string | null; q?: string }) => ({
  by: "updatedAt" as const, sort: "desc" as const,
  ...(o?.limit != null ? { limit: o.limit } : {}),
  ...(o?.next != null ? { next: o.next ?? "" } : {}),
  ...(o?.q ? { q: o.q } : {}),
});

export const listReservations = async (o?: { limit?: number; next?: string | null; q?: string }) => {
  const page = await listObjects<Reservation>(TYPE, toOpts(o));
  return {
    items: page.items,
    next: page.next,
    limit: page.pageInfo?.pageSize,
  } as Page<Reservation>;
};

export const getReservation = (id: string) => getObject<Reservation>(TYPE, id);
