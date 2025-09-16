// Events & Registrations API client (canonical /objects routes)

export type ListPage<T> = { items: T[]; next?: string };

export type Event = {
  id: string;
  type: "event";
  name: string;
  startsAt?: string;
  endsAt?: string;
  status?: string;
  tenantId?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type Registration = {
  id: string;
  type: "registration";
  eventId: string;
  accountId?: string;
  status?: string;
  tenantId?: string;
  createdAt?: string;
  updatedAt?: string;
};

const API_BASE = process.env.EXPO_PUBLIC_API_BASE || "";
const TENANT_ID = process.env.EXPO_PUBLIC_TENANT_ID || "DemoTenant";

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(API_BASE + path, {
    method: init.method || "GET",
    headers: {
      "content-type": "application/json",
      "x-tenant-id": TENANT_ID,
      ...(init.headers || {}),
    },
    body: init.body,
  });
  const text = await res.text();
  if (!res.ok) {
    try {
      const j = JSON.parse(text);
      const msg = j?.error || j?.message || text;
      throw new Error(`${res.status} ${res.statusText}: ${msg}`);
    } catch {
      throw new Error(`${res.status} ${res.statusText}: ${text}`);
    }
  }
  try { return JSON.parse(text) as T; } catch { return text as unknown as T; }
}

type ListOpts = {
  limit?: number;
  order?: "asc" | "desc";
  sort?: "asc" | "desc";
  next?: string;
};

// ===== Events =====
export function listEvents(): Promise<ListPage<Event>>;
export function listEvents(next: string): Promise<ListPage<Event>>;
export function listEvents(opts: ListOpts): Promise<ListPage<Event>>;
export async function listEvents(arg?: string | ListOpts): Promise<ListPage<Event>> {
  const p = new URLSearchParams();
  if (typeof arg === "string") {
    p.set("sort", "desc");
    p.set("next", arg);
  } else {
    const opts = arg ?? {};
    const limit = opts.limit;
    const sort = (opts.sort ?? opts.order ?? "desc"); // default newest first
    const next = opts.next;
    if (limit != null) p.set("limit", String(limit));
    if (sort) p.set("sort", sort);
    if (next) p.set("next", next);
  }
  return request<ListPage<Event>>(`/objects/event?${p.toString()}`);
}

export const getEvent = (id: string) =>
  request<Event>(`/objects/event/${encodeURIComponent(id)}`);

export const createEvent = (data: Partial<Event>) =>
  request<Event>(`/objects/event`, { method: "POST", body: JSON.stringify(data) });

export const updateEvent = (id: string, data: Partial<Event>) =>
  request<Event>(`/objects/event/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(data) });

// ===== Registrations =====
type RegListOpts = ListOpts & { eventId?: string };

export function listRegistrations(): Promise<ListPage<Registration>>;
export function listRegistrations(next: string): Promise<ListPage<Registration>>;
export function listRegistrations(opts: RegListOpts): Promise<ListPage<Registration>>;
export async function listRegistrations(arg?: string | RegListOpts): Promise<ListPage<Registration>> {
  const p = new URLSearchParams();
  if (typeof arg === "string") {
    p.set("sort", "desc");
    p.set("next", arg);
  } else {
    const opts = arg ?? {};
    const limit = opts.limit;
    const sort = (opts.sort ?? opts.order ?? "desc");
    const next = opts.next;
    const eventId = opts.eventId;
    if (limit != null) p.set("limit", String(limit));
    if (sort) p.set("sort", sort);
    if (next) p.set("next", next);
    if (eventId) p.set("eventId", eventId);
  }
  return request<ListPage<Registration>>(`/objects/registration?${p.toString()}`);
}

export const listRegistrationsByEvent = (eventId: string, opts: Omit<RegListOpts,"eventId"> = {}) =>
  listRegistrations({ ...opts, eventId });

export const getRegistration = (id: string) =>
  request<Registration>(`/objects/registration/${encodeURIComponent(id)}`);

export const createRegistration = (data: Partial<Registration>) =>
  request<Registration>(`/objects/registration`, { method: "POST", body: JSON.stringify(data) });

export const updateRegistration = (id: string, data: Partial<Registration>) =>
  request<Registration>(`/objects/registration/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(data) });
