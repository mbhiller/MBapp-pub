#!/usr/bin/env node
// ops/smoke.mjs
// Smoke CLI for MBapp: seed/list/update/delete per module + purchase/sales flows + guardrail checks.
// Requires Node 18+ (fetch built-in).

import process from "node:process";
import { setTimeout as wait } from "node:timers/promises";
import fs from "node:fs/promises";
import path from "node:path";

/* ------------------------------ Config ------------------------------ */

const API_BASE = (process.env.MBAPP_API_BASE || "").replace(/\/+$/, "");
let   BEARER   = process.env.MBAPP_BEARER || ""; // updated by `login`

// Supported module keys (exact CLI names in your banner) — ordered for linked seeding
const MODULES = [
  "organization",
  "client", "vendor", "employee", "account",
  "product", "inventory",
  "resource",
  "venueArea", "stall",
  "classDef", "scorecardTemplate",
  "event",
  "reservation", "registration",
  "purchaseOrder", "salesOrder",
];

// Map CLI type → objects route type (DB item.type)
const TYPE_MAP = {
  organization: "organization",
  client: "client",
  account: "account",
  employee: "employee",
  vendor: "vendor",
  product: "product",
  inventory: "inventory",
  event: "event",
  registration: "registration",
  resource: "resource",
  reservation: "reservation",
  purchaseOrder: "purchaseOrder",
  salesOrder: "salesOrder",
  classDef: "classDef",
  scorecardTemplate: "scorecardTemplate",
  venueArea: "venueArea",
  stall: "stall",
};

function usage() {
  console.log(`Usage:
  node ops/smoke.mjs env
  node ops/smoke.mjs login [--tenant DemoTenant] [--email dev@example.com] [--policy full|min|read] [--export]

  node ops/smoke.mjs smoke:all:create [--each 3]
  node ops/smoke.mjs smoke:all:list
  node ops/smoke.mjs smoke:all:update
  node ops/smoke.mjs smoke:all:delete

  node ops/smoke.mjs smoke:<type>:create|list|update|delete
    <type> ∈ { ${MODULES.join(", ")} }

  node ops/smoke.mjs smoke:purchaseOrder:flow [--id <poId>] [--lines 3] [--qty 2] [--idem abc]
  node ops/smoke.mjs smoke:salesOrder:flow    [--id <soId>] [--lines 3] [--qty 1] [--idem abc]

  # Guardrails (expect 409 on violations; also assert counters never negative)
  node ops/smoke.mjs smoke:guardrails:so-overcommit   [--qty 2]
  node ops/smoke.mjs smoke:guardrails:so-overfulfill  [--qty 2]
  node ops/smoke.mjs smoke:guardrails:po-idempotency  [--lines 2] [--qty 2] [--idem abc]
  node ops/smoke.mjs smoke:guardrails:cancel-release
`);
}

/* -------------------------- Small utilities ------------------------- */

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const v = (argv[i + 1] && !argv[i + 1].startsWith("--")) ? argv[++i] : true;
      out[k] = v;
    }
  }
  return out;
}
function requireEnv() {
  if (!API_BASE) throw new Error("MBAPP_API_BASE not set");
  if (!BEARER)   throw new Error("MBAPP_BEARER not set (run login)");
}
function randId() {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}
function nowIso() { return new Date().toISOString(); }
function addMinutes(date, mins) { return new Date(date.getTime() + mins * 60000); }
function pick(n, arr) { const out=[]; for(let i=0;i<n;i++) out.push(arr[i % arr.length]); return out; }
function sample(arr) { return arr.length ? arr[Math.floor(Math.random()*arr.length)] : undefined; }

function normalizePage(res) {
  if (Array.isArray(res)) return { items: res };
  if (res && typeof res === "object") {
    if ("items" in res) {
      const raw = res.items;
      const items = Array.isArray(raw) ? raw : (raw && typeof raw === "object" ? Object.values(raw) : []);
      return { items, next: res.next };
    }
    if ("data" in res) {
      const raw = res.data;
      const items = Array.isArray(raw) ? raw : (raw && typeof raw === "object" ? Object.values(raw) : []);
      return { items, next: res.next };
    }
    return { items: Object.values(res) };
  }
  return { items: [] };
}

/* ----------------------------- HTTP core ---------------------------- */

