/**
 * ops/smoke.ts
 *
 * Unified smoke runner that works per-module or across all modules.
 * Actions: list | create [n] | update | delete | deleteAll | deleteSeeded | flow | test
 *
 * Usage examples:
 *   npx tsx ops/smoke.ts all list
 *   npx tsx ops/smoke.ts products create 5
 *   npx tsx ops/smoke.ts purchaseOrders flow
 *   npx tsx ops/smoke.ts all test
 *
 * Requires env:
 *   MBAPP_API_BASE, MBAPP_TENANT_ID, MBAPP_BEARER
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// ====== Types from your generator ==================================
import type { components } from "../apps/mobile/src/api/generated-types";
type T = components["schemas"];

type ObjBase = { id: string; type: string };

// ====== Env =========================================================
const API_BASE = (process.env.MBAPP_API_BASE ?? "").replace(/\/+$/, "");
const TENANT   = process.env.MBAPP_TENANT_ID ?? "DemoTenant";
const BEARER   = process.env.MBAPP_BEARER ?? "";
if (!API_BASE) throw new Error("MBAPP_API_BASE is required (run ops/Init-MBDev.ps1 first).");

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";
type Page<TItem> = { items: TItem[]; next?: string };

const OUTDIR = join(process.cwd(), ".smoke");
if (!existsSync(OUTDIR)) mkdirSync(OUTDIR, { recursive: true });
const idsFile = (plural: string) => join(OUTDIR, `${plural}.ids.json`);

// Tag every create so we can target cleanups precisely
const RUN_TAG = process.env.MBAPP_SMOKE_TAG || `smoke-${Date.now()}`;
type WithMeta = { metadata?: Record<string, any> };
function withSeedTag<T extends WithMeta>(obj: T): T {
  return { ...obj, metadata: { ...(obj.metadata || {}), seedTag: RUN_TAG } };
}

const TYPES = {
  // plural → singular (objects API key)
  clients: "client",
  accounts: "account",
  employees: "employee",
  vendors: "vendor",
  products: "product",
  inventory: "inventory",
  events: "event",
  registrations: "registration",
  resources: "resource",
  reservations: "reservation",
  purchaseOrders: "purchaseOrder",
  salesOrders: "salesOrder",
} as const;

type PluralKey = keyof typeof TYPES;
type Singular = (typeof TYPES)[PluralKey];
const ALL_PLURALS: PluralKey[] = Object.keys(TYPES) as PluralKey[];

// ====== HTTP + paging ==============================================

async function req<TResp>(
  path: string,
  method: HttpMethod = "GET",
  body?: any,
  headers: Record<string, string> = {}
): Promise<TResp> {
  const url = `${API_BASE}${path}`;
  const allHeaders: Record<string, string> = {
    "content-type": "application/json",
    "x-tenant-id": TENANT,
    ...headers,
  };
  if (BEARER) allHeaders.authorization = `Bearer ${BEARER}`;

  const res = await fetch(url, {
    method,
    headers: allHeaders,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let detail: any;
    try { detail = await res.json(); } catch { detail = await res.text(); }
    throw new Error(`HTTP ${res.status} ${res.statusText} ${path} — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
  }
  if (res.status === 204) return undefined as unknown as TResp;
  return (await res.json()) as TResp;
}

function normalizePage<TItem>(res: any): Page<TItem> {
  if (Array.isArray(res)) return { items: res };
  if (res && typeof res === "object" && "items" in res) {
    const raw = (res as any).items;
    const items = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? Object.values(raw) : [];
    return { items: items as TItem[], next: (res as any).next };
  }
  if (res && typeof res === "object" && "data" in res) {
    const raw = (res as any).data;
    const items = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? Object.values(raw) : [];
    return { items: items as TItem[], next: (res as any).next };
  }
  if (res && typeof res === "object") return { items: Object.values(res) as TItem[] };
  return { items: [] };
}

async function listAll<TItem>(singular: Singular, limit = 200): Promise<TItem[]> {
  let next: string | undefined; const all: TItem[] = [];
  do {
    const res = normalizePage<TItem>(
      await req<any>(`/objects/${encodeURIComponent(singular)}?limit=${limit}${next ? `&next=${encodeURIComponent(next)}` : ""}`)
    );
    all.push(...res.items);
    next = res.next;
  } while (next);
  return all;
}

const idKey = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

// ====== CRUD helpers ===============================================

async function createObj<TItem extends ObjBase>(singular: Singular, body: Partial<TItem>): Promise<TItem> {
  return req<TItem>(`/objects/${encodeURIComponent(singular)}`, "POST", { ...body, type: singular }, { "idempotency-key": idKey() });
}
async function updateObj<TItem extends ObjBase>(singular: Singular, id: string, patch: Partial<TItem>): Promise<TItem> {
  return req<TItem>(`/objects/${encodeURIComponent(singular)}/${encodeURIComponent(id)}`, "PUT", patch, { "idempotency-key": idKey() });
}
async function deleteObj(singular: Singular, id: string) {
  await req(`/objects/${encodeURIComponent(singular)}/${encodeURIComponent(id)}`, "DELETE", undefined, { "idempotency-key": idKey() });
}

// ====== Support: ensure related records exist ======================

async function ensureClient(): Promise<string> {
  const clients = await listAll<T["Client"]>("client");
  if (clients[0]?.id) return clients[0].id!;
  const created = await createObj<T["Client"]>("client", { name: `Client ${Date.now()}`, status: "active" });
  return created.id!;
}

async function ensureEvent(): Promise<string> {
  const events = await listAll<T["Event"]>("event");
  if (events[0]?.id) return events[0].id!;
  const created = await createObj<T["Event"]>("event", {
    name: `Event ${Date.now()}`,
    startsAt: new Date().toISOString(),
    status: "available",
    capacity: 100,
  });
  return created.id!;
}

async function ensureResource(): Promise<string> {
  const resources = await listAll<T["Resource"]>("resource");
  if (resources[0]?.id) return resources[0].id!;
  const created = await createObj<T["Resource"]>("resource", { name: `Resource ${Date.now()}` });
  return created.id!;
}

/** Ensure at least N inventory items exist; returns their IDs */
async function ensureInventory(n = 3): Promise<string[]> {
  const existing = await listAll<T["InventoryItem"]>("inventory");
  const ids = existing.map((x: any) => x.id).filter(Boolean);
  if (ids.length >= n) return ids.slice(0, n);

  const needed = n - ids.length;
  for (let i = 0; i < needed; i++) {
    const rec = await createObj<T["InventoryItem"]>("inventory", {
      name: `Inventory Item ${Date.now()}-${i}`,
      sku: `INV-${Date.now()}-${i}`,
      quantity: 0,
      uom: "ea",
      status: "active",
    });
    ids.push(rec.id!);
  }
  return ids.slice(0, n);
}

