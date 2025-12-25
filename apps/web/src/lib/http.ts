const apiBase = import.meta.env.VITE_API_BASE;

if (!apiBase) {
  throw new Error("Missing VITE_API_BASE. Set it in your environment (.env). No localhost fallback is allowed.");
}

export type ApiFetchOptions = {
  method?: string;
  body?: any;
  headers?: Record<string, string>;
  token?: string;
  tenantId?: string;
  query?: Record<string, string | number | boolean | undefined | null>;
};

type ApiError = Error & { status?: number; code?: string; details?: unknown };

export async function apiFetch<T>(path: string, opts: ApiFetchOptions = {}): Promise<T> {
  const { method = "GET", body, headers, token, tenantId, query } = opts;

  // CRITICAL: Enforce tenantId is always provided to prevent silent defaults
  if (!tenantId) {
    throw new Error("apiFetch: tenantId is required. Ensure AuthProvider context is available.");
  }

  const search = new URLSearchParams();
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      search.set(key, String(value));
    }
  }

  const url = `${apiBase.replace(/\/$/, "")}${path}${search.toString() ? `?${search.toString()}` : ""}`;
  const hasBody = body !== undefined && body !== null && method.toUpperCase() !== "GET";

  const init: RequestInit = {
    method,
    headers: {
      ...(hasBody ? { "content-type": "application/json" } : {}),
      "x-tenant-id": tenantId,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: hasBody ? JSON.stringify(body) : undefined,
  };

  const res = await fetch(url, init);
  const contentType = res.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");

  if (res.ok) {
    return (isJson ? res.json() : Promise.resolve(undefined)) as Promise<T>;
  }

  const err: ApiError = new Error("API request failed");
  err.status = res.status;

  if (isJson) {
    try {
      const payload = await res.json();
      const msg = payload?.message || payload?.error || res.statusText || "Request failed";
      err.message = `${res.status} ${msg}`;
      if (payload?.code) err.code = payload.code;
      err.details = payload;
      throw err;
    } catch (e) {
      if (e instanceof Error) throw e;
    }
  }

  try {
    const text = await res.text();
    err.message = `${res.status} ${text || res.statusText}`;
  } catch {
    err.message = `${res.status} ${res.statusText}`;
  }
  throw err;
}
