import axios from "axios";

const API_BASE =
  (process.env.EXPO_PUBLIC_API_BASE as string) ||
  (process.env.API_BASE as string) ||
  "https://ki8kgivz1f.execute-api.us-east-1.amazonaws.com";

const TENANT =
  (process.env.EXPO_PUBLIC_TENANT_ID as string) ||
  (process.env.TENANT as string) ||
  "DemoTenant";

// Prefer nested envelopes first; only fall back to a bare { id } at the end.
const unwrap = (res: any) => {
  if (!res) return res;
  if (res.ok && res.data && typeof res.data === "object") return res.data;
  if (res.body?.item && typeof res.body.item === "object") return res.body.item;
  if (res.item && typeof res.item === "object") return res.item;
  if (res.data && typeof res.data === "object") return res.data;
  if (res.id && (res.type || res.data)) return res; // already flat and useful
  return res; // last resort (server truly returned only { id })
};

export const api = axios.create({
  baseURL: API_BASE,
  timeout: 8000,
  headers: { "content-type": "application/json", "x-tenant-id": TENANT },
});

// Helpers to keep UI useful even if backend returns minimal payloads
const withType = (type: string, obj: any) => ({ type, ...(obj || {}) });
const mergeEcho = (out: any, sent?: any) => {
  if (!out?.data && sent?.data) out.data = sent.data;
  if (!out?.integrations && sent?.integrations) out.integrations = sent.integrations;
  return out;
};

export const createObject = async (type: string, body: any) => {
  const r = await api.post(`/objects/${encodeURIComponent(type)}`, body);
  const u = unwrap(r.data);
  return mergeEcho(withType(type, u), body);
};

export const getObject = async (type: string, id: string) => {
  const r = await api.get(`/objects/${encodeURIComponent(type)}/${encodeURIComponent(id)}`);
  const u = unwrap(r.data);
  return withType(type, u);
};

export const updateObject = async (type: string, id: string, body: any) => {
  const r = await api.put(`/objects/${encodeURIComponent(type)}/${encodeURIComponent(id)}`, body);
  const u = unwrap(r.data);
  return mergeEcho(withType(type, u), body);
};