// ====== Seed bodies (aligned to your generated types) ==============

function seedBody(singular: Singular, i: number): Partial<any> {
  const ts = Date.now();
  switch (singular) {
    case "client":       return { name: `Client ${i+1}`, status: "active" } satisfies Partial<T["Client"]>;
    case "account":      return { name: `Account ${i+1}`, status: "active" } satisfies Partial<T["Account"]>;
    case "employee":     return { displayName: `Employee ${i+1}` } satisfies Partial<T["Employee"]>;
    case "vendor":       return { name: `Vendor ${i+1}`, status: "active" } satisfies Partial<T["Vendor"]>;
    case "product":      return { name: `Product ${i+1}`, sku: `SKU-${ts}-${i}`, status: "active" } satisfies Partial<T["Product"]>;
    case "inventory":    return { name: `Inventory Item ${i+1}`, sku: `INV-${ts}-${i}`, quantity: 0, uom: "ea", status: "active" } satisfies Partial<T["InventoryItem"]>;
    case "resource":     return { name: `Resource ${i+1}` } satisfies Partial<T["Resource"]>;
    case "event":        return { name: `Event ${i+1}`, startsAt: new Date().toISOString(), status: "available", capacity: 100 } satisfies Partial<T["Event"]>;
    case "registration": return {
      // eventId + clientId injected later
      qty: 1,
      status: "pending",
      registeredAt: new Date().toISOString(),
    } satisfies Partial<T["Registration"]>;
    case "reservation":  return {
      // clientId + resourceId injected later
      startsAt: new Date(Date.now() + i * 3600_000).toISOString(),
      endsAt:   new Date(Date.now() + (i + 1) * 3600_000).toISOString(),
      status: "pending",
    } satisfies Partial<T["Reservation"]>;
    case "purchaseOrder":return {
      status: "draft",
      currency: "USD",
      vendorName: "Demo Vendor",
      lines: [], // filled dynamically using inventory itemIds
      notes: "seeded PO",
    } satisfies Partial<T["PurchaseOrder"]>;
    case "salesOrder":   return {
      status: "draft",
      currency: "USD",
      customerName: "Demo Customer",
      lines: [], // filled dynamically
      notes: "seeded SO",
    } satisfies Partial<T["SalesOrder"]>;
    default:             return { name: `${singular} ${i+1}` };
  }
}

