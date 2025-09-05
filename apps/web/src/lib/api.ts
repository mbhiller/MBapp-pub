const API_BASE = import.meta.env.VITE_API_BASE!;
const TENANT   = import.meta.env.VITE_TENANT ?? "DemoTenant";

async function req(path: string, options: RequestInit = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "x-tenant-id": TENANT,
      "content-type": "application/json",
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status, data });
  }
  return data;
}

export const api = {
  getTenants: () => req(`/tenants`),
  createObject: (type: string, name: string) =>
    req(`/objects/${encodeURIComponent(type)}`, { method: "POST", body: JSON.stringify({ name }) }),
  getObjectByQuery: (type: string, id: string) =>
    req(`/objects/${encodeURIComponent(type)}?id=${encodeURIComponent(id)}`),
  getObjectByPath: (type: string, id: string) =>
    req(`/objects/${encodeURIComponent(type)}/${encodeURIComponent(id)}`),
  updateObject: (type: string, id: string, name: string) =>
    req(`/objects/${encodeURIComponent(type)}/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({ name }) }),
  search: () => req(`/objects/search`),
};
