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
import * as SOFlow from "./smoke/flows/so/salesOrder-flow.mjs";
import * as POFlow from "./smoke/flows/po/purchaseOrder-flow.mjs";
import * as ResvFlow from "./smoke/flows/reservation-flow.mjs";
import * as ScannerFlow from "./smoke/flows/scanner-flow.mjs";
import * as Guardrails from "./smoke/flows/guardrails.mjs";
import * as LinksReport from "./smoke/reports/product-links.mjs";
import * as ScannerPick from "./smoke/flows/scanner-pick.mjs";
import * as ScannerGuards from "./smoke/flows/scanner-guardrails.mjs";
import * as SOBackorder from "./smoke/flows/so/salesOrder-backorder.mjs";
import * as SORelease   from "./smoke/flows/so/salesOrder-release.mjs";
import * as flowGoodsReceipt from "./smoke/flows/goodsReceipts/goodsReceipt-flow.mjs";
import * as flowSeedAll from "./smoke/flows/seed-all.mjs";
import * as FieldCoverage from "./smoke/reports/field-coverage.mjs";
import * as flowReservations from "./smoke/flows/reservation-flow.mjs";
import * as ResourcesMod from "./smoke/modules/resources-smoke.mjs";
 import * as EventsFlow from "./smoke/flows/events-flow.mjs";
 import * as RegsFlow   from "./smoke/flows/registrations-flow.mjs";
 import * as FieldCov   from "./smoke/reports/field-coverage.mjs";




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
  process.exit(out.result === "PASS" ? 0 : 1);
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
  process.exit(out.result === "PASS" ? 0 : 1);
}

// SCANNER SMOKES ####################################################################
if (cmd === "smoke:scanner:pick") {
  const out = await ScannerPick.run({ qty: Number(arg.qty || 1) });
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.result === "PASS" ? 0 : 1);
}
if (cmd === "smoke:scanner:guardrails") {
  const out = await ScannerGuards.run({ qty: Number(arg.qty || 1) });
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.result === "EXPECTED_409" ? 0 : 1);
}
if (cmd === "smoke:scanner:smartpick") {
  const mod = await import("./smoke/modules/scanner.smartpick.mjs");
  await mod.run(process.argv.slice(3));
}
// BACKORDER   ########################################################################
if (cmd === "smoke:salesOrder:backorder") {
  requireEnv(); const out = await SOBackorder.run(arg);
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.result === "PASS" ? 0 : 1);
}
if (cmd === "smoke:salesOrder:release") {
  requireEnv(); const out = await SORelease.run(arg);
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.result === "PASS" ? 0 : 1);
}
//GOODS RECEIPTS ################################################################
// PO receive flow
if (cmd === "smoke:flow:goods-receipt") {
  const qty = Number(arg.qty ?? 3);
  const code = String(arg.code ?? "gr");
  const out = await flowGoodsReceipt.run({ qty, code });
  return console.log(JSON.stringify(out, null, 2));
}
// RESERVATIONS ###############################################################
if (cmd === "smoke:flow:reservations") {
  const kind = String(arg.kind ?? "stall");   // stall|rv|arena
  const code = String(arg.code ?? "resv");
  const durationMin = Number(arg.duration ?? 120);
  const out = await flowReservations.run({ kind, code, durationMin });
  return console.log(JSON.stringify(out, null, 2));
}
// RESOURCES ########################################################################
if (cmd === "smoke:modules:resources:seed") {
  const each = Number(arg.each ?? 3);
  const kind = String(arg.kind ?? "stall");
  const code = String(arg.code ?? "res");
  const out = await ResourcesMod.createMany({ each, kind, code });
  return console.log(JSON.stringify(out, null, 2));
}
  if (cmd === "smoke:events:flow")         return console.log(JSON.stringify(await EventsFlow.run(argv), null, 2));
  if (cmd === "smoke:registrations:flow")  return console.log(JSON.stringify(await RegsFlow.run(argv),   null, 2));
  if (cmd === "smoke:report:field-coverage") return console.log(JSON.stringify(await FieldCov.run(argv), null, 2));
//SEED ALL ###########################################################################
// seed-all flow
if (cmd === "smoke:flow:seed-all") {
  const lines = Number(arg.lines ?? arg.line ?? 2);
  const qty = Number(arg.qty ?? 3);
  const code = String(arg.code ?? "seed");
  const out = await flowSeedAll.run({ lines, qty, code });
  return console.log(JSON.stringify(out, null, 2));
}
//FIELD COVERAGE   ##############################################################################
// field coverage report
if (cmd === "smoke:report:field-coverage") {
  const typesCSV =
    arg.types ||
    "product,inventory,purchaseOrder,salesOrder,goodsReceipt,salesFulfillment,vendor,client,employee";
  const types = typesCSV.split(",").map((s) => s.trim()).filter(Boolean);
  const limit = Number(arg.limit ?? 200);
  const out = await FieldCoverage.run({ types, limit });
  return console.log(JSON.stringify(out, null, 2));
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
