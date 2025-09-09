// apps/mobile/src/api/client.ts
import axios, { AxiosError } from "axios";

// ---- config (Expo: EXPO_PUBLIC_* are available at runtime) ----
export const API_BASE =
  (process.env.EXPO_PUBLIC_API_BASE as string) ||
  (process.env.API_BASE as string) ||
  "https://ki8kgivz1f.execute-api.us-east-1.amazonaws.com";

export const TENANT =
  (process.env.EXPO_PUBLIC_TENANT_ID as string) ||
  (process.env.TENANT as string) ||
  "DemoTenant";

// Single axios instance sends tenant header on every call
export const api = axios.create({
  baseURL: API_BASE,
  timeout: 10_000,
  headers: { "content-type": "application/json", "x-tenant-id": TENANT },
});

// --- Axios interceptors: normalized errors + correlation id ---
api.interceptors.response.use(
  (response) => {
    const reqId = response.headers?.["x-request-id"];
    if (typeof __DEV__ !== "undefined" && __DEV__ && reqId) {
      console.log(
        `[API] ${response.config.method?.toUpperCase()} ${response.config.url} -> ${response.status} (${reqId})`
      );
    }
    return response;
  },
  (error) => {
    const status = (error as AxiosError)?.response?.status;
    const data = (error as AxiosError)?.response?.data as any;
    const reqId = (error as AxiosError)?.response?.headers?.["x-request-id"];
    const message =
      (data && (data.message || data.error)) ||
      (error as any)?.message ||
      "Request failed";
    if (typeof __DEV__ !== "undefined" && __DEV__) {
      console.warn(
        `[API] ${error.config?.method?.toUpperCase()} ${error.config?.url} -> ${status} (${reqId || "-"})`,
        data || message
      );
    }
    const err = new Error(message);
    (err as any).status = status;
    (err as any).requestId = reqId;
    return Promise.reject(err);
  }
);

// ---- helpers ----
const unwrap = (payload: any) => {
  if (!payload) return payload;
  if (payload.item && typeof payload.item === "object") return payload.item;
  if (payload.data?.item && typeof payload.data.item === "object") return payload.data.item;
  if (payload.data && typeof payload.data === "object") return payload.data;
  return payload; // already flat ({ id, ... })
};

const withType = (type: string, obj: any) => ({ type, ...(obj || {}) });
const mergeEcho = (out: any, sent?: any) => {
  if (!out?.data && sent?.data) out.data = sent.data;
  if (!out?.integrations && sent?.integrations) out.integrations = sent.integrations;
  return out;
};

// ---- API calls ----
export const createObject = async (type: string, body: any) => {
  const r = await api.post(`/objects/${encodeURIComponent(type)}`, body);
  const u = unwrap(r.data);
  return mergeEcho(withType(type, u), body);
};

export const getObject = async (type: string, id: string) => {
  const r = await api.get(
    `/objects/${encodeURIComponent(type)}/${encodeURIComponent(id)}`
  );
  const u = unwrap(r.data);
  return withType(type, u);
};

export const updateObject = async (type: string, id: string, body: any) => {
  const r = await api.put(
    `/objects/${encodeURIComponent(type)}/${encodeURIComponent(id)}`,
    body
  );
  const u = unwrap(r.data);
  return mergeEcho(withType(type, u), body);
};

// Try canonical list first, then fallback if server hasn't implemented it yet
export const listObjects = async (
  type: string,
  opts?: { limit?: number; cursor?: string; order?: "asc" | "desc"; name?: string; namePrefix?: string }
) => {
  const params: Record<string, string> = {};
  if (opts?.limit) params.limit = String(opts.limit);
  if (opts?.cursor) params.cursor = opts.cursor;
  if (opts?.order) params.order = opts.order;
  if (opts?.name) params.name = opts.name;
  if (opts?.namePrefix) params.namePrefix = opts.namePrefix;

  try {
    // Preferred: GET /objects/{type}/list?...
    const r = await api.get(`/objects/${encodeURIComponent(type)}/list`, {
      params,
    });
    return r.data as { items: any[]; nextCursor?: string; prevCursor?: string; order?: "asc" | "desc" };
  } catch (e) {
    const status = (e as AxiosError)?.response?.status;
    if (status !== 404 && status !== 501) throw e;

    // Fallback: GET /objects/{type}
    const r2 = await api.get(`/objects/${encodeURIComponent(type)}`, {
      params,
    });
    const data = r2.data;
    if (Array.isArray(data)) return { items: data };
    if (data?.items) return data;
    return { items: [] as any[] };
  }
};