// ====== Domain flows (PO/SO) =======================================
// (send id in path + query + body for robustness; can be simplified later once handlers uniformly read path param)

async function poApprove(id: string) {
  const q = `?id=${encodeURIComponent(id)}`;
  return req(`/purchasing/po/${encodeURIComponent(id)}:approve${q}`, "POST", { id, poId: id }, { "idempotency-key": idKey() });
}
async function poReceive(id: string, lines: { lineId: string; deltaQty: number; locationId?: string; lot?: string }[]) {
  const q = `?id=${encodeURIComponent(id)}`;
  return req(`/purchasing/po/${encodeURIComponent(id)}:receive${q}`, "POST", { id, poId: id, idempotencyKey: idKey(), lines });
}
async function soCommit(id: string) {
  const q = `?id=${encodeURIComponent(id)}`;
  return req(`/sales/so/${encodeURIComponent(id)}:commit${q}`, "POST", { id, soId: id }, { "idempotency-key": idKey() });
}
async function soFulfill(id: string, lines: { lineId: string; deltaQty: number; locationId?: string; lot?: string }[]) {
  const q = `?id=${encodeURIComponent(id)}`;
  return req(`/sales/so/${encodeURIComponent(id)}:fulfill${q}`, "POST", { id, soId: id, idempotencyKey: idKey(), lines });
}

// ====== Actions per module =========================================

async function action_list(plural: PluralKey) {
  const singular = TYPES[plural];
  const all = await listAll<any>(singular);
  console.log(`📄 ${plural}: ${all.length} item(s)`);
}

