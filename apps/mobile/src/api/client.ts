// apps/mobile/src/api/client.ts
// Central API client for MBapp (mobile). Shared across modules for consistency.

type Qs = Record<string, string | number | boolean | undefined>;

const API_BASE =
  process.env.EXPO_PUBLIC_API_BASE ??
  "https://ki8kgivz1f.execute-api.us-east-1.amazonaws.com";
const TENANT =
  process.env.EXPO_PUBLIC_TENANT_ID ??
  "DemoTenant";

// -----------------------------
// Low-level request helper
// -----------------------------
async function request<T = unknown>(
  path: string,
  opts?: { method?: "GET" | "POST" | "PUT" | "DELETE"; body?: any; qs?: Qs; signal?: AbortSignal }
): Promise<T> {
  const url = new URL(`${API_BASE}${path}`);

  // build query string (skip undefined)
  if (opts?.qs) {
    for (const [k, v] of Object.entries(opts.qs)) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    }
  }

  const res = await fetch(url.toString(), {
    method: opts?.method ?? "GET",
    body: opts?.body != null ? JSON.stringify(opts.body) : undefined,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-tenant-id": TENANT,
    },
    signal: opts?.signal,
  });

  const text = await res.text().catch(() => "");
  if (!res.ok) {
    try {
      const j = text ? JSON.parse(text) : {};
      const msg = j?.message ?? j?.error ?? `HTTP ${res.status}`;
      throw new Error(msg);
    } catch {
      throw new Error(text || `HTTP ${res.status}`);
    }
  }
  return (text ? JSON.parse(text) : undefined) as T;
}

// -----------------------------
// Objects API (generic type bucket)
// Backed by /objects/:type endpoints on the server.
// -----------------------------
export const api = {
  objects: {
    /**
     * List objects of a given type with cursor-based paging.
     * opts:
     *  - cursor -> sent as `next`
     *  - limit
     *  - q
     *  - kind
     */
    async list<T = any>(
      type: string,
      opts?: { cursor?: string; limit?: number; q?: string; kind?: string; signal?: AbortSignal }
    ): Promise<{ items: T[]; next?: string }> {
      const qs: Qs = {};
      if (opts?.cursor) qs.next = opts.cursor;
      if (opts?.limit != null) qs.limit = opts.limit;
      if (opts?.q) qs.q = opts.q;
      if (opts?.kind) qs.kind = opts.kind;

      return request<{ items: T[]; next?: string }>(`/objects/${encodeURIComponent(type)}`, {
        method: "GET",
        qs,
        signal: opts?.signal,
      });
    },

    /** Get object by type + id */
    async get<T = any>(type: string, id: string, signal?: AbortSignal): Promise<T> {
      return request<T>(`/objects/${encodeURIComponent(type)}/${encodeURIComponent(id)}`, {
        method: "GET",
        signal,
      });
    },

    /** Create object (server assigns id). Body must include the type for consistency. */
    async create<T = any>(
      type: string,
      body: Record<string, unknown>,
      signal?: AbortSignal
    ): Promise<T> {
      const payload = { ...body, type };
      return request<T>(`/objects/${encodeURIComponent(type)}`, {
        method: "POST",
        body: payload,
        signal,
      });
    },

    /** Update object by id. Body should include type for consistency. */
    async update<T = any>(
      type: string,
      id: string,
      patch: Record<string, unknown>,
      signal?: AbortSignal
    ): Promise<T> {
      const payload = { ...patch, type };
      return request<T>(`/objects/${encodeURIComponent(type)}/${encodeURIComponent(id)}`, {
        method: "PUT",
        body: payload,
        signal,
      });
    },
  },
};

// -----------------------------
// Convenience re-exports (optional)
// If your feature code prefers named helpers, you can import these.
// -----------------------------
export type MbObject = { id: string; type: string; name?: string; sku?: string; [k: string]: any };

export const listObjects = api.objects.list.bind(api.objects) as <T = any>(
  type: string,
  opts?: { cursor?: string; limit?: number; q?: string; kind?: string; order?: "asc" | "desc"; signal?: AbortSignal }
) => Promise<{ items: T[]; next?: string }>;

export const getObject = api.objects.get.bind(api.objects) as <T = any>(
  type: string,
  id: string,
  signal?: AbortSignal
) => Promise<T>;

export const createObject = api.objects.create.bind(api.objects) as <T = any>(
  type: string,
  body: Record<string, unknown>,
  signal?: AbortSignal
) => Promise<T>;

export const updateObject = api.objects.update.bind(api.objects) as <T = any>(
  type: string,
  id: string,
  patch: Record<string, unknown>,
  signal?: AbortSignal
) => Promise<T>;

// Also export request in case a feature needs a one-off call (avoid if possible).
export { request };