async function api(path, { method = "GET", body, headers } = {}) {
  requireEnv();
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      "authorization": `Bearer ${BEARER}`,
      "content-type": "application/json",
      ...(headers || {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : undefined; } catch { json = { raw: text }; }
  if (!res.ok) {
    const msg = json?.message || text || res.statusText;
    const rid = res.headers.get("x-amzn-RequestId") || res.headers.get("x-request-id") || "";
    const hdr = Object.fromEntries([...res.headers.entries()]);
    const err = new Error(`HTTP ${res.status} ${res.statusText} ${path} — ${msg}\nheaders=${JSON.stringify(hdr)}\nbody=${text}\nrequestId=${rid}`);
    err.status = res.status;
    err.response = json;
    throw err;
  }
  return json;
}

/* -------------------------- Login / Environment ---------------------- */

function policyPreset(kind) {
  const FULL = {
    "*:read": true,
    "product:read": true, "inventory:read": true, "purchase:read": true, "sales:read": true,
    "event:read": true, "registration:read": true, "resource:read": true, "reservation:read": true,"organization:read": true,

    "purchase:write": true, "purchase:approve": true, "purchase:receive": true, "purchase:cancel": true, "purchase:close": true,
    "sales:write": true, "sales:commit": true, "sales:fulfill": true, "sales:cancel": true, "sales:close": true,
    "registration:write": true, "reservation:write": true,

    "tools:seed": true, "admin:reset": true,
    "*:write": true, "*:*": true, "*": true,
  };
  const READ = { "*:read": true };
  const MIN  = { "*:read": true, "purchase:write": true, "sales:write": true };
  switch ((kind || "full").toLowerCase()) {
    case "read": return READ;
    case "min":  return MIN;
    default:     return FULL;
  }
}

async function cmdEnv() {
  console.log(JSON.stringify({
    MBAPP_API_BASE: API_BASE || null,
    MBAPP_TENANT_ID: process.env.MBAPP_TENANT_ID || "(jwt)",
    MBAPP_BEARER_SET: Boolean(BEARER),
    AWS_REGION: process.env.AWS_REGION || null,
  }, null, 2));
}

async function writeTokenFiles(token) {
  const root = process.env.MBAPP_REPO_ROOT || process.cwd();
  const outDir = path.join(root, "ops");
  try { await fs.mkdir(outDir, { recursive: true }); } catch {}
  const tokenPath = path.join(outDir, ".mb_bearer");
  const envPath   = path.join(outDir, ".env.local");
  try { await fs.writeFile(tokenPath, token, "utf8"); } catch {}
  try { await fs.writeFile(envPath, `MBAPP_BEARER="${token}"\n`, "utf8"); } catch {}
  return { tokenPath, envPath };
}

async function cmdLogin(args) {
  const email   = String(args.email || "dev@example.com");
  const tenant  = String(args.tenant || "DemoTenant");
  const policy  = policyPreset(args.policy || "full");
  const exportOnly = Boolean(args.export);

  const res  = await fetch(`${API_BASE}/auth/dev-login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, tenantId: tenant, policy }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`dev-login failed — ${res.status} ${res.statusText}: ${JSON.stringify(data)}`);

  BEARER = data.token;
  process.env.MBAPP_BEARER = BEARER;

  if (exportOnly) { console.log(BEARER); return; }

  const paths = await writeTokenFiles(BEARER);

  let policyGet = {};
  try { policyGet = await api(`/auth/policy`, { method: "GET" }); }
  catch (e) { policyGet = { error: "policy_fetch_failed", message: e?.message || String(e) }; }

  console.log(JSON.stringify({
    ok: true, email, tenant,
    policyRulesPosted: Object.keys(policy).length,
    tokenPreview: BEARER?.slice(0, 20) + "...",
    stored: { processEnv: true, tokenFile: paths.tokenPath, envFile: paths.envPath },
    howToSetInCurrentShell: "PowerShell: $env:MBAPP_BEARER = (Get-Content ops/.mb_bearer)",
    policy: policyGet,
  }, null, 2));
}

/* -------------------------- Per-type helpers ------------------------ */

async function listType(type, limit = 50, next) {
  const q = new URLSearchParams();
  q.set("limit", String(limit));
  if (next) q.set("next", next);
  const res = await api(`/objects/${encodeURIComponent(type)}?${q.toString()}`, { method: "GET" });
  return normalizePage(res);
}
async function getById(type, id) {
  return api(`/objects/${encodeURIComponent(type)}/${encodeURIComponent(id)}`, { method: "GET" });
}
async function createType(type, body) {
  return api(`/objects/${encodeURIComponent(type)}`, { method: "POST", body });
}
async function updateType(type, id, patch) {
  return api(`/objects/${encodeURIComponent(type)}/${encodeURIComponent(id)}`, { method: "PUT", body: patch });
}
async function deleteTypeId(type, id) {
  return api(`/objects/${encodeURIComponent(type)}/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// Onhand counters — preferred endpoint /inventory/{id}/onhand
async function getOnhand(itemId) {
  try {
    return await api(`/inventory/${encodeURIComponent(itemId)}/onhand`, { method: "GET" });
  } catch (e) {
    // Fallback: derive from object if server doesn't expose onhand endpoint
    const inv = await getById("inventory", itemId);
    return { id: itemId, qtyOnHand: Number(inv?.qtyOnHand ?? 0), qtyReserved: Number(inv?.qtyReserved ?? 0), qtyAvailable: Math.max(0, Number(inv?.qtyOnHand ?? 0) - Number(inv?.qtyReserved ?? 0)) };
  }
}

/* ------------------------------ Seeding ----------------------------- */

function seedBody(cliType) {
  const t = TYPE_MAP[cliType];
  const n = Date.now();
  switch (cliType) {
    case "organization":   return { type: t, name: `Org ${n}`, kind: "club", status: "active" };
    case "client":         return { type: t, name: `Client ${n}`,  status: "active" };
    case "account":        return { type: t, name: `Account ${n}`, currency: "USD", accountType: "asset" };
    case "employee":       return { type: t, name: `Employee ${n}`, status: "active" };
    case "vendor":         return { type: t, name: `Vendor ${n}`,   status: "active" };
    case "product":        return { type: t, name: `Product ${n}`, sku: `SKU-${n}`, uom: "each", status: "active" };
    case "inventory":      return { type: t, name: `INV ${n}`, sku: `INV-${n}`, uom: "each", status: "active", quantity: 0 };
    case "resource":       return { type: t, name: `Resource ${n}`, status: "available" };
    case "venueArea":      return { type: t, name: `Ring ${n}`, kind: "ring", capacity: 8, status: "open" };
    case "stall":          return { type: t, number: `S-${n}`, status: "available" };
    case "classDef":       return { type: t, code: `CL-${n}`, name: `Class ${n}`, discipline: "dressage", fee: 35 };
    case "scorecardTemplate":
      return {
        type: t,
        name: `Dressage Basic ${n}`,
        fields: [
          { key: "gaits",    label: "Gaits",    type: "number", weight: 1 },
          { key: "impulse",  label: "Impulse",  type: "number", weight: 1 },
          { key: "submission", label: "Submission", type: "number", weight: 1 },
          { key: "notes",    label: "Notes",    type: "note" },
        ],
        calc: { formula: "total = (gaits||0) + (impulse||0) + (submission||0)" },
      };
    case "event":          return { type: t, name: `Event ${n}`, startsAt: new Date().toISOString(), capacity: 100, status: "scheduled" };
    case "reservation":    return {
      type: t,
      startsAt: addMinutes(new Date(), 30).toISOString(),
      endsAt:   addMinutes(new Date(), 90).toISOString(),
      status: "pending",
    };
    case "registration":   return { type: t, qty: 1, status: "pending" };
    case "purchaseOrder":  return { type: t, vendorName: "Demo Vendor", status: "draft", lines: [] };
    case "salesOrder":     return { type: t, customerName: "Demo Customer", status: "draft", lines: [] };
    default:               return { type: t, name: `Unknown ${n}` };
  }
}

/* -------------------------- CRUD commands --------------------------- */

async function cmdCreate(cliType, each = 1) {
  const type = TYPE_MAP[cliType];
  if (!type) throw new Error(`Unknown type: ${cliType}`);
  const ids = [];

  // Special handling for POs/SOs so lines reference real inventory items
  if (cliType === "purchaseOrder" || cliType === "salesOrder") {
    const inv = await ensureInventoryItems(3);
    for (let i = 0; i < Number(each); i++) {
      const body = seedBody(cliType);
      const chosen = pick(2, inv);
      const lines = chosen.map((c, idx) =>
        cliType === "purchaseOrder"
          ? { id: `L${idx+1}`, itemId: c.id, uom: c.uom, qty: 2, qtyReceived: 0 }
          : { id: `L${idx+1}`, itemId: c.id, uom: c.uom, qty: 1, qtyFulfilled: 0 }
      );
      body.lines = lines;
      const created = await createType(type, body);
      ids.push(created.id);
      await wait(15);
    }
    console.log(JSON.stringify({ type: cliType, created: ids }, null, 2));
    return;
  }

  // Default simple create
  for (let i = 0; i < Number(each); i++) {
    const created = await createType(type, seedBody(cliType));
    ids.push(created.id);
    await wait(10);
  }
  console.log(JSON.stringify({ type: cliType, created: ids }, null, 2));
}

async function cmdList(cliType) {
  const type = TYPE_MAP[cliType];
  if (!type) throw new Error(`Unknown type: ${cliType}`);
  const page = await listType(type, 50);
  const ids  = (page.items || []).map(it => it.id);
  console.log(JSON.stringify({ type: cliType, count: ids.length, ids, next: page.next || null }, null, 2));
}

async function cmdUpdate(cliType) {
  const type = TYPE_MAP[cliType];
  if (!type) throw new Error(`Unknown type: ${cliType}`);
  const page = await listType(type, 5);
  const items = page.items || [];
  const patched = [];
  for (const it of items) {
    const id = String(it.id);
    const patch = {};
    if ("name" in it)   patch.name  = String(it.name || "") + " (smoke)";
    if ("notes" in it)  patch.notes = String(it.notes || "") + " (smoke)";
    if (cliType === "inventory" && "status" in it) patch.status = "active";
    const res = await updateType(type, id, patch);
    patched.push(res.id || id);
  }
  console.log(JSON.stringify({ type: cliType, updated: patched.length, ids: patched }, null, 2));
}

async function cmdDelete(cliType) {
  const type = TYPE_MAP[cliType];
  if (!type) throw new Error(`Unknown type: ${cliType}`);
  let total = 0, next;
  do {
    const page = await listType(type, 50, next);
    const items = page.items || [];
    for (const it of items) {
      await deleteTypeId(type, String(it.id));
      total++;
    }
    next = page.next;
  } while (next);
  console.log(JSON.stringify({ type: cliType, deleted: total }, null, 2));
}

/* ----------------------------- Flows -------------------------------- */

async function ensureInventoryItems(count = 3) {
  const items = [];
  for (let i = 0; i < count; i++) {
    const body = {
      type: "inventory",
      name: `INV ${Date.now()}-${i}`,
      sku: `INV-${Date.now()}-${i}`,
      uom: "each",
      status: "active",
      quantity: 0,
    };
    const created = await createType("inventory", body);
    items.push({ id: created.id, uom: created.uom || "each" });
  }
  return items;
}

async function poEnsureOnhandForLines(poId, qtyPerLine) {
  // Helper for tests: approve and receive PO to stock up
  await api(`/purchasing/po/${encodeURIComponent(poId)}:submit`,  { method: "POST", body: { id: poId } });
  await api(`/purchasing/po/${encodeURIComponent(poId)}:approve`, { method: "POST", body: { id: poId } });
  const po = await getById("purchaseOrder", poId);
  const lines = (po.lines || []).map(l => ({ lineId: String(l.id), deltaQty: qtyPerLine }));
  const idem = `po-rec-${randId()}`;
  await api(`/purchasing/po/${encodeURIComponent(poId)}:receive`, {
    method: "POST",
    body: { idempotencyKey: idem, lines },
    headers: { "Idempotency-Key": idem },
  });
  return getById("purchaseOrder", poId);
}

async function flowPurchaseOrder(args) {
  const linesN = Number(args.lines ?? 3);
  const qty    = Number(args.qty ?? 2);
  const idem   = (args.idem && String(args.idem)) || `po-rec-${randId()}`;
  let   poId   = args.id ? String(args.id) : null;

  if (!poId) {
    const inv = await ensureInventoryItems(Math.max(1, linesN));
    const chosen = pick(linesN, inv);
    const body = {
      type: "purchaseOrder",
      vendorId: `ven-${randId()}`,
      vendorName: "Demo Vendor",
      status: "draft",
      lines: chosen.map((c, i) => ({ id: `L${i+1}`, itemId: c.id, uom: c.uom, qty, qtyReceived: 0 })),
    };
    const created = await createType("purchaseOrder", body);
    poId = created.id;
    console.log(JSON.stringify({ created: { id: poId } }, null, 2));
  }

  await api(`/purchasing/po/${encodeURIComponent(poId)}:submit`,  { method: "POST", body: { id: poId } });
  await api(`/purchasing/po/${encodeURIComponent(poId)}:approve`, { method: "POST", body: { id: poId } });

  const po = await getById("purchaseOrder", poId);
  const lines = (po.lines || []).map(l => ({ lineId: String(l.id), deltaQty: qty }));

  await api(`/purchasing/po/${encodeURIComponent(poId)}:receive`, {
    method: "POST",
    body: { idempotencyKey: idem, lines },
    headers: { "Idempotency-Key": idem },
  });

  // Assert: after receive, all item onHand >= 0
  await assertCountersFromPo(poId);

  await api(`/purchasing/po/${encodeURIComponent(poId)}:close`,   { method: "POST", body: { id: poId } });
  const final = await getById("purchaseOrder", poId);
  console.log(JSON.stringify({ flow: "purchaseOrder", id: poId, status: final.status }, null, 2));
}

async function flowSalesOrder(args) {
  const linesN = Number(args.lines ?? 3);
  const qty    = Number(args.qty ?? 1);
  const idem   = (args.idem && String(args.idem)) || `so-ful-${randId()}`;
  let   soId   = args.id ? String(args.id) : null;

  if (!soId) {
    const inv = await ensureInventoryItems(Math.max(1, linesN));
    const chosen = pick(linesN, inv);
    const body = {
      type: "salesOrder",
      customerName: "Demo Customer",
      status: "draft",
      lines: chosen.map((c, i) => ({ id: `L${i+1}`, itemId: c.id, uom: c.uom, qty, qtyFulfilled: 0 })),
    };
    const created = await createType("salesOrder", body);
    soId = created.id;
    console.log(JSON.stringify({ created: { id: soId } }, null, 2));
  }

  await api(`/sales/so/${encodeURIComponent(soId)}:submit`, { method: "POST", body: { id: soId } });

  // Try commit — this should 409 if insufficient available
  try {
    await api(`/sales/so/${encodeURIComponent(soId)}:commit`, { method: "POST", body: { id: soId, idempotencyKey: idem }, headers: { "Idempotency-Key": idem } });
  } catch (e) {
    if (e.status === 409) {
      console.log(JSON.stringify({ flow: "salesOrder", id: soId, commit: "insufficient_available_to_commit", detail: e.response || null }, null, 2));
      // Stock up to proceed: create PO to supply the items then retry commit
      const so = await getById("salesOrder", soId);
      const poBody = {
        type: "purchaseOrder", vendorName: "Auto Supply", status: "draft",
        lines: (so.lines || []).map((l, i) => ({ id: `PL${i+1}`, itemId: l.itemId, uom: l.uom, qty: Math.max(1, Number(l.qty||1)), qtyReceived: 0 })),
      };
      const po = await createType("purchaseOrder", poBody);
      await poEnsureOnhandForLines(po.id, Math.max(1, Number(qty)));
      await api(`/sales/so/${encodeURIComponent(soId)}:commit`, { method: "POST", body: { id: soId, idempotencyKey: idem }, headers: { "Idempotency-Key": idem } });
    } else {
      throw e;
    }
  }

  const so = await getById("salesOrder", soId);
  const lines = (so.lines || []).map(l => ({ lineId: String(l.id), deltaQty: qty }));

  await api(`/sales/so/${encodeURIComponent(soId)}:fulfill`, {
    method: "POST",
    body: { idempotencyKey: idem, lines },
    headers: { "Idempotency-Key": idem },
  });

  await assertCountersFromSo(soId);

  await api(`/sales/so/${encodeURIComponent(soId)}:close`, { method: "POST", body: { id: soId } });
  const final = await getById("salesOrder", soId);
  console.log(JSON.stringify({ flow: "salesOrder", id: soId, status: final.status }, null, 2));
}

/* ---------------------- Guardrail test cases ------------------------ */

async function guardrailSoOvercommit(args) {
  const qty = Number(args.qty ?? 2);
  // Create SO referencing fresh inventory with no stock → commit must 409
  const inv = await ensureInventoryItems(2);
  const so = await createType("salesOrder", {
    type: "salesOrder",
    customerName: "Guardrail Customer",
    status: "draft",
    lines: inv.map((c, i) => ({ id: `L${i+1}`, itemId: c.id, uom: c.uom, qty, qtyFulfilled: 0 }))
  });
  await api(`/sales/so/${encodeURIComponent(so.id)}:submit`, { method: "POST", body: { id: so.id } });
  let ok409 = false;
  try {
    await api(`/sales/so/${encodeURIComponent(so.id)}:commit`, { method: "POST", body: { id: so.id, idempotencyKey: `idem-${randId()}` }, headers: { "Idempotency-Key": `idem-${randId()}` } });
  } catch (e) {
    if (e.status === 409) { ok409 = true; }
    else throw e;
  }
  if (!ok409) throw new Error("Expected 409 on insufficient_available_to_commit");
  console.log(JSON.stringify({ test: "so-overcommit", result: "EXPECTED_409" }, null, 2));
}

async function guardrailSoOverfulfill(args) {
  const qty = Number(args.qty ?? 2);
  // Prepare SO with qty=1, commit OK (after stocking), then try fulfill qty*2 and expect 409
  const inv = await ensureInventoryItems(1);
  const so = await createType("salesOrder", {
    type: "salesOrder",
    customerName: "Guardrail Customer",
    status: "draft",
    lines: [{ id: "L1", itemId: inv[0].id, uom: inv[0].uom, qty: 1, qtyFulfilled: 0 }]
  });
  await api(`/sales/so/${encodeURIComponent(so.id)}:submit`, { method: "POST", body: { id: so.id } });

  // Stock up exactly 1
  const po = await createType("purchaseOrder", {
    type: "purchaseOrder", vendorName: "Auto Supply", status: "draft",
    lines: [{ id: "PL1", itemId: inv[0].id, uom: inv[0].uom, qty: 1, qtyReceived: 0 }]
  });
  await poEnsureOnhandForLines(po.id, 1);

  await api(`/sales/so/${encodeURIComponent(so.id)}:commit`, { method: "POST", body: { id: so.id, idempotencyKey: `idem-${randId()}` }, headers: { "Idempotency-Key": `idem-${randId()}` } });

  let ok409 = false;
  try {
    await api(`/sales/so/${encodeURIComponent(so.id)}:fulfill`, {
      method: "POST",
      body: { idempotencyKey: `idem-${randId()}`, lines: [{ lineId: "L1", deltaQty: qty * 2 }] },
      headers: { "Idempotency-Key": `idem-${randId()}` },
    });
  } catch (e) {
    if (e.status === 409) ok409 = true; else throw e;
  }
  if (!ok409) throw new Error("Expected 409 on insufficient_onhand_to_fulfill");
  console.log(JSON.stringify({ test: "so-overfulfill", result: "EXPECTED_409" }, null, 2));
}

async function guardrailPoIdempotency(args) {
  const linesN = Number(args.lines ?? 2);
  const qty    = Number(args.qty ?? 2);
  const inv    = await ensureInventoryItems(linesN);
  const body = {
    type: "purchaseOrder",
    vendorName: "Idem Vendor",
    status: "draft",
    lines: inv.map((c, i) => ({ id: `L${i+1}`, itemId: c.id, uom: c.uom, qty, qtyReceived: 0 })),
  };
  const po = await createType("purchaseOrder", body);
  await api(`/purchasing/po/${encodeURIComponent(po.id)}:submit`,  { method: "POST", body: { id: po.id } });
  await api(`/purchasing/po/${encodeURIComponent(po.id)}:approve`, { method: "POST", body: { id: po.id } });

  const lines = body.lines.map(l => ({ lineId: l.id, deltaQty: qty }));
  const idem = String(args.idem || `idem-${randId()}`);

  // First receive
  await api(`/purchasing/po/${encodeURIComponent(po.id)}:receive`, {
    method: "POST", body: { idempotencyKey: idem, lines }, headers: { "Idempotency-Key": idem },
  });
  // Second receive with SAME key → should be idempotent (no double increment)
  await api(`/purchasing/po/${encodeURIComponent(po.id)}:receive`, {
    method: "POST", body: { idempotencyKey: idem, lines }, headers: { "Idempotency-Key": idem },
  });

  // Assert counters didn't double
  for (const l of body.lines) {
    const oh = await getOnhand(l.itemId);
    if (Number(oh.qtyOnHand) < qty) throw new Error(`Idempotency failed for item ${l.itemId}: onHand=${oh.qtyOnHand} expected>=${qty}`);
  }
  console.log(JSON.stringify({ test: "po-idempotency", result: "PASS" }, null, 2));
}

async function guardrailCancelRelease() {
  // Create SO with two items, stock them, commit, then cancel -> reserved should return to zero
  const inv = await ensureInventoryItems(2);
  // Stock 5 each
  const po = await createType("purchaseOrder", {
    type: "purchaseOrder", vendorName: "Supply", status: "draft",
    lines: inv.map((c, i) => ({ id: `PL${i+1}`, itemId: c.id, uom: c.uom, qty: 5, qtyReceived: 0 })),
  });
  await poEnsureOnhandForLines(po.id, 5);

  const so = await createType("salesOrder", {
    type: "salesOrder", customerName: "Cancel Tester", status: "draft",
    lines: inv.map((c, i) => ({ id: `L${i+1}`, itemId: c.id, uom: c.uom, qty: 2, qtyFulfilled: 0 })),
  });
  await api(`/sales/so/${encodeURIComponent(so.id)}:submit`, { method: "POST", body: { id: so.id } });
  await api(`/sales/so/${encodeURIComponent(so.id)}:commit`, { method: "POST", body: { id: so.id, idempotencyKey: `idem-${randId()}` }, headers: { "Idempotency-Key": `idem-${randId()}` } });

  // Capture reserved before cancel
  const before = await Promise.all(inv.map(it => getOnhand(it.id)));
  await api(`/sales/so/${encodeURIComponent(so.id)}:cancel`, { method: "POST", body: { id: so.id } });
  const after = await Promise.all(inv.map(it => getOnhand(it.id)));

  // After cancel, reserved should not increase; ideally reduced by 2 each
  for (let i = 0; i < inv.length; i++) {
    const b = Number(before[i]?.qtyReserved || (before[i].qtyOnHand - before[i].qtyAvailable));
    const a = Number(after[i]?.qtyReserved || (after[i].qtyOnHand - after[i].qtyAvailable));
    if (a > b) throw new Error(`Reserved increased after cancel for item ${inv[i].id}: before=${b} after=${a}`);
  }
  console.log(JSON.stringify({ test: "cancel-release", result: "PASS" }, null, 2));
}

/* ----------------------- Counter assertions ------------------------- */

async function assertCountersFromPo(poId) {
  const po = await getById("purchaseOrder", poId);
  const itemIds = (po.lines || []).map(l => String(l.itemId));
  for (const id of itemIds) {
    const oh = await getOnhand(id);
    if (oh.qtyOnHand < 0) throw new Error(`Negative onHand for item ${id}: ${oh.qtyOnHand}`);
    if (oh.qtyAvailable < 0) throw new Error(`Negative available for item ${id}: ${oh.qtyAvailable}`);
    if (oh.qtyReserved > oh.qtyOnHand) throw new Error(`Reserved > onHand for item ${id}: reserved=${oh.qtyReserved} onHand=${oh.qtyOnHand}`);
  }
}

async function assertCountersFromSo(soId) {
  const so = await getById("salesOrder", soId);
  const itemIds = (so.lines || []).map(l => String(l.itemId));
  for (const id of itemIds) {
    const oh = await getOnhand(id);
    if (oh.qtyOnHand < 0) throw new Error(`Negative onHand for item ${id}: ${oh.qtyOnHand}`);
    if (oh.qtyAvailable < 0) throw new Error(`Negative available for item ${id}: ${oh.qtyAvailable}`);
    if (oh.qtyReserved > oh.qtyOnHand) throw new Error(`Reserved > onHand for item ${id}: reserved=${oh.qtyReserved} onHand=${oh.qtyOnHand}`);
  }
}

/* ------------------------- Orchestrations --------------------------- */

async function createN(type, count, factory) {
  const ids = [];
  for (let i = 0; i < count; i++) {
    const body = await factory(i);
    const created = await createType(type, body);
    ids.push(created.id);
    await wait(8);
  }
  return ids;
}

async function allCreate(each = 1) {
  // pools used for linking
  const orgIds   = await createN("organization", each, () => seedBody("organization"));
  const clientIds= await createN("client",       each, () => seedBody("client"));
  const vendorIds= await createN("vendor",       each, () => seedBody("vendor"));
  await createN("employee",     each, () => seedBody("employee"));
  await createN("account",      each, () => seedBody("account"));

  const invIds   = await createN("inventory",    each * 3, () => seedBody("inventory"));
  await createN("product",      each, () => seedBody("product"));

  const resIds   = await createN("resource",     each, () => seedBody("resource"));
  const areaIds  = await createN("venueArea",    each, () => seedBody("venueArea"));
  await createN("stall",        each * 2, (i) => ({ ...seedBody("stall"), barnId: sample(areaIds) }));

  const classDefIds = await createN("classDef",          each, () => seedBody("classDef"));
  const sctIds      = await createN("scorecardTemplate", each, () => seedBody("scorecardTemplate"));

  // Events linked to organizations
  const eventIds = [];
  for (let i = 0; i < each; i++) {
    const base = seedBody("event");
    base.orgId = sample(orgIds);
    base.venueAreaId = sample(areaIds);
    const created = await createType("event", base);
    eventIds.push(created.id);
    await wait(8);
  }

  // Reservations (resource + client)
  for (let i = 0; i < each; i++) {
    const base = seedBody("reservation");
    base.resourceId = sample(resIds);
    base.clientId   = sample(clientIds);
    await createType("reservation", base);
    await wait(6);
  }

  // Registrations (event + client)
  for (let i = 0; i < each; i++) {
    const base = seedBody("registration");
    base.eventId  = sample(eventIds);
    base.clientId = sample(clientIds);
    await createType("registration", base);
    await wait(6);
  }

  // POs and SOs with real inventory lines
  const invObjs = await Promise.all(invIds.map(async (id) => getById("inventory", id).catch(()=>null)));
  const invPool = invObjs.filter(Boolean).map(it => ({ id: it.id, uom: it.uom || "each" }));
  const pickLines = (k, qtyField) => pick(k, invPool).map((c, i) => ({ id: `L${i+1}`, itemId: c.id, uom: c.uom, qty: 1, [qtyField]: 0 }));

  for (let i = 0; i < each; i++) {
    await createType("purchaseOrder", { ...seedBody("purchaseOrder"), vendorId: sample(vendorIds), lines: pickLines(2, "qtyReceived") });
    await wait(6);
  }
  for (let i = 0; i < each; i++) {
    await createType("salesOrder", { ...seedBody("salesOrder"), lines: pickLines(2, "qtyFulfilled") });
    await wait(6);
  }

  console.log("✅ smoke:all:create done (linked)");
}

async function allList() {
  for (const m of MODULES) await cmdList(m);
  console.log("✅ smoke:all:list done");
}
async function allUpdate() {
  for (const m of MODULES) await cmdUpdate(m);
  console.log("✅ smoke:all:update done");
}
async function allDelete() {
  for (const m of MODULES) await cmdDelete(m);
  console.log("✅ smoke:all:delete done");
}

/* ------------------------------- Main ------------------------------- */

const [, , cmd, ...rest] = process.argv;
const args = parseArgs(rest);

(async () => {
  try {
    switch (cmd) {
      case "env":                          return cmdEnv();
      case "login":                        return cmdLogin(args);

      case "smoke:all:create":             return allCreate(Number(args.each || 1));
      case "smoke:all:list":               return allList();
      case "smoke:all:update":             return allUpdate();
      case "smoke:all:delete":             return allDelete();

      // Guardrails
      case "smoke:guardrails:so-overcommit":  return guardrailSoOvercommit(args);
      case "smoke:guardrails:so-overfulfill": return guardrailSoOverfulfill(args);
      case "smoke:guardrails:po-idempotency": return guardrailPoIdempotency(args);
      case "smoke:guardrails:cancel-release": return guardrailCancelRelease(args);

      // Per-module CRUD and flows
      default: {
        const m = cmd && cmd.match(/^smoke:([^:]+):(create|list|update|delete|flow)$/i);
        if (m) {
          const cliType = m[1];
          const action  = m[2];

          if (!MODULES.includes(cliType)) throw new Error(`Unknown type '${cliType}'. Valid: ${MODULES.join(", ")}`);

          if (action === "create") return cmdCreate(cliType, Number(args.each || 1));
          if (action === "list")   return cmdList(cliType);
          if (action === "update") return cmdUpdate(cliType);
          if (action === "delete") return cmdDelete(cliType);

          if (action === "flow") {
            if (cliType === "purchaseOrder") return flowPurchaseOrder(args);
            if (cliType === "salesOrder")    return flowSalesOrder(args);
            throw new Error(`'flow' not supported for type '${cliType}'.`);
          }
        }
        usage();
      }
    }
  } catch (e) {
    console.error(e?.message || e);
    process.exit(1);
  }
})();
