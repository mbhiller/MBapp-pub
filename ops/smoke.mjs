#!/usr/bin/env node
// ops/smoke.mjs
// Smoke CLI for MBapp: seed/list/update/delete per module + purchase/sales flows.
// Requires Node 18+ (fetch built-in).

import process from "node:process";
import { setTimeout as wait } from "node:timers/promises";
import fs from "node:fs/promises";
import path from "node:path";

/* ------------------------------ Config ------------------------------ */

const API_BASE = (process.env.MBAPP_API_BASE || "").replace(/\/+$/, "");
let   BEARER   = process.env.MBAPP_BEARER || ""; // updated by `login`

// Supported module keys (exact CLI names in your banner)
const MODULES = [
  "client", "account", "employee", "vendor", "product", "inventory",
  "event", "registration", "resource", "reservation",
  "purchaseOrder", "salesOrder",
];

// Map CLI type → objects route type (DB item.type)
const TYPE_MAP = {
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
function pick(n, arr) { const out=[]; for(let i=0;i<n;i++) out.push(arr[i % arr.length]); return out; }

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
    throw new Error(`HTTP ${res.status} ${res.statusText} ${path} — ${msg}\nheaders=${JSON.stringify(hdr)}\nbody=${text}\nrequestId=${rid}`);

    //throw new Error(`HTTP ${res.status} ${res.statusText} ${path} — ${msg}`);
  }
  return json;
}

/* ------------------------- Login / Environment ---------------------- */

function policyPreset(kind) {
  const FULL = {
    "*:read": true,
    "product:read": true, "inventory:read": true, "purchase:read": true, "sales:read": true,
    "event:read": true, "registration:read": true, "resource:read": true, "reservation:read": true,

    "purchase:write": true, "purchase:approve": true, "purchase:receive": true, "purchase:cancel": true, "purchase:close": true,
    "sales:write": true, "sales:commit": true, "sales:fulfill": true, "sales:cancel": true, "sales:close": true,
    "registration:write": true, "reservation:write": true,

    "tools:seed": true, "admin:reset": true,
    "*:write": true, "*:*": true, "*": true,
  };
  const READ = { "*:read": true };
  const MIN  = {
    "*:read": true,
    "purchase:write": true, "sales:write": true,
  };
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
  try {
    await fs.writeFile(tokenPath, token, "utf8");
  } catch {}
  try {
    const line = `MBAPP_BEARER="${token}"\n`;
    await fs.writeFile(envPath, line, "utf8");
  } catch {}
  return { tokenPath, envPath };
}