async function action_create(plural: PluralKey, n = 3) {
  const singular = TYPES[plural];

  // dependencies
  let clientId: string | null = null;
  let eventId: string | null = null;
  let resourceId: string | null = null;
  let itemIds: string[] = [];

  if (singular === "registration" || singular === "reservation") {
    clientId = await ensureClient();
  }
  if (singular === "registration") {
    eventId = await ensureEvent();
  }
  if (singular === "reservation") {
    resourceId = await ensureResource();
  }
  if (singular === "purchaseOrder" || singular === "salesOrder") {
    itemIds = await ensureInventory(3);
  }

  const path = idsFile(plural);
  const prior: string[] = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : [];
  const ids: string[] = [...prior];

  for (let i = 0; i < n; i++) {
    let body = seedBody(singular, i);

    if (singular === "registration") {
      body = {
        ...body,
        clientId: clientId!,
        eventId:  eventId!,
        qty: body["qty"] ?? 1,
      } satisfies Partial<T["Registration"]>;
    }

    if (singular === "reservation") {
      body = {
        ...body,
        clientId:  clientId!,
        resourceId: resourceId!,
      } satisfies Partial<T["Reservation"]>;
    }

    if (singular === "purchaseOrder") {
      const lines: NonNullable<T["PurchaseOrder"]["lines"]> = itemIds.slice(0, 2).map((itemId, idx) => ({
        itemId,
        uom: "ea",
        qty: 2 + idx,
        qtyReceived: 0,
        description: `PO line ${idx+1}`,
      }));
      body = { ...body, lines } satisfies Partial<T["PurchaseOrder"]>;
    }

    if (singular === "salesOrder") {
      const lines: NonNullable<T["SalesOrder"]["lines"]> = itemIds.slice(0, 2).map((itemId, idx) => ({
        itemId,
        uom: "ea",
        qty: 1 + idx,
        qtyFulfilled: 0,
        description: `SO line ${idx+1}`,
      }));
      body = { ...body, lines } satisfies Partial<T["SalesOrder"]>;
    }

    try {
      const rec = await createObj<any>(singular, withSeedTag(body));
      console.log(`➕ created ${plural}/${rec.id}`);
      ids.push(rec.id as string);
    } catch (e: any) {
      console.log(`⚠️  create ${plural} #${i+1} — ${e.message}`);
    }
  }

  writeFileSync(path, JSON.stringify(Array.from(new Set(ids)), null, 2));
  console.log(`💾 saved ${ids.length} ids to ${path} (tag=${RUN_TAG})`);
}

async function action_update(plural: PluralKey) {
  const singular = TYPES[plural];
  const path = idsFile(plural);
  const ids: string[] = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : [];
  const id = ids[0];
  if (!id) return console.log(`⏭️  ${plural}: no saved ids; run create first.`);
  const patched = await updateObj<any>(singular, id, { notes: `updated @ ${new Date().toISOString()}` });
  console.log(`✏️  updated ${plural}/${patched.id}`);
}

// delete only what we have saved locally (previous default)
async function action_deleteSaved(plural: PluralKey) {
  const singular = TYPES[plural];
  const path = idsFile(plural);
  const ids: string[] = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : [];
  if (!ids.length) return console.log(`⏭️  ${plural}: nothing to delete (no saved ids).`);
  for (const id of ids) {
    try { await deleteObj(singular, id); console.log(`🗑️  deleted ${plural}/${id}`); }
    catch (e: any) { console.log(`⚠️  delete ${plural}/${id} — ${e.message}`); }
  }
  writeFileSync(path, "[]");
  console.log(`✅ deleteSaved complete for ${plural}`);
}

// delete EVERYTHING for this module (dangerous)
async function action_deleteAll(plural: PluralKey) {
  const singular = TYPES[plural];
  const all = await listAll<any>(singular);
  if (!all.length) return console.log(`⏭️  ${plural}: none found.`);
  for (const o of all) {
    try { await deleteObj(singular, o.id); console.log(`🗑️  deleted ${plural}/${o.id}`); }
    catch (e: any) { console.log(`⚠️  delete ${plural}/${o.id} — ${e.message}`); }
  }
  console.log(`✅ deleteAll complete for ${plural}`);
}

// delete only items with metadata.seedTag == RUN_TAG (or startsWith if you pass a prefix)
function hasSeedTag(obj: any, tag: string) {
  const t = obj?.metadata?.seedTag;
  return typeof t === "string" && (t === tag || t.startsWith(tag));
}
async function action_deleteSeeded(plural: PluralKey, tag = RUN_TAG) {
  const singular = TYPES[plural];
  const all = await listAll<any>(singular);
  const targets = all.filter(o => hasSeedTag(o, tag));
  if (!targets.length) return console.log(`⏭️  ${plural}: no records with seedTag '${tag}'.`);
  for (const o of targets) {
    try { await deleteObj(singular, o.id); console.log(`🗑️  deleted ${plural}/${o.id} (tag=${o?.metadata?.seedTag})`); }
    catch (e: any) { console.log(`⚠️  delete ${plural}/${o.id} — ${e.message}`); }
  }
  console.log(`✅ deleteSeeded complete for ${plural} (tag=${tag})`);
}

