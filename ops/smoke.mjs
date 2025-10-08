#!/usr/bin/env node
/* ops/smoke.mjs — modular orchestrator */
import { API_BASE, requireEnv, setBearer, writeTokenFiles, ps1SetEnvLine } from "./smoke/core.mjs";
import * as Inventory from "./smoke/modules/inventory-smoke.mjs";
import * as Products from "./smoke/modules/products-smoke.mjs";
import * as Clients from "./smoke/modules/clients-smoke.mjs";
import * as Vendors from "./smoke/modules/vendors-smoke.mjs";
import * as Employees from "./smoke/modules/employees-smoke.mjs";
import * as Resources from "./smoke/modules/resources-smoke.mjs";
import * as Reservations from "./smoke/modules/reservations-smoke.mjs";
import * as SOFlow from "./smoke/flows/salesOrder-flow.mjs";
import * as POFlow from "./smoke/flows/purchaseOrder-flow.mjs";
import * as ResvFlow from "./smoke/flows/reservation-flow.mjs";
import * as ScannerFlow from "./smoke/flows/scanner-flow.mjs";
import * as Guardrails from "./smoke/flows/guardrails.mjs";
import * as LinksReport from "./smoke/reports/product-links.mjs";


function argsToObj(argv) {
  const out = {};
  for (let i=0;i<argv.length;i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const v = (argv[i+1] && !argv[i+1].startsWith("--")) ? argv[++i] : true;
      out[k] = v;
    }
  }
  return out;
}
const DEFAULT_MODULES = ["inventory","products","clients","vendors","employees","resources","reservations"];

function parseCsvList(val, fallback = DEFAULT_MODULES) {
  if (!val) return fallback;
  return String(val).split(",").map(s => s.trim()).filter(Boolean);
}

function parseEachPer(val) {
  // e.g. "inventory:25,products:10,clients:5"
  const map = {};
  if (!val) return map;
  for (const pair of String(val).split(",")) {
    const [k,v] = pair.split(":").map(s => s.trim());
    if (k && v && !Number.isNaN(Number(v))) map[k] = Number(v);
  }
  return map;
}

async function cmdEnv() {
  console.log(JSON.stringify({
    MBAPP_API_BASE: API_BASE || null,
    MBAPP_TENANT_ID: process.env.MBAPP_TENANT_ID || "(jwt)",
    MBAPP_BEARER_SET: Boolean(process.env.MBAPP_BEARER),
    AWS_REGION: process.env.AWS_REGION || null,
  }, null, 2));
}

function policyPreset(name) {
  const n = String(name || "full").toLowerCase();
  const FULL = { "*": true, "*:read": true, "*:write": true, "*:approve": true, "*:commit": true, "*:receive": true, "*:fulfill": true, "tools:seed": true };
  const READ = { "*:read": true };
  const WRITE = { "*:read": true, "*:write": true };
  return n === "read" ? READ : n === "write" ? WRITE : FULL;
}

const MODULE_MAP = { inventory: Inventory, products: Products, clients: Clients, vendors: Vendors, employees: Employees, resources: Resources, reservations: Reservations };

