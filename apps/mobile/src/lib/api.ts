// apps/mobile/src/lib/api.ts
import Constants from "expo-constants";

type Json = Record<string, unknown> | Array<unknown> | null;

/** Prefer EXPO_PUBLIC_* env; fall back to app.config.ts extra; then a safe default */
const env = process.env as Record<string, string | undefined>;
const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, any>;

export const API_BASE =
  env.EXPO_PUBLIC_API_BASE ??
  (extra.API_BASE as string | undefined) ??
  "https://ki8kgivz1f.execute-api.us-east-1.amazonaws.com";

export const TENANT_ID =
  env.EXPO_PUBLIC_TENANT_ID ??
  (extra.TENANT_ID as string | undefined) ??
  "DemoTenant";

export async function api(path: string, init: RequestInit = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-tenant-id": TENANT_ID,
      ...(init.headers || {}),
    },
  });

  const text = await res.text();
  const json: Json = text ? safeJson(text) : null;

  if (!res.ok) {
    const err: any = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

function safeJson(text: string) {
  try { return JSON.parse(text); } catch { return null; }
}

/** Objects helpers used by a couple screens */
export async function getObject(type: string, id: string) {
  return api(`/objects/${encodeURIComponent(type)}/${encodeURIComponent(id)}`);
}

export async function updateObject(type: string, id: string, patch: Record<string, any>) {
  return api(`/objects/${encodeURIComponent(type)}/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(patch),
  });
}
