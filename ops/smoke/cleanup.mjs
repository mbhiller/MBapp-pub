#!/usr/bin/env node
import process from "node:process";
import { promises as fsp } from "node:fs";
import fs from "node:fs";
import path from "node:path";

const API = (process.env.MBAPP_API_BASE || "").replace(/\/+$/, "");
const TOKEN = process.env.MBAPP_BEARER || "";
const TENANT = process.env.MBAPP_TENANT_ID || "";
let SMOKE_RUN_ID = process.env.SMOKE_RUN_ID || "";
const RAW_DRY_RUN = (process.env.DRY_RUN || "").trim();
const DRY_RUN = Boolean(RAW_DRY_RUN) && RAW_DRY_RUN !== "0"; // Any truthy value (except explicit "0") means dry-run
const ALLOW_MISMATCH = process.env.MBAPP_SMOKE_ALLOW_TENANT_MISMATCH === "1";
const CLEANUP_ENABLED = process.env.MBAPP_SMOKE_CLEANUP === "1";
const DO_DELETE = CLEANUP_ENABLED && !DRY_RUN;

if (!API || !/^https?:\/\//.test(API)) {
  console.error("[cleanup] MBAPP_API_BASE is required and must be a full URL");
  process.exit(2);
}
if (!TOKEN) {
  console.error("[cleanup] MBAPP_BEARER is required");
  process.exit(2);
}
if (!TENANT) {
  console.error("[cleanup] MBAPP_TENANT_ID is required");
  process.exit(2);
}

const headers = {
  "accept": "application/json",
  "Content-Type": "application/json",
  "X-Tenant-Id": TENANT,
  "Authorization": `Bearer ${TOKEN}`
};

const repoRoot = process.cwd();
const manifestDir = path.resolve(repoRoot, "ops", "smoke", ".manifests");

// Helper: resolve "latest" to the most recently modified manifest
function resolveLatestManifest() {
  try {
    if (!fs.existsSync(manifestDir)) {
      console.error(`[cleanup] Manifest directory does not exist: ${manifestDir}`);
      process.exit(2);
    }
    const files = fs.readdirSync(manifestDir).filter(f => f.endsWith(".json"));
    if (files.length === 0) {
      console.error(`[cleanup] No manifest files found in ${manifestDir}`);
      process.exit(2);
    }
    // Find most recently modified file
    let latest = files[0];
    let latestTime = fs.statSync(path.join(manifestDir, latest)).mtime.getTime();
    for (const f of files.slice(1)) {
      const time = fs.statSync(path.join(manifestDir, f)).mtime.getTime();
      if (time > latestTime) {
        latest = f;
        latestTime = time;
      }
    }
    const resolvedId = latest.replace(/\.json$/, "");
    const fullPath = path.join(manifestDir, latest);
    console.log(`[cleanup] Using latest manifest: ${latest} (${fullPath})`);
    return resolvedId;
  } catch (err) {
    console.error(`[cleanup] Failed to resolve latest manifest: ${err?.message || err}`);
    process.exit(2);
  }
}

// Resolve SMOKE_RUN_ID if "latest"
if (!SMOKE_RUN_ID || SMOKE_RUN_ID === "latest") {
  SMOKE_RUN_ID = resolveLatestManifest();
}

const manifestPath = path.resolve(manifestDir, `${SMOKE_RUN_ID}.json`);

function decodeJwtTenant(bearer){
  try{
    const tok = String(bearer||"").trim();
    const parts = tok.split(".");
    if(parts.length < 2) return null;
    let b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    const json = Buffer.from(b64, "base64").toString("utf8");
    const payload = JSON.parse(json);
    const t = payload?.mbapp?.tenantId;
    return t ? String(t) : null;
  }catch{ return null; }
}

function isAllowedType(type){
  const allow = new Set([
    "view","workspace","registration",
    "product","inventory","inventoryItem","party","partyRole",
    "resource","reservation",
    "salesOrder","purchaseOrder","backorderRequest"
  ]);
  return allow.has(String(type||"").trim());
}

function endpointFor(type, id){
  const t = String(type||"").trim();
  // Sprint III endpoints
  if (t === "view") return `/views/${encodeURIComponent(id)}`;
  if (t === "workspace") return `/workspaces/${encodeURIComponent(id)}`;
  if (t === "registration") return `/registrations/${encodeURIComponent(id)}`;
  
  // /objects/{type}/{id} endpoints
  const objectTypes = [
    "product","inventory","inventoryItem","party","partyRole",
    "resource","reservation",
    "salesOrder","purchaseOrder","backorderRequest"
  ];
  if (objectTypes.includes(t)) return `/objects/${t}/${encodeURIComponent(id)}`;
  
  return null; // No endpoint mapping (will be skipped)
}