async function cmdLogin(args) {
  const email   = String(args.email || "dev@example.com");
  const tenant  = String(args.tenant || "DemoTenant");
  const policy  = policyPreset(args.policy || "full");
  const exportOnly = Boolean(args.export);

  // request token
  const res  = await fetch(`${API_BASE}/auth/dev-login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, tenantId: tenant, policy }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`dev-login failed — ${res.status} ${res.statusText}: ${JSON.stringify(data)}`);

  // set for this Node process
  BEARER = data.token;
  process.env.MBAPP_BEARER = BEARER;

  if (exportOnly) {
    // print only the token so caller can capture: $env:MBAPP_BEARER = $(node ops/smoke.mjs login --export)
    console.log(BEARER);
    return;
  }

  // write helper files for reuse
  const paths = await writeTokenFiles(BEARER);

  // fetch and print policy (verifies header works)
  let policyGet = {};
  try {
    policyGet = await api(`/auth/policy`, { method: "GET" });
  } catch (e) {
    policyGet = { error: "policy_fetch_failed", message: e?.message || String(e) };
  }

  // final summary
  console.log(JSON.stringify({
    ok: true,
    email,
    tenant,
    policyRulesPosted: Object.keys(policy).length,
    tokenPreview: BEARER?.slice(0, 20) + "...",
    stored: {
      processEnv: true,
      tokenFile: paths.tokenPath,
      envFile: paths.envPath,
    },
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

/* ------------------------------ Seeding ----------------------------- */

function seedBody(cliType) {
  const t = TYPE_MAP[cliType];
  const n = Date.now();
  switch (cliType) {
    case "client":        return { type: t, name: `Client ${n}`,  status: "active" };
    case "account":       return { type: t, name: `Account ${n}` };
    case "employee":      return { type: t, name: `Employee ${n}` };
    case "vendor":        return { type: t, name: `Vendor ${n}` };
    case "product":       return { type: t, name: `Product ${n}`, sku: `SKU-${n}`, uom: "each", status: "active" };
    case "inventory":     return { type: t, name: `INV ${n}`, sku: `INV-${n}`, uom: "each", status: "active", quantity: 0 };
    case "event":         return { type: t, name: `Event ${n}`, startsAt: new Date().toISOString(), capacity: 100, status: "available" };
    case "registration":  return { type: t, eventId: `evt-${randId()}`, clientId: `cli-${randId()}`, qty: 1, status: "pending" };
    case "resource":      return { type: t, name: `Resource ${n}`, status: "available" };
    case "reservation":   return {
      type: t, resourceId: `res-${randId()}`, clientId: `cli-${randId()}`,
      startsAt: new Date(Date.now()+5*60*1000).toISOString(),
      endsAt:   new Date(Date.now()+65*60*1000).toISOString(),
      status: "pending",
    };
    case "purchaseOrder": return {
      type: t, vendorId: `ven-${randId()}`, vendorName: "Demo Vendor", status: "draft",
      lines: [
        { id: "L1", itemId: `inv-${randId()}`, uom: "each", qty: 2, qtyReceived: 0 },
        { id: "L2", itemId: `inv-${randId()}`, uom: "each", qty: 1, qtyReceived: 0 },
      ],
    };
    case "salesOrder":    return {
      type: t, customerName: "Demo Customer", status: "draft",
      lines: [
        { id: "L1", itemId: `inv-${randId()}`, uom: "each", qty: 1, qtyFulfilled: 0 },
        { id: "L2", itemId: `inv-${randId()}`, uom: "each", qty: 2, qtyFulfilled: 0 },
      ],
    };
    default:              return { type: t, name: `Unknown ${n}` };
  }
}

/* -------------------------- CRUD commands --------------------------- */

async function cmdCreate(cliType, each = 1) {
  const type = TYPE_MAP[cliType];
  if (!type) throw new Error(`Unknown type: ${cliType}`);
  const ids = [];
  for (let i = 0; i < Number(each); i++) {
    const body = seedBody(cliType);
    const created = await createType(type, body);
    ids.push(created.id);
    await wait(20);
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
  await api(`/sales/so/${encodeURIComponent(soId)}:commit`, { method: "POST", body: { id: soId, idempotencyKey: idem }, headers: { "Idempotency-Key": idem } });

  const so = await getById("salesOrder", soId);
  const lines = (so.lines || []).map(l => ({ lineId: String(l.id), deltaQty: qty }));

  await api(`/sales/so/${encodeURIComponent(soId)}:fulfill`, {
    method: "POST",
    body: { idempotencyKey: idem, lines },
    headers: { "Idempotency-Key": idem },
  });

  await api(`/sales/so/${encodeURIComponent(soId)}:close`, { method: "POST", body: { id: soId } });
  const final = await getById("salesOrder", soId);
  console.log(JSON.stringify({ flow: "salesOrder", id: soId, status: final.status }, null, 2));
}

/* ------------------------- Orchestrations --------------------------- */

async function allCreate(each = 1) {
  for (const m of MODULES) await cmdCreate(m, each);
  console.log("✅ smoke:all:create done");
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

      // Per-module CRUD and flows
      default: {
        // Formats: smoke:<type>:create|list|update|delete|flow
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