async function main() {
  const [, , cmd, ...rest] = process.argv;
  const arg = argsToObj(rest);

  if (arg.token) setBearer(String(arg.token));

  if (cmd === "env") return cmdEnv();

  if (cmd === "login:dev") {
    const email  = String(arg.email  || "dev@example.com");
    const tenant = String(arg.tenant || process.env.MBAPP_TENANT_ID || "DemoTenant");
    const policy = policyPreset(arg.policy || "full");
    const exportOnly = Boolean(arg.export);

    // no bearer required here
    const res = await fetch(`${API_BASE}/auth/dev-login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, tenantId: tenant, policy }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`dev-login failed — ${res.status} ${res.statusText}: ${JSON.stringify(data)}`);

    const token = data.token || "";
    setBearer(token); // sets process.env.MBAPP_BEARER too

    if (exportOnly) { console.log(token); return; }

    const paths = await writeTokenFiles(token);

    // (Optional) try to fetch policy with the fresh bearer, ignore failures
    let policyGet = {};
    try {
        const r = await fetch(`${API_BASE}/auth/policy`, { headers: { authorization: `Bearer ${token}` }});
        policyGet = await r.json().catch(()=>({}));
    } catch (e) {
        policyGet = { error: "policy_fetch_failed", message: e?.message || String(e) };
    }

    console.log(JSON.stringify({
        ok: true, email, tenant,
        policyRulesPosted: Object.keys(policy).length,
        tokenPreview: token.slice(0, 20) + "...",
        stored: { processEnv: true, tokenFile: paths.tokenPath, envFile: paths.ps1Path || paths.envPath },
        howToSetInCurrentShell: "PowerShell: $env:MBAPP_BEARER = (Get-Content ops/.mb_bearer -Raw).Trim()",
        policy: policyGet,
    }, null, 2));
    return;
    }
  if (cmd === "login") {
    const token = String(arg.token || "");
    if (!token) { console.log("Provide --token <JWT>."); process.exit(2); }
    setBearer(token);
    if (arg["emit-ps1"]) { console.log(ps1SetEnvLine(token)); return; }
    if (arg.save) {
      const paths = await writeTokenFiles(token);
      console.log(JSON.stringify({ ok: true, saved: paths, howToUse: { thisSession: "$env:MBAPP_BEARER = Get-Content ops/.mb_bearer", persistPs1: ". ops/.env.ps1", inlineIEX: 'node ops/smoke.mjs login --token "<JWT>" --emit-ps1 | iex' } }, null, 2));
      return;
    }
    return cmdEnv();
  }

  requireEnv();

  const m = cmd && cmd.match(/^smoke:(inventory|products|clients|vendors|employees|resources|reservations):(create|list|update|delete)$/i);
  if (m) {
    const mod = m[1].toLowerCase();
    const action = m[2].toLowerCase();
    const api = MODULE_MAP[mod];
    if (action === "create") return console.log(JSON.stringify(await api.createMany({ each: Number(arg.each || 1), code: arg.code }), null, 2));
    if (action === "list")   return console.log(JSON.stringify(await api.listAll({ limit: Number(arg.limit || 50) }), null, 2));
    if (action === "update") return console.log(JSON.stringify(await api.updateSome({ limit: Number(arg.limit || 5), code: arg.code }), null, 2));
    if (action === "delete") return console.log(JSON.stringify(await api.deleteAll(), null, 2));
  }

  if (cmd === "smoke:salesOrder:flow") {
    const out = await SOFlow.run({ lines: Number(arg.lines || arg.line || 3), qty: Number(arg.qty || 1), code: arg.code || "so" });
    return console.log(JSON.stringify(out, null, 2));
  }
  if (cmd === "smoke:purchaseOrder:flow") {
    const out = await POFlow.run({ lines: Number(arg.lines || 3), qty: Number(arg.qty || 2), code: arg.code || "po" });
    return console.log(JSON.stringify(out, null, 2));
  }
  if (cmd === "smoke:reservation:flow") {
    const out = await ResvFlow.run({ code: arg.code || "resv", durationMin: Number(arg.durationMin || 90) });
    return console.log(JSON.stringify(out, null, 2));
  }
  if (cmd === "smoke:scanner:basic") {
    const out = await ScannerFlow.basic({ count: Number(arg.count || 3) });
    return console.log(JSON.stringify(out, null, 2));
  }
  if (cmd === "smoke:guardrails:so-overcommit") {
    const out = await Guardrails.soOvercommit({ qty: Number(arg.qty || 2) });
    return console.log(JSON.stringify(out, null, 2));
  }
  if (cmd === "smoke:guardrails:so-overfulfill") {
    const out = await Guardrails.soOverfulfill({ qty: Number(arg.qty || 2) });
    return console.log(JSON.stringify(out, null, 2));
  }
  if (cmd === "smoke:guardrails:cancel-release") {
    const out = await Guardrails.cancelRelease();
    return console.log(JSON.stringify(out, null, 2));
  }
  if (cmd === "smoke:reports:product-links") {
    const out = await LinksReport.run({ limit: Number(arg.limit || 500) });
    return console.log(JSON.stringify(out, null, 2));
  }
  // SALES ORDER RESERVE #############################################################
if (cmd === "smoke:salesOrder:reserve") {
  const mod = await import("./smoke/flows/salesOrder-reserve.mjs");
  const out = await mod.run({
    stock: Number(arg.stock || 5),
    qty: Number(arg.qty || 3),
    code: arg.code || "res",
    strict: Boolean(Number(arg.strict || 0)),   // ← pass strict flag
  });
  console.log(JSON.stringify(out, null, 2));
  return;
}

// SALES ORDER FULFILL ################################################################
if (cmd === "smoke:salesOrder:fulfill") {
  const mod = await import("./smoke/flows/salesOrder-fulfill.mjs");
  const out = await mod.run({
    stock: Number(arg.stock || 5),
    qty: Number(arg.qty || 3),
    code: arg.code || "ful",
    strict: Boolean(Number(arg.strict || 0)),
  });
  console.log(JSON.stringify(out, null, 2));
  return;
}


  // Seed ALL
if (cmd === "smoke:seed:all") {
  requireEnv();
  const modules = parseCsvList(arg.modules);            // optional: --modules inventory,products
  const eachDefault = Number(arg.each || 1);            // default per-module count
  const eachPer = parseEachPer(arg["each-per"]);        // optional overrides
  const code = arg.code || `seed-${Date.now()}`;        // tag suffix

  const out = { code, results: [] };
  for (const m of modules) {
    const api = MODULE_MAP[m];
    if (!api?.createMany) { out.results.push({ module: m, error: "unsupported_or_missing" }); continue; }
    const each = Number.isFinite(eachPer[m]) ? eachPer[m] : eachDefault;
    const res = await api.createMany({ each, code }).catch(e => ({ error: e?.message || String(e) }));
    out.results.push({ module: m, ...res });
  }
  console.log(JSON.stringify(out, null, 2));
  return;
}

// DELETE ALL (requires --yes)
if (cmd === "smoke:delete:all") {
  requireEnv();
  if (!(arg.yes || arg.force)) {
    console.log('Refusing to delete without confirmation. Re-run with --yes (optionally --modules inventory,products)');
    process.exit(2);
  }
  const modules = parseCsvList(arg.modules);
  const out = { deleted: [] };
  for (const m of modules) {
    const api = MODULE_MAP[m];
    if (!api?.deleteAll) { out.deleted.push({ module: m, error: "unsupported_or_missing" }); continue; }
    const res = await api.deleteAll().catch(e => ({ error: e?.message || String(e) }));
    out.deleted.push({ module: m, ...res });
  }
  console.log(JSON.stringify(out, null, 2));
  return;
}

  console.log("Unknown command:", cmd);
}
main().catch(e => { console.error("Smoke failed:", e?.message || String(e)); process.exit(1); });
