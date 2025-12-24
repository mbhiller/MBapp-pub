#!/usr/bin/env node
import process from "node:process";
import { promises as fsp } from "node:fs";
import path from "node:path";

const API = (process.env.MBAPP_API_BASE || "").replace(/\/+$/, "");
const TOKEN = process.env.MBAPP_BEARER || "";
const TENANT = process.env.MBAPP_TENANT_ID || "";
const SMOKE_RUN_ID = process.env.SMOKE_RUN_ID || "";
const DRY_RUN = process.env.DRY_RUN === "1";
const ALLOW_MISMATCH = process.env.MBAPP_SMOKE_ALLOW_TENANT_MISMATCH === "1";
const DO_DELETE = process.env.MBAPP_SMOKE_CLEANUP === "1" && !DRY_RUN;

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
if (!SMOKE_RUN_ID) {
  console.error("[cleanup] SMOKE_RUN_ID is required");
  process.exit(2);
}

const headers = {
  "accept": "application/json",
  "Content-Type": "application/json",
  "X-Tenant-Id": TENANT,
  "Authorization": `Bearer ${TOKEN}`
};

const repoRoot = process.cwd();
const manifestPath = path.resolve(repoRoot, "ops", "smoke", ".manifests", `${SMOKE_RUN_ID}.json`);

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
  const allow = new Set(["view","workspace","registration","product","inventory","inventoryItem","party","resource","reservation"]);
  return allow.has(String(type||"").trim());
}

function endpointFor(type, id){
  const t = String(type||"").trim();
  if (t === "view") return `/views/${encodeURIComponent(id)}`;
  if (t === "workspace") return `/workspaces/${encodeURIComponent(id)}`;
  if (t === "registration") return `/registrations/${encodeURIComponent(id)}`;
  // objects
  if (["product","inventory","inventoryItem","party","resource","reservation"].includes(t)) return `/objects/${t}/${encodeURIComponent(id)}`;
  return null;
}

async function main(){
  // Load manifest
  let manifest;
  try{
    const raw = await fsp.readFile(manifestPath, "utf8");
    manifest = JSON.parse(raw);
  }catch(err){
    console.error(`[cleanup] Failed to load manifest at "${manifestPath}": ${err?.message||err}`);
    process.exit(2);
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
  for (const e of entries) {
    const type = e?.type;
    const id = e?.id;
    if (!isAllowedType(type)) continue;
    const ep = endpointFor(type, id);
    if (!ep) continue;
    plan.push({ type, id, endpoint: ep });
  }

  if (plan.length === 0) {
    console.log(JSON.stringify({ smokeRunId: SMOKE_RUN_ID, base: API, tenant: TENANT, plannedDeletes: 0 }));
    return;
  }

  console.log(JSON.stringify({ smokeRunId: SMOKE_RUN_ID, base: API, tenant: TENANT, plannedDeletes: plan.length, dryRun: DRY_RUN || !DO_DELETE }));

  if (DRY_RUN || !DO_DELETE) {
    for (const p of plan) {
      console.log(JSON.stringify({ action: "DELETE", endpoint: p.endpoint, type: p.type, id: p.id }));
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