async function action_flow(plural: PluralKey) {
  const singular = TYPES[plural];
  if (singular !== "purchaseOrder" && singular !== "salesOrder") {
    console.log("⏭️  flow only applies to purchaseOrders or salesOrders.");
    return;
  }
  const path = idsFile(plural);
  let ids: string[] = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : [];
  if (!ids[0]) {
    await action_create(plural, 1);
    const refreshed: string[] = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : [];
    if (!refreshed[0]) { console.log("⚠️  could not create a record for flow"); return; }
    ids = refreshed;
  }
  const id = ids[0];
  const obj = await req<any>(`/objects/${encodeURIComponent(singular)}/${encodeURIComponent(id)}`, "GET");
  const lineIds: string[] = Array.isArray(obj?.lines) ? obj.lines.map((l: any) => l.id).filter(Boolean) : [];

  if (singular === "purchaseOrder") {
    await poApprove(id); console.log(`✅ approved ${plural}/${id}`);
    if (lineIds.length) {
      await poReceive(id, lineIds.map(lid => ({ lineId: lid, deltaQty: 1 })));
      console.log(`📦 received ${lineIds.length} line(s)`);
    } else {
      console.log("⚠️  no line IDs; skipping receive");
    }
  } else {
    await soCommit(id); console.log(`✅ committed ${plural}/${id}`);
    if (lineIds.length) {
      await soFulfill(id, lineIds.map(lid => ({ lineId: lid, deltaQty: 1 })));
      console.log(`🚚 fulfilled ${lineIds.length} line(s)`);
    } else {
      console.log("⚠️  no line IDs; skipping fulfill");
    }
  }
}

// test = create → list → update → (flow for PO/SO) → deleteSaved
async function action_test(plural: PluralKey, n?: number) {
  await action_create(plural, n ?? 3);
  await action_list(plural);
  await action_update(plural);
  if (plural === "purchaseOrders" || plural === "salesOrders") await action_flow(plural);
  await action_deleteSaved(plural);
}

// ====== Orchestrators ==============================================

async function runFor(plural: PluralKey, action: string, n?: number) {
  switch (action) {
    case "list":         return action_list(plural);
    case "create":       return action_create(plural, n ?? 3);
    case "update":       return action_update(plural);
    case "delete":       return action_deleteSaved(plural);
    case "deleteAll":    return action_deleteAll(plural);
    case "deleteSeeded": return action_deleteSeeded(plural, process.env.MBAPP_SMOKE_TAG || RUN_TAG);
    case "flow":         return action_flow(plural);
    case "test":         return action_test(plural, n);
    default:
      throw new Error(`Unknown action '${action}'. Use list | create [n] | update | delete | deleteAll | deleteSeeded | flow | test.`);
  }
}

async function runAll(action: string, n?: number) {
  for (const mod of ALL_PLURALS) {
    console.log(`\n=== ${mod} :: ${action} ===`);
    await runFor(mod as PluralKey, action, n);
  }
}

// ====== Main =======================================================

async function main() {
  console.log("MBAPP_API_BASE:", API_BASE);
  console.log("MBAPP_TENANT_ID:", TENANT);
  console.log("MBAPP_BEARER:", BEARER ? "(set)" : "(missing)");
  console.log("MBAPP_SMOKE_TAG:", RUN_TAG);

  const [mod, action, maybeN] = process.argv.slice(2);
  if (!mod || !action) {
    console.log("Usage: tsx ops/smoke.ts <module|all> <action> [n]");
    console.log("Modules:", Object.keys(TYPES).join(", "), "or 'all'");
    process.exit(2);
  }
  const n = maybeN ? Number(maybeN) : undefined;

  if (mod === "all") {
    await runAll(action, n);
  } else {
    if (!(mod in TYPES)) {
      console.log("Unknown module. Use one of:", Object.keys(TYPES).join(", "), "or 'all'");
      process.exit(2);
    }
    await runFor(mod as PluralKey, action, n);
  }

  console.log("\n✅ smoke done.");
}

main().catch((e) => { console.error(e); process.exit(1); });
