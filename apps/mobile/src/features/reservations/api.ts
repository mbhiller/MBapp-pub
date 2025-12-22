// apps/mobile/src/features/reservations/api.ts
import { listObjects, getObject, createObject, updateObject, apiClient } from "../../api/client";
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

export async function createReservation(body: {
  resourceId: string;
  startsAt: string;
  endsAt: string;
  status?: string;
}): Promise<Reservation> {
  try {
    return await createObject<Reservation>(TYPE, { type: TYPE, ...body } as any);
  } catch (err: any) {
    // Enrich 409 conflicts with structured error
    if (err?.statusCode === 409 || err?.status === 409) {
      const errBody = err?.body || err?.response?.data || err;
      if (errBody?.code === "conflict") {
        const conflicts = errBody?.details?.conflicts ?? errBody?.details?.conflictingIds ?? [];
        const error = new Error(errBody.message || "Reservation conflicts with existing bookings") as any;
        error.code = "conflict";
        error.conflicts = conflicts;
        throw error;
      }
    }
    throw err;
  }
}

export async function updateReservation(
  id: string,
  body: Partial<{
    resourceId: string;
    startsAt: string;
    endsAt: string;
    status: string;
  }>
): Promise<Reservation> {
  try {
    return await updateObject<Reservation>(TYPE, id, body as any);
  } catch (err: any) {
    // Enrich 409 conflicts with structured error
    if (err?.statusCode === 409 || err?.status === 409) {
      const errBody = err?.body || err?.response?.data || err;
      if (errBody?.code === "conflict") {
        const conflicts = errBody?.details?.conflicts ?? errBody?.details?.conflictingIds ?? [];
        const error = new Error(errBody.message || "Reservation conflicts with existing bookings") as any;
        error.code = "conflict";
        error.conflicts = conflicts;
        throw error;
      }
    }
    throw err;
  }
}

export async function getResourceAvailability(
  resourceId: string,
  from: string,
  to: string
): Promise<{ busy: Reservation[] }> {
  const path = `/resources/${encodeURIComponent(resourceId)}/availability?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  return apiClient.get<{ busy: Reservation[] }>(path);
}
