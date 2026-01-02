// apps/web/src/lib/api.ts — canonical client with legacy compatibility bundle

const API_BASE = import.meta.env.VITE_API_BASE!;
const TENANT   = import.meta.env.VITE_TENANT ?? "DemoTenant";

export type Page<T> = { items: T[]; next?: string };
type Order = "asc" | "desc";

// Lightweight PO types for suggest/create workflows
export type PurchaseOrderLine = {
  id?: string;
  lineId?: string;
  itemId?: string;
  qty?: number;
  receivedQty?: number;
  qtyRequested?: number;
  qtySuggested?: number;
  uom?: string;
  productId?: string;
  backorderRequestIds?: string[];
  minOrderQtyApplied?: number;
  adjustedFrom?: number;
};

export type PurchaseOrderDraft = {
  id?: string;
  vendorId: string;
  vendorName?: string;
  status?: string;
  currency?: string;
  createdAt?: string;
  updatedAt?: string;
  lines?: PurchaseOrderLine[];
};

export type SuggestPoResponse = {
  draft?: PurchaseOrderDraft;
  drafts?: PurchaseOrderDraft[];
  skipped?: Array<{ backorderRequestId: string; reason?: string }>;
};

export type CreateFromSuggestionResponse = {
  id?: string;
  ids?: string[];
};

async function req<T = any>(path: string, init: RequestInit = {}, opts: { token?: string | null; tenantId?: string | null } = {}): Promise<T> {
  const hasBody = init.body != null && init.method && init.method !== "GET";
  const headers: Record<string, string> = {
    "x-tenant-id": opts.tenantId || TENANT,
    ...(hasBody ? { "content-type": "application/json" } : {}),
    ...(opts.token ? { "Authorization": `Bearer ${opts.token}` } : {}),
    ...(init.headers as Record<string, string> | undefined),
  };
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const j = await res.json();
      msg = (j?.message as string) || msg;
    } catch {}
    throw new Error(msg);
  }
  const ct = res.headers.get("content-type") || "";
  return ct.includes("application/json") ? res.json() : (undefined as T);
}

/** ---------- Canonical Objects API ---------- **/

export function listObjects<T>(
  type: string,
  opts: { limit?: number; next?: string | null; sku?: string; q?: string; order?: Order } = {}
): Promise<Page<T>> {
  const p = new URLSearchParams();
  if (opts.limit != null) p.set("limit", String(opts.limit));
  if (opts.next) p.set("next", opts.next);
  if (opts.sku) p.set("sku", opts.sku);
  if (opts.q) p.set("q", opts.q);
  if (opts.order) p.set("order", opts.order);
  const qs = p.toString();
  return req(`/objects/${encodeURIComponent(type)}${qs ? `?${qs}` : ""}`);
}

export function getObject<T>(type: string, id: string): Promise<T> {
  return req(`/objects/${encodeURIComponent(type)}/${encodeURIComponent(id)}`);
}

/** Create supports BOTH canonical (body) and legacy (name, tag) overloads */
export function createObject<T>(type: string, body: any): Promise<T>;
export function createObject(type: string, name?: string, tag?: string): Promise<{ id?: string }>;
export function createObject(type: string, a?: any, b?: any): Promise<any> {
  const body = typeof a === "object" && a !== null ? a : { ...(a ? { name: a } : {}), ...(b ? { tag: b } : {}) };
  return req(`/objects/${encodeURIComponent(type)}`, { method: "POST", body: JSON.stringify(body) });
}

