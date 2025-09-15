// Lightweight client for Events & Registrations built on fetch.
// Uses EXPO_PUBLIC_API_BASE and EXPO_PUBLIC_TENANT_ID if present.
export type ListPage<T> = { items: T[]; next?: string };

export type Event = {
  id: string; type: "event"; name: string;
  startsAt?: string; endsAt?: string; status?: string;
  tenantId?: string; createdAt?: string; updatedAt?: string;
};

export type Registration = {
  id: string; type: "registration"; eventId: string;
  accountId?: string; status?: "pending"|"confirmed"|"canceled";
  tenantId?: string; createdAt?: string; updatedAt?: string;
};

const API_BASE = (process.env.EXPO_PUBLIC_API_BASE as string) || "https://ki8kgivz1f.execute-api.us-east-1.amazonaws.com";
const TENANT = (process.env.EXPO_PUBLIC_TENANT_ID as string) || "DemoTenant";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-tenant-id": TENANT,
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(txt || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// Events
export async function listEvents(next?: string): Promise<ListPage<Event>> {
  const qs = next ? `?next=${encodeURIComponent(next)}` : "";
  return request<ListPage<Event>>(`/objects/event${qs}`);
}
export async function getEvent(id: string): Promise<Event> {
  return request<Event>(`/objects/event/${encodeURIComponent(id)}`);
}
export async function createEvent(input: Partial<Event>): Promise<Event> {
  return request<Event>(`/objects/event`, { method: "POST", body: JSON.stringify(input) });
}
export async function updateEvent(id: string, input: Partial<Event>): Promise<Event> {
  return request<Event>(`/objects/event/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(input) });
}

// Registrations
export async function listRegistrations(eventId: string, next?: string): Promise<ListPage<Registration>> {
  const p = new URLSearchParams({ eventId });
  if (next) p.set("next", next);
  return request<ListPage<Registration>>(`/objects/registration?${p.toString()}`);
}
export async function createRegistration(eventId: string, input: Partial<Registration>): Promise<Registration> {
  return request<Registration>(`/objects/registration`, {
    method: "POST",
    body: JSON.stringify({ ...input, eventId }),
  });
}
