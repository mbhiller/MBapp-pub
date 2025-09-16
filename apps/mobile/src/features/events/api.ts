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
  status?: "pending" | "confirmed" | "canceled";
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

  try {
    return JSON.parse(text) as T;
  } catch {
    // In case endpoint returns plain text
    return text as unknown as T;
  }
}

type ListOpts = {
  limit?: number;
  order?: "asc" | "desc";
  sort?: "asc" | "desc";
  next?: string;
};

/* ===================== Events ===================== */
/**
 * Flexible signature — accepts:
 *   - listEvents()
 *   - listEvents("nextToken")
 *   - listEvents({ limit, sort|order, next })
 * Works with calls like: listEvents(reset ? undefined : next)
 */
export async function listEvents(arg?: string | ListOpts): Promise<ListPage<Event>> {
  const p = new URLSearchParams();

  if (typeof arg === "string") {
    p.set("sort", "desc");
    p.set("next", arg);
  } else {
    const opts = arg ?? {};
    const limit = opts.limit;
    const sort = opts.sort ?? opts.order ?? "desc"; // default newest first
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
  request<Event>(`/objects/event/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });

/* ================= Registrations ================== */
type RegListOpts = ListOpts & { eventId?: string };

/**
 * Flexible signature — supports:
 *   - listRegistrations()
 *   - listRegistrations("nextToken")
 *   - listRegistrations({ limit, sort|order, next })
 *   - listRegistrations("eventId", "nextToken")
 *   - listRegistrations("eventId", { limit, sort|order, next })
 * Also works with: listRegistrations(eventId, reset ? undefined : next)
 */
export async function listRegistrations(
  a?: string | RegListOpts,
  b?: string | RegListOpts
): Promise<ListPage<Registration>> {
  let eventId: string | undefined;
  let arg: string | RegListOpts | undefined;

  if (typeof a === "string" && (b === undefined || typeof b === "string" || typeof b === "object")) {
    eventId = a;
    arg = b;
  } else {
    arg = a as any;
  }

  const p = new URLSearchParams();

  if (typeof arg === "string") {
    p.set("sort", "desc");
    p.set("next", arg);
  } else {
    const opts = (arg ?? {}) as RegListOpts;
    const limit = opts.limit;
    const sort = opts.sort ?? opts.order ?? "desc";
    const next = opts.next;

    if (limit != null) p.set("limit", String(limit));
    if (sort) p.set("sort", sort);
    if (next) p.set("next", next);
  }

  if (eventId) p.set("eventId", eventId);

  return request<ListPage<Registration>>(`/objects/registration?${p.toString()}`);
}

export const getRegistration = (id: string) =>
  request<Registration>(`/objects/registration/${encodeURIComponent(id)}`);

/**
 * Flexible signature — supports:
 *   - createRegistration({ ... })
 *   - createRegistration(eventId, { ... })
 */
export async function createRegistration(
  a: string | Partial<Registration>,
  b?: Partial<Registration>
): Promise<Registration> {
  const body = typeof a === "string" ? { ...(b || {}), eventId: a } : a;
  return request<Registration>(`/objects/registration`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export const updateRegistration = (id: string, data: Partial<Registration>) =>
  request<Registration>(`/objects/registration/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
