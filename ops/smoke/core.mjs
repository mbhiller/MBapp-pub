// ops/smoke/core.mjs
import { setTimeout as wait } from "node:timers/promises";

export const API_BASE  = process.env.MBAPP_API_BASE  || process.env.EXPO_PUBLIC_API_BASE  || "https://ki8kgivz1f.execute-api.us-east-1.amazonaws.com";
export const TENANT_ID = process.env.MBAPP_TENANT_ID || process.env.EXPO_PUBLIC_TENANT_ID || "DemoTenant";
export const BEARER    = process.env.MBAPP_BEARER    || "";

function headers(extra = {}) {
  const h = {
    "content-type": "application/json",
    accept: "application/json",
    "x-tenant-id": TENANT_ID,
    ...extra,
  };
  if (BEARER) h.authorization = `Bearer ${BEARER}`;
  return h;
}

async function fetchJson(path, init, attempt = 0) {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, init);
  const ct = res.headers.get("content-type") || "";
  const body = ct.includes("application/json") ? await res.json().catch(() => ({})) : await res.text();
  if (!res.ok) {
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      const ms = Math.min(1800, 250 * (attempt + 1)) + Math.floor(Math.random() * 120);
      await wait(ms);
      return fetchJson(path, init, attempt + 1);
    }
    const msg = body?.message || body || `${res.status}`;
    const err = new Error(`HTTP ${res.status} ${path} — ${msg}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

export async function api(path, { method = "GET", body, idem, hdrs = {} } = {}) {
  const h = headers(hdrs);
  if (idem) h["Idempotency-Key"] = idem;
  const init = { method, headers: h, body: body != null ? JSON.stringify(body) : undefined };
  return fetchJson(path, init);
}

export function normalizePage(res) {
  if (!res || typeof res !== "object") return { items: [] };
  if (Array.isArray(res)) return { items: res };
  if ("items" in res) return { items: Array.isArray(res.items) ? res.items : Object.values(res.items || {}), next: res.next };
  if ("rows"  in res) return { items: Array.isArray(res.rows)  ? res.rows  : Object.values(res.rows  || {}), next: res.next };
  if ("data"  in res) return { items: Array.isArray(res.data)  ? res.data  : Object.values(res.data  || {}), next: res.next };
  return { items: Object.values(res) };
}

// 👇 add these helpers
export const nowTag = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth()+1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
};
export const idem = (prefix = "smk") => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
