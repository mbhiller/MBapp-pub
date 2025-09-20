// apps/mobile/src/features/registrations/api.ts
import { apiClient } from "../../api/client";
import type { Registration, Page, CountResponse } from "./types";

export async function listRegistrations(opts: {
  eventId?: string;
  limit?: number;
  next?: string | null;
} = {}): Promise<Page<Registration>> {
  const p = new URLSearchParams();
  if (opts.eventId) p.set("eventId", opts.eventId);
  if (opts.limit != null) p.set("limit", String(opts.limit));
  if (opts.next) p.set("next", opts.next);
  const q = p.toString();
  return apiClient.get<Page<Registration>>(`/objects/registration${q ? `?${q}` : ""}`);
}

export async function getRegistration(id?: string): Promise<Registration | undefined> {
  if (!id) return undefined;
  return apiClient.get<Registration>(`/objects/registration/${encodeURIComponent(id)}`);
}

export async function createRegistration(body: Partial<Registration>): Promise<Registration> {
  if (!body.eventId) throw new Error("eventId is required for a registration.");
  return apiClient.post<Registration>(`/objects/registration`, body);
}

export async function updateRegistration(id: string, patch: Partial<Registration>): Promise<Registration> {
  if (!id) throw new Error("id required");
  return apiClient.put<Registration>(`/objects/registration/${encodeURIComponent(id)}`, patch);
}

export async function getRegistrationsCount(eventId: string): Promise<number> {
  const query = new URLSearchParams({ eventId, count: "1" }).toString();
  const res = await apiClient.get<CountResponse>(`/objects/registration?${query}`);
  return typeof res?.count === "number" ? res.count : 0;
}