async function main(){
  let performDelete = DO_DELETE;
  // Load manifest
  let manifest;
  try{
    const raw = await fsp.readFile(manifestPath, "utf8");
    manifest = JSON.parse(raw);
  }catch(err){
    console.error(`[cleanup] Failed to load manifest at "${manifestPath}": ${err?.message||err}`);
    process.exit(2);
  }

  // Gate: real deletes require explicit opt-in; otherwise run in safe dry-run mode
  if (!DRY_RUN && !CLEANUP_ENABLED) {
    performDelete = false;
    console.warn("[cleanup] Safe mode: set MBAPP_SMOKE_CLEANUP=1 to actually delete.");
  }

  // Tenant guards
  if (!ALLOW_MISMATCH && manifest?.jwtTenant && manifest?.tenantHeader && manifest.jwtTenant !== manifest.tenantHeader) {
    console.error(`[cleanup] Tenant mismatch: jwtTenant=${manifest.jwtTenant} vs tenantHeader=${manifest.tenantHeader}. Set MBAPP_SMOKE_ALLOW_TENANT_MISMATCH=1 to override.`);
    process.exit(2);
  }

  // Hard stop: refuse any /tools/gc/* routes
  const hasGC = Array.isArray(manifest?.entries) && manifest.entries.some(e => String(e?.route||"").startsWith("/tools/gc/"));
  if (hasGC) {
    console.error("[cleanup] Manifest contains GC routes. Cleanup refuses to call /tools/gc/* endpoints.");
  }

  const entries = Array.isArray(manifest?.entries) ? manifest.entries : [];
  const plan = [];
  const skips = [];
  
  for (const e of entries) {
    const type = e?.type;
    const id = e?.id;
    
    // Skip if type not in allowlist
    if (!isAllowedType(type)) {
      skips.push({ type, id, reason: "type-not-in-allowlist" });
      continue;
    }
    
    // Skip if no endpoint mapping
    const ep = endpointFor(type, id);
    if (!ep) {
      skips.push({ type, id, reason: "no-delete-endpoint" });
      continue;
    }
    
    plan.push({ type, id, endpoint: ep });
  }

  // Summary output
  const summary = {
    smokeRunId: SMOKE_RUN_ID,
    tenant: TENANT,
    manifestEntries: entries.length,
    plannedDeletes: plan.length,
    plannedSkips: skips.length,
    dryRun: DRY_RUN || !performDelete
  };
  console.log(JSON.stringify(summary));

  // DRY_RUN: print planned actions and skips
  if (DRY_RUN || !performDelete) {
    if (plan.length > 0) {
      console.log(`\n--- Planned Deletes (${plan.length}) ---`);
      for (const p of plan) {
        console.log(JSON.stringify({ action: "DELETE", endpoint: p.endpoint, type: p.type, id: p.id }));
      }
    }
    
    if (skips.length > 0) {
      console.log(`\n--- Planned Skips (${skips.length}) ---`);
      for (const s of skips) {
        console.log(JSON.stringify({ action: "SKIP", type: s.type, id: s.id, reason: s.reason }));
      }
    }
    
    if (plan.length === 0 && skips.length === 0) {
      console.log("\nNo entries in manifest to process.");
    }
    
    return;
  }

  // Execute deletions
  let success = 0; let fail = 0;
  for (const p of plan) {
    try{
      const res = await fetch(API + p.endpoint, { method: "DELETE", headers });
      if (res.ok) {
        success++;
        console.log(JSON.stringify({ deleted: true, endpoint: p.endpoint, type: p.type, id: p.id, status: res.status }));
      } else {
        fail++;
        const body = await res.json().catch(()=>({}));
        console.log(JSON.stringify({ deleted: false, endpoint: p.endpoint, type: p.type, id: p.id, status: res.status, body }));
      }
    }catch(err){
      fail++;
      console.log(JSON.stringify({ deleted: false, endpoint: p.endpoint, type: p.type, id: p.id, error: err?.message||String(err) }));
    }
  }

  console.log(JSON.stringify({ smokeRunId: SMOKE_RUN_ID, result: "done", deleted: success, failed: fail }));
}

main().catch(err=>{ console.error(`[cleanup] Fatal: ${err?.message||err}`); process.exit(1); });
