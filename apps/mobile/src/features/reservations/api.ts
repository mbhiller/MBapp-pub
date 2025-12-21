// apps/mobile/src/features/reservations/api.ts
import { listObjects, getObject, createObject, updateObject } from "../../api/client";
import type { Reservation, Page } from "./types";

const TYPE = "reservation";

// Helper to make raw GET requests to the API
async function request<T>(path: string): Promise<T> {
  const API_BASE = (
    process.env.MBAPP_API_BASE ??
    process.env.EXPO_PUBLIC_API_BASE ??
    "https://ki8kgivz1f.execute-api.us-east-1.amazonaws.com"
  ).replace(/\/+$/, "");

  const TENANT =
    process.env.MBAPP_TENANT_ID ??
    process.env.EXPO_PUBLIC_TENANT_ID ??
    "DemoTenant";

  const bearerToken = process.env.MBAPP_BEARER as string | undefined;

  const headers: Record<string, string> = {
    "accept": "application/json",
    "content-type": "application/json",
    "X-Tenant-Id": TENANT,
    "x-tenant-id": TENANT,
  };

  if (bearerToken) {
    headers["Authorization"] = `Bearer ${bearerToken}`;
    headers["authorization"] = `Bearer ${bearerToken}`;
  }

  const url = `${API_BASE}${path}`;
  const res = await fetch(url, { method: "GET", headers });

  if (!res.ok) {
    let detail = "";
    try {
      const data = await res.json();
      const code = data?.code ? ` ${data.code}` : "";
      const msg = typeof data?.message === "string" ? data.message : JSON.stringify(data);
      detail = `${code} — ${msg}`;
    } catch {
      const text = await res.text().catch(() => "");
      detail = text;
    }
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${path}${detail ? ` — ${detail}` : ""}`);
  }

  return (await res.json()) as T;
}

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
  return request<{ busy: Reservation[] }>(
    `/resources/${encodeURIComponent(resourceId)}/availability?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
  );
}
