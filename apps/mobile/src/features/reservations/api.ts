// apps/mobile/src/features/reservations/api.ts
import { listObjects, getObject, createObject } from "../../api/client";
import type { Reservation, Page } from "./types";
const TYPE = "reservation";

const toOpts = (o?: { limit?: number; next?: string | null; q?: string }) => ({
  by: "updatedAt" as const, sort: "desc" as const,
  ...(o?.limit != null ? { limit: o.limit } : {}),
  ...(o?.next != null ? { next: o.next ?? "" } : {}),
  ...(o?.q ? { q: o.q } : {}),
});

export const listReservations = (o?: { limit?: number; next?: string | null; q?: string }) =>
  listObjects<Reservation>(TYPE, toOpts(o)) as unknown as Promise<Page<Reservation>>;
export const getReservation = (id: string) => getObject<Reservation>(TYPE, id);
export const upsertReservation = (body: Partial<Reservation>) =>
  createObject<Reservation>(TYPE, { ...body, type: "reservation" });
