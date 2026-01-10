const apiBase = import.meta.env.VITE_API_BASE;

if (!apiBase) {
  throw new Error("Missing VITE_API_BASE. Set it in your environment (.env). No localhost fallback is allowed.");
}

/**
 * Get effective tenantId for API calls:
 * - Prefer explicit tenantId from options (from AuthProvider context)
 * - Fallback to VITE_MBAPP_PUBLIC_TENANT_ID for public pages
 * - Throw clear error if neither is available
 */
function getEffectiveTenantId(explicitTenantId?: string): string {
  if (explicitTenantId && explicitTenantId.trim().length > 0) {
    return explicitTenantId;
  }

  const publicTenantId = import.meta.env.VITE_MBAPP_PUBLIC_TENANT_ID as string | undefined;
  if (publicTenantId && publicTenantId.trim().length > 0) {
    return publicTenantId;
  }

  throw new Error(
    "Public tenantId missing. Set VITE_MBAPP_PUBLIC_TENANT_ID in apps/web/.env.local " +
    "(e.g., VITE_MBAPP_PUBLIC_TENANT_ID=SmokeTenant)"
  );
}

/**
 * Build feature headers from Vite env vars (dev/nonprod only).
 * Returns an object with X-Feature-* headers if the corresponding env vars are set to "true".
 * This allows local dev to enable feature flags without modifying code.
 */
function getFeatureHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};

  const registrationsEnabled = import.meta.env.VITE_MBAPP_FEATURE_REGISTRATIONS_ENABLED as string | undefined;
  if (registrationsEnabled === "true") {
    headers["X-Feature-Registrations-Enabled"] = "true";
  }

  const notifySimulate = import.meta.env.VITE_MBAPP_FEATURE_NOTIFY_SIMULATE as string | undefined;
  if (notifySimulate === "true") {
    headers["X-Feature-Notify-Simulate"] = "true";
  }

  return headers;
}

export type ApiFetchOptions = {
  method?: string;
  body?: any;
  headers?: Record<string, string>;
  token?: string;
  tenantId?: string;
  query?: Record<string, string | number | boolean | undefined | null>;
};

/**
 * Stricter variant of ApiFetchOptions that requires both token and tenantId.
 * Use apiFetchAuthed() to enforce Authorization + tenant isolation on protected endpoints.
 */
export type ApiFetchAuthedOptions = Omit<ApiFetchOptions, "token" | "tenantId"> & {
  token: string;
  tenantId: string;
};

type ApiError = Error & { status?: number; code?: string; details?: unknown };

export async function apiFetch<T>(path: string, opts: ApiFetchOptions = {}): Promise<T> {
  const { method = "GET", body, headers, token, tenantId, query } = opts;

  // Get effective tenantId: prefer explicit, fallback to public env
  const effectiveTenantId = getEffectiveTenantId(tenantId);

  const search = new URLSearchParams();
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      search.set(key, String(value));
    }
  }

  const url = `${apiBase.replace(/\/$/, "")}${path}${search.toString() ? `?${search.toString()}` : ""}`;
  const hasBody = body !== undefined && body !== null && method.toUpperCase() !== "GET";

  // Merge feature headers (from env) + caller headers (caller wins)
  const featureHeaders = getFeatureHeaders();

  const init: RequestInit = {
    method,
    headers: {
      ...(hasBody ? { "content-type": "application/json" } : {}),
      "x-tenant-id": effectiveTenantId,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...featureHeaders,
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

  // Error response: extract details for diagnostics (without logging tokens)
  const err: ApiError = new Error("API request failed");
  err.status = res.status;
  (err as any).method = method;
  (err as any).path = path;

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
    // Limit body snippet to 200 chars to avoid huge error messages
    const snippet = text.length > 200 ? text.slice(0, 200) + "..." : text;
    err.message = `${res.status} ${snippet || res.statusText}`;
  } catch {
    err.message = `${res.status} ${res.statusText}`;
  }
  throw err;
}

/**
 * Guarded variant of apiFetch that requires BOTH token and tenantId to be non-empty strings.
 * Use this for endpoints that require Authorization headers and proper tenant isolation.
 * Throws a clear error if either is missing, preventing silent failures or fallbacks to default tenant.
 *
 * @param path - API path
 * @param opts - Must include token and tenantId (both required, non-empty)
 * @returns Promise<T>
 * @throws If token or tenantId is missing, empty, or not a string
 */
export async function apiFetchAuthed<T>(path: string, opts: ApiFetchAuthedOptions): Promise<T> {
  const tokenValid = opts?.token && opts.token.trim().length > 0;
  const tenantValid = opts?.tenantId && opts.tenantId.trim().length > 0;

  if (!tokenValid || !tenantValid) {
    throw new Error(
      `apiFetchAuthed: token and tenantId are required and must be non-empty. ` +
      `token=${!!tokenValid}, tenantId=${!!tenantValid}`
    );
  }

  // Call apiFetch with validated auth
  return apiFetch<T>(path, {
    ...opts,
    token: opts.token,
    tenantId: opts.tenantId,
  });
}