export function updateObject<T>(type: string, id: string, patch: any): Promise<T> {
  return req(`/objects/${encodeURIComponent(type)}/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(patch),
  });
}

export function deleteObject(type: string, id: string): Promise<{ ok: true }> {
  return req(`/objects/${encodeURIComponent(type)}/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/** ---------- Purchasing helpers (suggest/create from BOs) ---------- **/

export function suggestPurchaseOrders(
  backorderRequestIds: string[],
  opts: { vendorId?: string; token?: string | null; tenantId?: string | null } = {}
): Promise<SuggestPoResponse> {
  const requests = backorderRequestIds.map((id) => ({ backorderRequestId: id }));
  const body: Record<string, any> = { requests };
  if (opts.vendorId) body.vendorId = opts.vendorId;
  return req(`/purchasing/suggest-po`, { method: "POST", body: JSON.stringify(body) }, { token: opts.token ?? undefined, tenantId: opts.tenantId ?? undefined });
}

export function createPurchaseOrdersFromSuggestion(
  draftOrDrafts: PurchaseOrderDraft | PurchaseOrderDraft[],
  opts: { idempotencyKey?: string; token?: string | null; tenantId?: string | null } = {}
): Promise<CreateFromSuggestionResponse> {
  const body = Array.isArray(draftOrDrafts) ? { drafts: draftOrDrafts } : { draft: draftOrDrafts };
  const headers = opts.idempotencyKey ? { "Idempotency-Key": opts.idempotencyKey } : undefined;
  return req(`/purchasing/po:create-from-suggestion`, {
    method: "POST",
    body: JSON.stringify(body),
    headers,
  }, { token: opts.token ?? undefined, tenantId: opts.tenantId ?? undefined });
}

/** ---------- Legacy helpers kept for existing demo UI ---------- **/

// NOTE: Canonical GET is by path; this legacy function keeps ?id= for older demos.
export function getObjectByQuery<T>(type: string, id: string): Promise<T> {
  const p = new URLSearchParams({ id });
  return req(`/objects/${encodeURIComponent(type)}?${p.toString()}`);
}

export function getObjectByPath<T>(type: string, id: string): Promise<T> {
  return getObject<T>(type, id);
}

type LegacyPage<T> = { items: T[]; cursor?: string; next?: string };

// Legacy listByType(type, limit, cursor) → normalizes `next` into `cursor`
export async function listByType<T>(
  type: string,
  limit = 5,
  cursor?: string | null
): Promise<LegacyPage<T>> {
  const page = await listObjects<T>(type, { limit, next: cursor || undefined });
  const legacy: LegacyPage<T> = { items: page.items ?? [] };
  if (page.next) legacy.cursor = page.next; // keep legacy name for App.tsx
  return legacy;
}

// Legacy global tag search — retained so App.tsx works without changes.
// If your API supports /objects/search?tag=, this will hit it; otherwise you can
// redirect it server-side to the new canonical search semantics.
export async function searchByTag<T>(
  tag: string,
  limit = 5,
  cursor?: string | null
): Promise<LegacyPage<T>> {
  const p = new URLSearchParams({ tag });
  if (limit != null) p.set("limit", String(limit));
  if (cursor) p.set("next", cursor); // prefer `next` on newer backends
  const data = await req<LegacyPage<T>>(`/objects/search?${p.toString()}`);
  // normalize if backend returns only `next`
  if (data && !data.cursor && (data as any).next) (data as any).cursor = (data as any).next;
  return data;
}

/** ---------- Tenants ---------- **/
export async function getTenants(): Promise<Array<{ key: string; name?: string }>> {
  try {
    const r = await req<Array<{ key: string; name?: string }>>(`/tenants`);
    if (Array.isArray(r) && r.length) return r;
  } catch {}
  // Fallback so demo keeps working even if /tenants is not wired
  return [{ key: TENANT, name: TENANT }];
}

/** ---------- Typed convenience built on canonical objects ---------- **/

// Products (resolve to objects/product)
export type Product = {
  id: string;
  type: "product";
  tenant?: string;
  sku?: string;
  name?: string;
  kind?: "good" | "service";
  price?: number;
  uom?: string;
  tags?: string[];
  createdAt?: string;
  updatedAt?: string;
};

export const listProducts = (opts: { limit?: number; next?: string | null; sku?: string; q?: string; order?: Order } = {}) =>
  listObjects<Product>("product", opts);
export const searchProducts = (opts: { limit?: number; next?: string | null; sku?: string; q?: string; order?: Order } = {}) =>
  listObjects<Product>("product", opts);
export const getProduct = (id: string) => getObject<Product>("product", id);
export const createProduct = (body: Partial<Product>) => createObject<Product>("product", body);
export const updateProduct = (id: string, patch: Partial<Product>) => updateObject<Product>("product", id, patch);

// Clients (resolve to objects/client)
export type Client = {
  id: string;
  type: "client";
  tenant?: string;
  name?: string;
  email?: string;
  phone?: string;
  status?: "active" | "inactive";
  createdAt?: string;
  updatedAt?: string;
};
export const listClients = (opts: { limit?: number; next?: string | null; q?: string; order?: Order } = {}) =>
  listObjects<Client>("client", opts);
export const getClient = (id: string) => getObject<Client>("client", id);
export const createClient = (body: Partial<Client>) => createObject<Client>("client", body);
export const updateClient = (id: string, patch: Partial<Client>) => updateObject<Client>("client", id, patch);

// Resources (resolve to objects/resource)
export type Resource = {
  id: string;
  type: "resource";
  tenant?: string;
  name?: string;
  resourceType?: string;
  location?: string;
  capacity?: number;
  status?: string;
  tags?: string[];
  createdAt?: string;
  updatedAt?: string;
};
export const listResources = (opts: { limit?: number; next?: string | null; q?: string; order?: Order } = {}) =>
  listObjects<Resource>("resource", opts);
export const getResource = (id: string) => getObject<Resource>("resource", id);
export const createResource = (body: Partial<Resource>) => createObject<Resource>("resource", body);
export const updateResource = (id: string, patch: Partial<Resource>) => updateObject<Resource>("resource", id, patch);

/** ---------- Bundle for `import { api } from "./lib/api"` ---------- **/
export const api = {
  // canonical core
  listObjects, getObject, createObject, updateObject, deleteObject,
  // purchasing
  suggestPurchaseOrders, createPurchaseOrdersFromSuggestion,
  // products/clients/resources typed helpers
  listProducts, searchProducts, getProduct, createProduct, updateProduct,
  listClients, getClient, createClient, updateClient,
  listResources, getResource, createResource, updateResource,
  // tenants
  getTenants,
  // legacy shims used by current App.tsx
  getObjectByQuery, getObjectByPath, listByType, searchByTag,
};
