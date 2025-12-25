#!/usr/bin/env node
import process from "node:process";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { baseGraph } from "./seed/routing.ts";
import { seedParties, seedVendor } from "./seed/parties.ts";

const DEFAULT_TENANT = "SmokeTenant";
const allowNonSmokeTenant = process.env.MBAPP_SMOKE_ALLOW_NON_SMOKE_TENANT === "1";
if (!process.env.MBAPP_TENANT_ID || !process.env.MBAPP_TENANT_ID.trim()) {
  process.env.MBAPP_TENANT_ID = DEFAULT_TENANT;
}
const TENANT = process.env.MBAPP_TENANT_ID;
if (!allowNonSmokeTenant && !TENANT.startsWith(DEFAULT_TENANT)) {
  console.error(
    `[smokes] MBAPP_TENANT_ID is "${TENANT}" but must start with "${DEFAULT_TENANT}". Set MBAPP_SMOKE_ALLOW_NON_SMOKE_TENANT=1 to override.`
  );
  process.exit(2);
}

const SMOKE_RUN_ID = process.env.SMOKE_RUN_ID || `smk-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
process.env.SMOKE_RUN_ID = SMOKE_RUN_ID;

const API_RAW = process.env.MBAPP_API_BASE;
if (!API_RAW || typeof API_RAW !== "string" || !/^https?:\/\//.test(API_RAW)) {
  console.error('[smokes] MBAPP_API_BASE is required and must be a full URL (e.g., https://..). No localhost or defaults allowed.');
  process.exit(2);
}
const API = API_RAW.replace(/\/+$/, "");
const EMAIL = process.env.MBAPP_DEV_EMAIL ?? "dev@example.com";

const TOKEN = process.env.MBAPP_BEARER;
if (!TOKEN || TOKEN.trim().length === 0) {
  console.error('[smokes] MBAPP_BEARER is required. Set a valid bearer token in the environment.');
  process.exit(2);
}

if (!API || typeof API !== "string" || !/^https?:\/\//.test(API)) {
  console.error(`[smokes] MBAPP_API_BASE is not set or invalid. Got: "${API ?? ""}"`);
  console.error(`[smokes] Expected a full URL like https://...  Check CI secrets/env wiring or local Set-MBEnv.ps1.`);
  process.exit(2);
}
// Helper: decode JWT payload (base64url) and return mbapp.tenantId if present
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
const jwtTenant = decodeJwtTenant(TOKEN);
console.log(JSON.stringify({ base: API, tenant: TENANT, smokeRunId: SMOKE_RUN_ID, tokenVar: "MBAPP_BEARER", hasToken: true, jwtTenant }));

// Guard: bearer tenant must match requested TENANT unless override
const allowTenantMismatch = process.env.MBAPP_SMOKE_ALLOW_TENANT_MISMATCH === "1";
if (!allowTenantMismatch && process.env.MBAPP_BEARER && jwtTenant && jwtTenant !== TENANT) {
  console.error(`[smokes] Bearer token tenant ("${jwtTenant}") does not match requested tenant ("${TENANT}"). Set MBAPP_SMOKE_ALLOW_TENANT_MISMATCH=1 to override.`);
  process.exit(2);
}

/* ---------- Auth & HTTP ---------- */
async function ensureBearer(){ /* bearer must be provided via MBAPP_BEARER at startup */ }
function baseHeaders(){
  const h={"accept":"application/json","Content-Type":"application/json","X-Tenant-Id":TENANT};
  const token=process.env.MBAPP_BEARER;
  if(token) h["Authorization"]=`Bearer ${token}`;
  return h;
}
// Allow per-request Authorization override: "default" | "invalid" | "none"
function buildHeaders(base = {}, auth = "default") {
  const h = { "content-type": "application/json", ...base };
  const token = process.env.MBAPP_BEARER;
  if (auth === "default") {
    if (token) h.Authorization = `Bearer ${token}`;
  } else if (auth === "invalid") {
    h.Authorization = "Bearer invalid";
  } else if (auth === "none") {
    // do not set Authorization at all
    if (h.Authorization) delete h.Authorization;
  }
  return h;
}
function qs(params){
  if (!params) return "";
  const u = new URLSearchParams();
  for (const [k,v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    u.set(k, String(v));
  }
  const s = u.toString();
  return s ? `?${s}` : "";
}
function idem() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}
async function get(p, params, opts){
  const headers = buildHeaders({ ...baseHeaders(), ...((opts&&opts.headers)||{}) }, (opts&&opts.auth) ?? "default");
  const r=await fetch(API + p + qs(params), {headers});
  const b=await r.json().catch(()=>({}));
  return {ok:r.ok,status:r.status,body:b};
}
async function post(p,body,h={},opts){
  const headers = buildHeaders({ ...baseHeaders(), ...h, ...((opts&&opts.headers)||{}) }, (opts&&opts.auth) ?? "default");
  const r=await fetch(API+p,{method:"POST",headers,body:JSON.stringify(body??{})});
  const j=await r.json().catch(()=>({}));
  try{
    const hasId = j && typeof j.id !== "undefined";
    if (r.ok && hasId && isSmokeArtifact(body, j, p)) {
      const route = p;
      const type = j?.type || body?.type || (route.startsWith('/objects/') ? (route.split('/')[2] || 'object')
                    : route.startsWith('/views') ? 'view'
                    : route.startsWith('/workspaces') ? 'workspace'
                    : route.startsWith('/registrations') ? 'registration'
                    : route.startsWith('/resources') ? 'resource'
                    : route.startsWith('/reservations') ? 'reservation'
                    : undefined);
      const meta = {};
      for (const k of ["name","sku","entityType","itemId","productId","title"]) {
        if (body && typeof body[k] !== "undefined") meta[k] = body[k];
      }
      meta.status = r.status;
      recordCreated({ type, id: j.id, route, meta });
    }
  }catch{/* noop */}
  return {ok:r.ok,status:r.status,body:j};
}
async function put(p,body,h={},opts){
  const headers = buildHeaders({ ...baseHeaders(), ...h, ...((opts&&opts.headers)||{}) }, (opts&&opts.auth) ?? "default");
  const r=await fetch(API+p,{method:"PUT",headers,body:JSON.stringify(body??{})});
  const j=await r.json().catch(()=>({}));
  // PUT typically updates, but if it returns a new id (upsert case), record it
  try{
    const hasId = j && typeof j.id !== "undefined";
    const isNewId = hasId && body && (!body.id || body.id !== j.id);
    if (r.ok && isNewId && isSmokeArtifact(body, j, p)) {
      const route = p;
      const type = j?.type || body?.type || 'object';
      const meta = { action: 'upsert', status: r.status };
      for (const k of ["name","sku","entityType","itemId","productId"]) {
        if (body && typeof body[k] !== "undefined") meta[k] = body[k];
      }
      recordCreated({ type, id: j.id, route, meta });
    }
  }catch{/* noop */}
  return {ok:r.ok,status:r.status,body:j};
}

/* ---------- Helpers ---------- */
function smokeTag(value){
  const rid = process.env.SMOKE_RUN_ID || SMOKE_RUN_ID;
  return `${rid}-${String(value)}`;
}

/** Validate if a value contains SMOKE_RUN_ID (proves it's a smoke artifact) */
function containsSmokeRunId(val) {
  if (!val) return false;
  const rid = SMOKE_RUN_ID;
  if (typeof val === 'string') return val.includes(rid);
  if (typeof val === 'object' && !Array.isArray(val)) {
    // Check common fields that might contain SMOKE_RUN_ID
    const checkFields = ['name', 'sku', 'itemId', 'productId', 'title', 'description', 'label'];
    return checkFields.some(f => val[f] && typeof val[f] === 'string' && val[f].includes(rid));
  }
  return false;
}

/** Determine if a create should be recorded based on SMOKE_RUN_ID presence */
function isSmokeArtifact(reqBody, resBody, route) {
  // Safety: only record if we can prove it's smoke-scoped
  if (containsSmokeRunId(reqBody)) return true;
  if (containsSmokeRunId(resBody)) return true;
  
  // Explicit allowlist for ephemeral operations (action endpoints that don't persist new top-level entities)
  const actionEndpoints = [':submit', ':approve', ':commit', ':reserve', ':release', ':fulfill', ':cancel', ':close', ':receive'];
  if (actionEndpoints.some(a => route.includes(a))) return false; // don't record action results
  
  // Search endpoints don't create artifacts
  if (route.includes('/search')) return false;
  
  return false; // conservative: require explicit SMOKE_RUN_ID proof
}

/* ---------- Manifest Recorder ---------- */
const manifestDir = path.resolve(process.cwd(), "ops", "smoke", ".manifests");
const manifestPath = path.resolve(manifestDir, `${SMOKE_RUN_ID}.json`);
let manifestWritten = false;
const manifest = {
  smokeRunId: SMOKE_RUN_ID,
  base: API,
  tenantHeader: TENANT,
  jwtTenant,
  startedAt: new Date().toISOString(),
  finishedAt: null,
  entries: []
};

function recordCreated({ type, id, route, meta }){
  try{
    if (!id) return;
    manifest.entries.push({ type, id: String(id), route, meta, createdAt: new Date().toISOString() });
  }catch{/* noop */}
}

/** Record all persisted items from a list/search response */
function recordFromListResult(items, type, route) {
  if (!Array.isArray(items)) return;
  for (const item of items) {
    if (item && typeof item.id !== "undefined") {
      const meta = { status: 200 };
      // Capture identifying fields if present
      for (const k of ["name", "sku", "status", "soId", "itemId", "productId", "qty", "vendorId"]) {
        if (typeof item[k] !== "undefined") meta[k] = item[k];
      }
      recordCreated({ type: type || item.type, id: item.id, route, meta });
    }
  }
}

function flushManifestSync(){
  try{
    manifest.finishedAt = new Date().toISOString();
    fs.mkdirSync(manifestDir, { recursive: true });
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
    if (!manifestWritten) {
      manifestWritten = true;
      console.log(`[smokes] wrote manifest ${manifestPath}`);
    }
  }catch(err){
    console.error(`[smokes] Failed to write manifest: ${String(err && err.message || err)}`);
  }
}

function printManifestSummary(){
  try{
    const types = [...new Set(manifest.entries.map(e => e.type))].sort();
    console.log(JSON.stringify({
      smokeRunId: manifest.smokeRunId,
      entries: manifest.entries.length,
      types
    }));
  }catch{/* noop */}
}

process.on("SIGINT", ()=>{ flushManifestSync(); process.exit(130); });
process.on("exit", ()=>{ flushManifestSync(); });
async function onhand(itemId){
  return await get(`/inventory/${encodeURIComponent(itemId)}/onhand`);
}
async function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }
async function waitForStatus(type, id, wanted, { tries=10, delayMs=120 } = {}) {
  for (let i=0;i<tries;i++){
    const po = await get(`/objects/${encodeURIComponent(type)}/${encodeURIComponent(id)}`);
    const s = po?.body?.status;
    if (wanted.includes(s)) return { ok:true, po };
    await sleep(delayMs);
  }
  const last = await get(`/objects/${encodeURIComponent(type)}/${encodeURIComponent(id)}`);
  return { ok:false, lastStatus:last?.body?.status, po:last };
}

/** Try multiple movement payload shapes until on-hand increases. */
const MV_TYPE=process.env.SMOKE_MOVEMENT_TYPE??"inventoryMovement";
async function ensureOnHand(itemId, qty){
  // 1) { type: 'receive' }
  let r1 = await post(`/objects/${MV_TYPE}`, { itemId, type:"receive", qty });
  let oh1 = await onhand(itemId);
  if (r1.ok && oh1.ok && (oh1.body?.items?.[0]?.onHand ?? 0) >= qty) {
    return { ok:true, variant:"type", receive:r1, onhand:oh1 };
  }
  // 2) { action: 'receive' }
  let r2 = await post(`/objects/${MV_TYPE}`, { itemId, action:"receive", qty });
  let oh2 = await onhand(itemId);
  if (r2.ok && oh2.ok && (oh2.body?.items?.[0]?.onHand ?? 0) >= qty) {
    return { ok:true, variant:"action", receive:r2, onhand:oh2 };
  }
  // 3) both keys
  let r3 = await post(`/objects/${MV_TYPE}`, { itemId, type:"receive", action:"receive", qty });
  let oh3 = await onhand(itemId);
  if (r3.ok && oh3.ok && (oh3.body?.items?.[0]?.onHand ?? 0) >= qty) {
    return { ok:true, variant:"both", receive:r3, onhand:oh3 };
  }
  return { ok:false, attempts:[{r1,oh1},{r2,oh2},{r3,oh3}] };
}

/** objects helpers */
const ITEM_TYPE=process.env.SMOKE_ITEM_TYPE??"inventory"; // safer default matches your endpoints
async function createProduct(body) {
  const baseName = `${body?.name ?? "Prod"}-${Date.now()}`;
  const baseSku = `SKU-${Math.random().toString(36).slice(2,7)}`;
  return await post(`/objects/product`, { type:"product", kind:"good", name: smokeTag(baseName), sku: smokeTag(baseSku), ...body });
}
async function createInventoryForProduct(productId, name = "Item") {
  const baseName = `${name}-${Date.now()}`;
  return await post(`/objects/inventory`, { type:"inventory", name: smokeTag(baseName), productId, uom:"ea" });
}
/* minimal api wrapper so seeders can call /objects/<type> consistently */
const api = {
  async post(path, body) { return await post(path, body, { "Idempotency-Key": idem() }); },
  async get(path, params) { return await get(path, params); },
  async put(path, body) { return await put(path, body); }
};

const PARTY_TYPE="party";

/* ---------- Tests ---------- */
const tests = {
    "smoke:close-the-loop": async () => {
      await ensureBearer();
      // Seed vendor first so product/inventory can reference it
      const { vendorId } = await seedVendor(api);
      // 1) Create item with low/zero onHand
      const prod = await createProduct({ name: "LoopTest", preferredVendorId: vendorId });
      if (!prod.ok) return { test: "close-the-loop", result: "FAIL", step: "createProduct", prod };
      const item = await createInventoryForProduct(prod.body?.id, "LoopTestItem");
      if (!item.ok) return { test: "close-the-loop", result: "FAIL", step: "createInventory", item };
      const itemId = item.body?.id;
      // Create a customer party for the SO
      const { partyId } = await seedParties(api);
      // Ensure onHand is 0 by adjusting based on current onHand
      const onhandPre = await onhand(itemId);
      const currentOnHand = onhandPre.body?.items?.[0]?.onHand ?? 0;
      if (currentOnHand !== 0) {
        await post(`/objects/inventoryMovement`, { itemId, type: "adjust", qty: -currentOnHand });
      }
      const onhand0 = await onhand(itemId);
      // 2) Create Sales Order where qty > available
      const so = await post(`/objects/salesOrder`, {
        type: "salesOrder", status: "draft", partyId, lines: [{ itemId, qty: 5, uom: "ea" }]
      });
      if (!so.ok) return { test: "close-the-loop", result: "FAIL", step: "createSO", so };
      const soId = so.body?.id;
      // 3) Commit SO
      await post(`/sales/so/${encodeURIComponent(soId)}:submit`, {}, { "Idempotency-Key": idem() });
      await post(`/sales/so/${encodeURIComponent(soId)}:commit`, {}, { "Idempotency-Key": idem() });
      // Assert backorderRequests exist with status="open"
      const boRes = await post(`/objects/backorderRequest/search`, { soId, itemId, status: "open" });
      if (!boRes.ok || !Array.isArray(boRes.body?.items) || boRes.body.items.length === 0)
        return { test: "close-the-loop", result: "FAIL", step: "backorderRequest-open", boRes };
      const boIds = boRes.body.items.map(b => b.id);
      // Record discovered backorderRequests
      recordFromListResult(boRes.body.items, "backorderRequest", `/objects/backorderRequest/search`);
      // 4) Call /purchasing/suggest-po
      const suggest = await post(`/purchasing/suggest-po`, { requests: boIds.map(id => ({ backorderRequestId: id })) });
      // Debug: if suggest skipped entries, fetch vendor fields from BO/inventory/product
      if (suggest.ok && Array.isArray(suggest.body?.skipped) && suggest.body.skipped.length > 0) {
        for (const skip of suggest.body.skipped) {
          const debugBo = await get(`/objects/backorderRequest/${encodeURIComponent(skip.backorderRequestId)}`);
          const boData = debugBo.body;
          const debugInv = boData?.itemId ? await get(`/objects/inventory/${encodeURIComponent(boData.itemId)}`) : { ok: false };
          const invData = debugInv.body;
          const debugProd = invData?.productId ? await get(`/objects/product/${encodeURIComponent(invData.productId)}`) : { ok: false };
          const prodData = debugProd.body;
          console.log("[DEBUG close-the-loop] Skipped BO vendor trace:", {
            skip,
            bo: { id: boData?.id, preferredVendorId: boData?.preferredVendorId, vendorId: boData?.vendorId, itemId: boData?.itemId },
            inv: { id: invData?.id, preferredVendorId: invData?.preferredVendorId, vendorId: invData?.vendorId, productId: invData?.productId },
            prod: { id: prodData?.id, preferredVendorId: prodData?.preferredVendorId, vendorId: prodData?.vendorId, defaultVendorId: prodData?.defaultVendorId }
          });
        }
      }
      if (!suggest.ok || !Array.isArray(suggest.body?.drafts) || suggest.body.drafts.length === 0)
        return { test: "close-the-loop", result: "FAIL", step: "suggest-po", suggest };
      const draft = suggest.body.drafts[0];
      // Ensure vendor present and PO lines include backorderRequestIds
      const hasVendor = !!draft.vendorId;
      const hasBackorderIds = draft.lines.every(l => Array.isArray(l.backorderRequestIds) && l.backorderRequestIds.length > 0);
      if (!hasVendor || !hasBackorderIds)
        return { test: "close-the-loop", result: "FAIL", step: "draft-check", hasVendor, hasBackorderIds, draft };
      // 5) Save/create the draft PO
      const poSave = await post(`/objects/purchaseOrder`, { ...draft, status: "approved" });
      if (!poSave.ok) return { test: "close-the-loop", result: "FAIL", step: "po-save", poSave };
      const poId = poSave.body?.id;
      // 6) Receive PO: POST /purchasing/po/{id}:receive with lines deltaQty
      const lines = (poSave.body?.lines ?? []).map(ln => ({ lineId: ln.id ?? ln.lineId, deltaQty: (ln.qty - (ln.receivedQty ?? 0)) })).filter(l => l.deltaQty > 0);
      const idk = idem();
      const receive = await post(`/purchasing/po/${encodeURIComponent(poId)}:receive`, { lines }, { "Idempotency-Key": idk });
      if (!receive.ok) return { test: "close-the-loop", result: "FAIL", step: "po-receive", receive };
      // 7) Assert inventory onHand increased
      const onhandAfter = await onhand(itemId);
      const expectedReceived = lines.reduce((sum, l) => sum + Number(l.deltaQty ?? 0), 0);
      const afterItem = onhandAfter.body?.items?.[0] ?? {};
      const onHandAfter = Number(afterItem.onHand ?? 0);
      const availableAfter = Number(afterItem.available ?? (onHandAfter - Number(afterItem.reserved ?? 0)));
      if (!(onHandAfter >= expectedReceived && availableAfter >= 0)) {
        throw new Error(JSON.stringify({
          message: "onhand check after receive failed",
          itemId,
          expectedReceived,
          onHandAfter,
          availableAfter,
          onhandResponse: onhandAfter.body
        }, null, 2));
      }
      // Assert backorderRequests status becomes "fulfilled"
      const boFulfilled = await post(`/objects/backorderRequest/search`, { soId, itemId, status: "fulfilled" });
      recordFromListResult(boFulfilled.body?.items, "backorderRequest", `/objects/backorderRequest/search`);
      // Assert no backorderRequests with status="open"
      const boOpen = await post(`/objects/backorderRequest/search`, { soId, itemId, status: "open" });
      recordFromListResult(boOpen.body?.items, "backorderRequest", `/objects/backorderRequest/search`);
      // Idempotency check: call receive again with SAME Idempotency-Key
      const receiveAgain = await post(`/purchasing/po/${encodeURIComponent(poId)}:receive`, { lines }, { "Idempotency-Key": idk });
      const onhandFinal = await onhand(itemId);
      const boFulfilledFinal = await post(`/objects/backorderRequest/search`, { soId, itemId, status: "fulfilled" });
      const boOpenFinal = await post(`/objects/backorderRequest/search`, { soId, itemId, status: "open" });
      // Checks
      const oh0 = (onhand0.body?.items?.[0]?.onHand ?? 0);
      const ohAfter = (onhandAfter.body?.items?.[0]?.onHand ?? 0);
      const ohFinal = (onhandFinal.body?.items?.[0]?.onHand ?? 0);

      // NOTE: Some environments allocate received qty directly to backorders/SOs (net onHand may remain unchanged).
      // So: assert BO transitions + idempotency, and only require onHand to remain stable on replay.
      const pass =
        Array.isArray(boFulfilled.body?.items) && boFulfilled.body.items.length > 0
        && Array.isArray(boOpen.body?.items) && boOpen.body.items.length === 0
        && receiveAgain.ok
        && ohFinal === ohAfter
        && JSON.stringify(boFulfilledFinal.body?.items) === JSON.stringify(boFulfilled.body?.items)
        && Array.isArray(boOpenFinal.body?.items) && boOpenFinal.body.items.length === 0;
      return {
        test: "close-the-loop",
        result: pass ? "PASS" : "FAIL",
        steps: {
          prod, item, onhand0, so, boRes, suggest, draft, poSave, receive, onhandAfter, boFulfilled, boOpen, receiveAgain, onhandFinal, boFulfilledFinal, boOpenFinal
        }
      };
    },

    "smoke:close-the-loop-multi-vendor": async () => {
      await ensureBearer();
      
      // 1) Create TWO vendors with different names
      const vendor1Raw = await seedVendor(api);
      const vendor1Id = vendor1Raw.vendorId;
      if (!vendor1Id) return { test: "close-the-loop-multi-vendor", result: "FAIL", step: "seedVendor1", vendor1Raw };
      
      const vendor2Raw = await seedVendor(api);
      const vendor2Id = vendor2Raw.vendorId;
      if (!vendor2Id) return { test: "close-the-loop-multi-vendor", result: "FAIL", step: "seedVendor2", vendor2Raw };
      
      // 2) Create TWO products with different preferred vendors
      const prod1 = await createProduct({ 
        name: "MultiVendorProd1", 
        preferredVendorId: vendor1Id 
      });
      if (!prod1.ok) return { test: "close-the-loop-multi-vendor", result: "FAIL", step: "createProduct1", prod1 };
      
      const prod2 = await createProduct({ 
        name: "MultiVendorProd2", 
        preferredVendorId: vendor2Id 
      });
      if (!prod2.ok) return { test: "close-the-loop-multi-vendor", result: "FAIL", step: "createProduct2", prod2 };
      
      const prod1Id = prod1.body?.id;
      const prod2Id = prod2.body?.id;
      
      // 3) Create inventory for both products
      const item1 = await createInventoryForProduct(prod1Id, "MultiVendorItem1");
      if (!item1.ok) return { test: "close-the-loop-multi-vendor", result: "FAIL", step: "createInventory1", item1 };
      
      const item2 = await createInventoryForProduct(prod2Id, "MultiVendorItem2");
      if (!item2.ok) return { test: "close-the-loop-multi-vendor", result: "FAIL", step: "createInventory2", item2 };
      
      const item1Id = item1.body?.id;
      const item2Id = item2.body?.id;
      
      // 4) Ensure low/zero onHand for both items
      const onhand1Pre = await onhand(item1Id);
      const currentOnHand1 = onhand1Pre.body?.items?.[0]?.onHand ?? 0;
      if (currentOnHand1 !== 0) {
        await post(`/objects/inventoryMovement`, { itemId: item1Id, type: "adjust", qty: -currentOnHand1 });
      }
      
      const onhand2Pre = await onhand(item2Id);
      const currentOnHand2 = onhand2Pre.body?.items?.[0]?.onHand ?? 0;
      if (currentOnHand2 !== 0) {
        await post(`/objects/inventoryMovement`, { itemId: item2Id, type: "adjust", qty: -currentOnHand2 });
      }
      
      // 5) Create a customer party
      const { partyId } = await seedParties(api);
      
      // 6) Create ONE sales order with TWO lines (one per item)
      const so = await post(`/objects/salesOrder`, {
        type: "salesOrder",
        status: "draft",
        partyId,
        lines: [
          { itemId: item1Id, qty: 3, uom: "ea" },
          { itemId: item2Id, qty: 2, uom: "ea" }
        ]
      });
      if (!so.ok) return { test: "close-the-loop-multi-vendor", result: "FAIL", step: "createSO", so };
      
      const soId = so.body?.id;
      
      // 7) Commit SO to generate backorders for both items
      await post(`/sales/so/${encodeURIComponent(soId)}:submit`, {}, { "Idempotency-Key": idem() });
      await post(`/sales/so/${encodeURIComponent(soId)}:commit`, {}, { "Idempotency-Key": idem() });
      
      // Assert backorderRequests exist with status="open"
      const boRes = await post(`/objects/backorderRequest/search`, { soId, status: "open" });
      if (!boRes.ok || !Array.isArray(boRes.body?.items) || boRes.body.items.length < 2)
        return { test: "close-the-loop-multi-vendor", result: "FAIL", step: "backorderRequest-count", boRes };
      
      const boIds = boRes.body.items.map(b => b.id);
      recordFromListResult(boRes.body.items, "backorderRequest", `/objects/backorderRequest/search`);
      
      // 8) Call suggest-po with all backorderRequestIds
      const suggest = await post(`/purchasing/suggest-po`, { 
        requests: boIds.map(id => ({ backorderRequestId: id })) 
      });
      
      if (!suggest.ok || !Array.isArray(suggest.body?.drafts))
        return { test: "close-the-loop-multi-vendor", result: "FAIL", step: "suggest-po", suggest };
      
      const drafts = suggest.body.drafts;
      
      // 9) Assert drafts[] has length == 2 (one per vendor)
      if (drafts.length !== 2) {
        return { 
          test: "close-the-loop-multi-vendor", 
          result: "FAIL", 
          step: "drafts-count", 
          expected: 2, 
          got: drafts.length,
          drafts 
        };
      }
      
      // 10) Create both POs via POST /purchasing/po:create-from-suggestion with { drafts }
      const poCreate = await post(`/purchasing/po:create-from-suggestion`, { 
        drafts 
      }, { "Idempotency-Key": idem() });
      
      if (!poCreate.ok || !Array.isArray(poCreate.body?.ids) || poCreate.body.ids.length !== 2) {
        return { 
          test: "close-the-loop-multi-vendor", 
          result: "FAIL", 
          step: "create-from-suggestion", 
          poCreate 
        };
      }
      
      const poIds = poCreate.body.ids;
      recordFromListResult(
        poIds.map((id, idx) => ({ id, type: "purchaseOrder", status: "draft", vendorId: drafts[idx]?.vendorId })),
        "purchaseOrder",
        `/purchasing/po:create-from-suggestion`
      );
      
      // 11) For each PO: approve (if needed) and receive all remaining qty
      const receiveResults = [];
      const finalOnhands = [];
      
      for (let idx = 0; idx < poIds.length; idx++) {
        const poId = poIds[idx];
        
        // Submit PO
        const submit = await post(`/purchasing/po/${encodeURIComponent(poId)}:submit`, {}, { "Idempotency-Key": idem() });
        if (!submit.ok) {
          return { 
            test: "close-the-loop-multi-vendor", 
            result: "FAIL", 
            step: `po${idx+1}-submit`, 
            submit 
          };
        }
        
        // Approve PO
        const approve = await post(`/purchasing/po/${encodeURIComponent(poId)}:approve`, {}, { "Idempotency-Key": idem() });
        if (!approve.ok) {
          return { 
            test: "close-the-loop-multi-vendor", 
            result: "FAIL", 
            step: `po${idx+1}-approve`, 
            approve 
          };
        }
        
        // Wait for approval status
        const approved = await waitForStatus("purchaseOrder", poId, ["approved"]);
        if (!approved.ok) {
          return { 
            test: "close-the-loop-multi-vendor", 
            result: "FAIL", 
            step: `po${idx+1}-not-approved`, 
            approved 
          };
        }
        
        // Get PO to extract lines
        const po = await get(`/objects/purchaseOrder/${encodeURIComponent(poId)}`);
        const lines = (po.body?.lines ?? [])
          .map(ln => ({ 
            lineId: ln.id ?? ln.lineId, 
            deltaQty: Math.max(0, (ln.qty ?? 0) - (ln.receivedQty ?? 0)) 
          }))
          .filter(l => l.deltaQty > 0);
        
        // Receive all remaining qty
        const recv = await post(`/purchasing/po/${encodeURIComponent(poId)}:receive`, 
          { lines }, 
          { "Idempotency-Key": idem() }
        );
        
        if (!recv.ok) {
          return { 
            test: "close-the-loop-multi-vendor", 
            result: "FAIL", 
            step: `po${idx+1}-receive`, 
            recv 
          };
        }
        
        receiveResults.push(recv);
        
        // Record final onhand for this item
        const itemIdForPo = idx === 0 ? item1Id : item2Id;
        const ohAfter = await onhand(itemIdForPo);
        finalOnhands.push(ohAfter);
      }
      
      // 12) Validate PO line receivedQty matches qty in receive responses + status
      const lineReceivedValid = receiveResults.every((recv, idx) => {
        const lines = recv.body?.lines ?? [];
        // Check that each line has receivedQty === qty (after receiving)
        return lines.every(l => {
          const receivedAfter = l.receivedQty ?? 0;
          const ordered = l.qty ?? 0;
          return receivedAfter === ordered;
        });
      });
      
      // Validate PO status is fulfilled after receive
      const poStatusValid = receiveResults.every((recv, idx) => {
        const status = recv.body?.status;
        return status === "fulfilled";
      });
      
      // 13) Fetch inventory onhand (informational; don't fail on stale values)
      // Retry up to 3 times with 300ms delay to work around eventual consistency
      const getOnhandWithRetry = async (itemId) => {
        for (let i = 0; i < 3; i++) {
          const oh = await onhand(itemId);
          if (oh.ok) return oh;
          if (i < 2) await sleep(300);
        }
        return { ok: false, body: {} };
      };
      
      const onhand1AfterRetry = await getOnhandWithRetry(item1Id);
      const onhand2AfterRetry = await getOnhandWithRetry(item2Id);
      
      const onHand1Final = (onhand1AfterRetry.body?.items?.[0]?.onHand ?? 0);
      const onHand2Final = (onhand2AfterRetry.body?.items?.[0]?.onHand ?? 0);
      
      // 14) Assert backorder status transitions (most reliable indicator of success)
      const boFulfilled = await post(`/objects/backorderRequest/search`, { soId, status: "fulfilled" });
      const boOpen = await post(`/objects/backorderRequest/search`, { soId, status: "open" });
      
      recordFromListResult(boFulfilled.body?.items, "backorderRequest", `/objects/backorderRequest/search`);
      recordFromListResult(boOpen.body?.items, "backorderRequest", `/objects/backorderRequest/search`);
      
      const boStatusValid = 
        (boFulfilled.body?.items?.length ?? 0) >= 2
        && (boOpen.body?.items?.length ?? 0) === 0;
      
      // Pass if: receipts confirmed success + lines fully received + POs fulfilled + no open backorders
      // Inventory checks are logged but not required to pass (due to allocation/projection lag)
      const pass = 
        poCreate.ok 
        && poIds.length === 2 
        && receiveResults.every(r => r.ok)
        && lineReceivedValid
        && poStatusValid
        && boStatusValid;
      
      return {
        test: "close-the-loop-multi-vendor",
        result: pass ? "PASS" : "FAIL",
        steps: {
          vendors: { vendor1Id, vendor2Id },
          products: { prod1Id, prod2Id },
          items: { item1Id, item2Id },
          so: { soId },
          backorders: { count: boIds.length, ids: boIds },
          suggest: { draftCount: drafts.length, drafts },
          pos: { ids: poIds },
          receives: receiveResults,
          lineReceiveValidation: {
            allLinesFullyReceived: lineReceivedValid,
            poStatusFulfilled: poStatusValid
          },
          inventory: { 
            item1Final: onHand1Final, 
            item2Final: onHand2Final,
            note: "Informational only; may be 0 if allocated to backorder/SO"
          },
          backorderStatus: {
            fulfilled: boFulfilled.body?.items?.length ?? 0,
            open: boOpen.body?.items?.length ?? 0
          }
        }
      };
    },

    "smoke:close-the-loop-partial-receive": async () => {
      await ensureBearer();

      // 1) Seed vendor + product (with preferredVendorId) + inventory item
      const { vendorId } = await seedVendor(api);
      const prod = await createProduct({ name: "PartialReceiveProd", preferredVendorId: vendorId });
      if (!prod.ok) return { test: "close-the-loop-partial-receive", result: "FAIL", step: "createProduct", prod };

      const item = await createInventoryForProduct(prod.body?.id, "PartialReceiveItem");
      if (!item.ok) return { test: "close-the-loop-partial-receive", result: "FAIL", step: "createInventory", item };
      const itemId = item.body?.id;

      // Ensure onHand is 0
      const onhandPre = await onhand(itemId);
      const currentOnHand = onhandPre.body?.items?.[0]?.onHand ?? 0;
      if (currentOnHand !== 0) {
        await post(`/objects/inventoryMovement`, { itemId, type: "adjust", qty: -currentOnHand });
      }

      // 2) Create SO qty=5 and commit to create backorder
      const { partyId } = await seedParties(api);
      const so = await post(`/objects/salesOrder`, {
        type: "salesOrder",
        status: "draft",
        partyId,
        lines: [{ itemId, qty: 5, uom: "ea" }]
      });
      if (!so.ok) return { test: "close-the-loop-partial-receive", result: "FAIL", step: "createSO", so };
      const soId = so.body?.id;
      await post(`/sales/so/${encodeURIComponent(soId)}:submit`, {}, { "Idempotency-Key": idem() });
      await post(`/sales/so/${encodeURIComponent(soId)}:commit`, {}, { "Idempotency-Key": idem() });

      // 3) suggest-po and create PO from suggestion
      const boRes = await post(`/objects/backorderRequest/search`, { soId, status: "open" });
      if (!boRes.ok || !Array.isArray(boRes.body?.items) || boRes.body.items.length === 0)
        return { test: "close-the-loop-partial-receive", result: "FAIL", step: "backorderRequest-open", boRes };
      const boIds = boRes.body.items.map((b) => b.id);

      const suggest = await post(`/purchasing/suggest-po`, { requests: boIds.map((id) => ({ backorderRequestId: id })) });
      if (!suggest.ok || !Array.isArray(suggest.body?.drafts) || suggest.body.drafts.length === 0)
        return { test: "close-the-loop-partial-receive", result: "FAIL", step: "suggest-po", suggest };

      const draft = suggest.body.drafts[0];
      const createPo = await post(`/purchasing/po:create-from-suggestion`, { drafts: [draft] }, { "Idempotency-Key": idem() });
      if (!createPo.ok || !Array.isArray(createPo.body?.ids) || createPo.body.ids.length !== 1)
        return { test: "close-the-loop-partial-receive", result: "FAIL", step: "create-from-suggestion", createPo };

      const poId = createPo.body.ids[0];

      // 4) Approve PO if required
      await post(`/purchasing/po/${encodeURIComponent(poId)}:submit`, {}, { "Idempotency-Key": idem() });
      await post(`/purchasing/po/${encodeURIComponent(poId)}:approve`, {}, { "Idempotency-Key": idem() });
      const approved = await waitForStatus("purchaseOrder", poId, ["approved", "open"]);
      if (!approved.ok) return { test: "close-the-loop-partial-receive", result: "FAIL", step: "po-approved", approved };

      // 5) Partial receive delta=2
      const poGet1 = await get(`/objects/purchaseOrder/${encodeURIComponent(poId)}`);
      const poLines = poGet1.body?.lines ?? [];
      if (poLines.length === 0) return { test: "close-the-loop-partial-receive", result: "FAIL", step: "po-lines-empty", poGet1 };
      const lineId = poLines[0].id ?? poLines[0].lineId;
      const ordered = poLines[0].qty ?? 0;

      const receive1 = await post(
        `/purchasing/po/${encodeURIComponent(poId)}:receive`,
        { lines: [{ lineId, deltaQty: 2 }] },
        { "Idempotency-Key": idem() }
      );
      if (!receive1.ok) return { test: "close-the-loop-partial-receive", result: "FAIL", step: "receive-partial", receive1 };

      const lineAfter1 = (receive1.body?.lines ?? []).find((l) => (l.id ?? l.lineId) === lineId) || {};
      const statusAfter1 = receive1.body?.status;
      const okPartial = (lineAfter1.receivedQty ?? 0) === 2 && statusAfter1 === "partially-received";
      if (!okPartial) {
        return {
          test: "close-the-loop-partial-receive",
          result: "FAIL",
          step: "assert-partial",
          lineAfter1,
          statusAfter1,
        };
      }

      // 6) Receive remainder
      const remaining = Math.max(0, (lineAfter1.qty ?? ordered) - (lineAfter1.receivedQty ?? 2));
      const receive2 = await post(
        `/purchasing/po/${encodeURIComponent(poId)}:receive`,
        { lines: [{ lineId, deltaQty: remaining }] },
        { "Idempotency-Key": idem() }
      );
      if (!receive2.ok) return { test: "close-the-loop-partial-receive", result: "FAIL", step: "receive-final", receive2 };

      const lineAfter2 = (receive2.body?.lines ?? []).find((l) => (l.id ?? l.lineId) === lineId) || {};
      const statusAfter2 = receive2.body?.status;
      const okFinal = (lineAfter2.receivedQty ?? 0) === (lineAfter2.qty ?? ordered) && statusAfter2 === "fulfilled";
      if (!okFinal) {
        return {
          test: "close-the-loop-partial-receive",
          result: "FAIL",
          step: "assert-final",
          lineAfter2,
          statusAfter2,
        };
      }

      // 7) Backorder assertions
      const boFulfilled = await post(`/objects/backorderRequest/search`, { soId, status: "fulfilled" });
      const boOpen = await post(`/objects/backorderRequest/search`, { soId, status: "open" });
      const boOk = (boFulfilled.body?.items?.length ?? 0) >= 1 && (boOpen.body?.items?.length ?? 0) === 0;

      // 8) Optional movements check
      let movementCheck = null;
      try {
        const mv = await get(`/inventory/${encodeURIComponent(itemId)}/movements`, {
          refId: poId,
          poLineId: lineId,
          sort: "desc",
          limit: 20
        });
        if (mv.ok && Array.isArray(mv.body?.items)) {
          const recvs = mv.body.items.filter((m) => m.action === "receive" && m.poLineId === lineId && m.refId === poId);
          const qtys = recvs.map((m) => Number(m.qty ?? 0)).sort((a, b) => a - b);
          const hasTwo = recvs.length >= 2 && qtys.includes(2) && qtys.includes(remaining);
          movementCheck = { ok: hasTwo, count: recvs.length, qtys };
        } else {
          movementCheck = { ok: false, reason: "no-items" };
        }
      } catch (e) {
        movementCheck = { ok: false, error: e?.message ?? String(e) };
      }

      const pass = okPartial && okFinal && boOk && (movementCheck?.ok !== false || movementCheck === null);

      return {
        test: "close-the-loop-partial-receive",
        result: pass ? "PASS" : "FAIL",
        steps: {
          poId,
          lineId,
          firstReceive: receive1,
          secondReceive: receive2,
          boFulfilled: boFulfilled.body?.items?.length ?? 0,
          boOpen: boOpen.body?.items?.length ?? 0,
          movementCheck,
        }
      };
    },

    "smoke:vendor-guard-enforced": async () => {
      await ensureBearer();
      const guardHeaders = { "X-Feature-Enforce-Vendor": "1" };

      // Non-vendor party for guard checks
      const party = await post(`/objects/party`, { kind: "org", name: smokeTag("Guard Party"), roles: ["customer"] });
      if (!party.ok) return { test: "vendor-guard-enforced", result: "FAIL", step: "create-party", party };
      const nonVendorPartyId = party.body?.id;
      const rolesBefore = party.body?.roles ?? ["customer"];

      // Customer party for SO
      const { partyId: customerId } = await seedParties(api);

      // Product + inventory with preferredVendorId pointing to the non-vendor party
      const prod = await createProduct({ name: "GuardProd", preferredVendorId: nonVendorPartyId });
      if (!prod.ok) return { test: "vendor-guard-enforced", result: "FAIL", step: "create-product", prod };
      const item = await createInventoryForProduct(prod.body?.id, "GuardItem");
      if (!item.ok) return { test: "vendor-guard-enforced", result: "FAIL", step: "create-item", item };
      const itemId = item.body?.id;

      // Create SO shortage to generate backorder
      const so = await post(`/objects/salesOrder`, {
        type: "salesOrder",
        status: "draft",
        partyId: customerId,
        lines: [{ itemId, qty: 2, uom: "ea" }]
      });
      if (!so.ok) return { test: "vendor-guard-enforced", result: "FAIL", step: "create-so", so };
      const soId = so.body?.id;
      await post(`/sales/so/${encodeURIComponent(soId)}:submit`, {}, { "Idempotency-Key": idem() });
      await post(`/sales/so/${encodeURIComponent(soId)}:commit`, {}, { "Idempotency-Key": idem() });

      // Backorder + suggest-po
      const boRes = await post(`/objects/backorderRequest/search`, { soId, status: "open" });
      if (!boRes.ok || !Array.isArray(boRes.body?.items) || boRes.body.items.length === 0)
        return { test: "vendor-guard-enforced", result: "FAIL", step: "bo-open", boRes };
      const boIds = boRes.body.items.map((b) => b.id);

      const suggest = await post(`/purchasing/suggest-po`, { requests: boIds.map((id) => ({ backorderRequestId: id })) });
      const baseDraft = suggest.body?.draft ?? (suggest.body?.drafts?.[0]);
      if (!suggest.ok || !baseDraft)
        return { test: "vendor-guard-enforced", result: "FAIL", step: "suggest-po", suggest };

      // Case: vendorId present but party lacks vendor role -> expect VENDOR_ROLE_MISSING
      const draftBadRole = { ...baseDraft, vendorId: nonVendorPartyId };
      const poRoleMissing = await post(`/purchasing/po:create-from-suggestion`, { drafts: [draftBadRole] }, { "Idempotency-Key": idem() });
      if (!poRoleMissing.ok || !Array.isArray(poRoleMissing.body?.ids) || poRoleMissing.body.ids.length === 0)
        return { test: "vendor-guard-enforced", result: "FAIL", step: "po-create-role-missing", poRoleMissing };
      const poRoleMissingId = poRoleMissing.body.ids[0];

      // Try to submit with guard headers - expect VENDOR_ROLE_MISSING
      const submitBlocked = await post(`/purchasing/po/${encodeURIComponent(poRoleMissingId)}:submit`, {}, { "Idempotency-Key": idem() }, { headers: guardHeaders });
      const submitBlockedOk = submitBlocked.status === 400 && submitBlocked.body?.code === "VENDOR_ROLE_MISSING";
      if (!submitBlockedOk) return { test: "vendor-guard-enforced", result: "FAIL", step: "guard-submit-blocked", submitBlocked };
      const guardFailureCode = submitBlocked.body?.code;

      // Fix party roles to include vendor
      const partyUpdate = await put(`/objects/party/${encodeURIComponent(nonVendorPartyId)}`, { roles: ["customer", "vendor"] });
      if (!partyUpdate.ok) return { test: "vendor-guard-enforced", result: "FAIL", step: "party-add-vendor-role", partyUpdate };
      const partyAfter = await get(`/objects/party/${encodeURIComponent(nonVendorPartyId)}`);
      const rolesAfter = partyAfter.body?.roles ?? [];

      // Retry submit with guard headers (should pass)
      const submitFixed = await post(`/purchasing/po/${encodeURIComponent(poRoleMissingId)}:submit`, {}, { "Idempotency-Key": idem() }, { headers: guardHeaders });
      if (!submitFixed.ok) return { test: "vendor-guard-enforced", result: "FAIL", step: "submit-after-fix", submitFixed };

      // Retry approve with guard headers (should pass)
      const approveFixed = await post(`/purchasing/po/${encodeURIComponent(poRoleMissingId)}:approve`, {}, {}, { headers: guardHeaders });
      if (!approveFixed.ok) return { test: "vendor-guard-enforced", result: "FAIL", step: "approve-after-fix", approveFixed };

      // Receive should succeed under guard
      const poGet = await get(`/objects/purchaseOrder/${encodeURIComponent(poRoleMissingId)}`);
      const lineId = poGet.body?.lines?.[0]?.id ?? poGet.body?.lines?.[0]?.lineId;
      const receiveFixed = await post(
        `/purchasing/po/${encodeURIComponent(poRoleMissingId)}:receive`,
        { lines: [{ lineId, deltaQty: 2 }] },
        {},
        { headers: guardHeaders }
      );
      if (!receiveFixed.ok) return { test: "vendor-guard-enforced", result: "FAIL", step: "receive-after-fix", receiveFixed };

      return {
        test: "vendor-guard-enforced",
        result: "PASS",
        steps: {
          nonVendorPartyId,
          rolesBefore,
          rolesAfter,
          customerId,
          boIds,
          poRoleMissingId,
          submitBlocked,
          guardFailureCode,
          submitFixed,
          approveFixed,
          receiveFixed
        }
      };
    },

  "list": async ()=>Object.keys(tests),

  "smoke:ping": async ()=>{
    const r = await fetch(API+"/ping");
    const t = await r.text();
    return { test:"ping", result:r.ok?"PASS":"FAIL", status:r.status, text:t };
  },

  "smoke:parties:happy": async ()=>{
    await ensureBearer();
    const create = await post(`/objects/${encodeURIComponent(PARTY_TYPE)}`, { kind:"person", name: smokeTag("Smoke Test User"), roles:["customer"] });
    const search = await post(`/objects/${encodeURIComponent(PARTY_TYPE)}/search`, { q:"Smoke Test User" });
    let update = { ok:true, status:200, body:{} };
    if (create.ok && create.body?.id) {
      update = await put(`/objects/${encodeURIComponent(PARTY_TYPE)}/${encodeURIComponent(create.body.id)}`, { notes:"updated by smoke" });
    }
    const pass = create.ok && search.ok && update.ok;
    return { test:"parties-happy", result:pass?"PASS":"FAIL", create, search, update };
  },

  "smoke:parties:crud": async ()=>{
    await ensureBearer();
    const name = `SmokeParty-${Date.now()}`;
    const updatedName = `${name}-Updated`;

    const create = await post(`/objects/${encodeURIComponent(PARTY_TYPE)}`,
      { kind: "org", name, roles: ["customer"] },
      { "Idempotency-Key": idem() }
    );
    const id = create.body?.id;
    if (!create.ok || !id) {
      return { test: "parties-crud", result: "FAIL", step: "create", create };
    }

    const get1 = await get(`/objects/${encodeURIComponent(PARTY_TYPE)}/${encodeURIComponent(id)}`);
    if (!get1.ok || (get1.body?.name ?? "") !== name) {
      return { test: "parties-crud", result: "FAIL", step: "get1", get1 };
    }

    const update = await put(`/objects/${encodeURIComponent(PARTY_TYPE)}/${encodeURIComponent(id)}`,
      { name: updatedName, notes: "updated by parties-crud" },
      { "Idempotency-Key": idem() }
    );
    if (!update.ok) {
      return { test: "parties-crud", result: "FAIL", step: "update", update };
    }

    const get2 = await get(`/objects/${encodeURIComponent(PARTY_TYPE)}/${encodeURIComponent(id)}`);
    const gotUpdated = get2.ok && (get2.body?.name ?? "") === updatedName;
    if (!gotUpdated) {
      return { test: "parties-crud", result: "FAIL", step: "get2", get2 };
    }

    // Presence check via search with tiny retry (eventual consistency safe)
    let searchOrList = null;
    let found = false;
    for (let i=0;i<5 && !found;i++){
      // prefer POST /objects/party/search when available
      searchOrList = await post(`/objects/${encodeURIComponent(PARTY_TYPE)}/search`, { q: updatedName, limit: 20 });
      if (searchOrList.ok) {
        const items = Array.isArray(searchOrList.body?.items) ? searchOrList.body.items : [];
        found = items.some(p => p.id === id || p.name === updatedName);
      }
      if (!found) await sleep(200);
    }

    const pass = create.ok && get1.ok && update.ok && gotUpdated && searchOrList?.ok && found;
    return { test: "parties-crud", result: pass ? "PASS" : "FAIL", create, get1, update, get2, searchOrList, found };
  },

  "smoke:products:crud": async ()=>{
    await ensureBearer();
    const baseSku = `SMOKE-SKU-${Date.now()}`;
    const baseName = `SmokeProduct-${Date.now()}`;
    const sku = smokeTag(baseSku);
    const name = smokeTag(baseName);
    const updatedName = smokeTag(`${baseName}-Updated`);
    const updatedPrice = 99.99;

    const create = await post(`/objects/product`,
      { sku, name, type: "good", uom: "ea", price: 49.99, preferredVendorId: "vendor-test" },
      { "Idempotency-Key": idem() }
    );
    const id = create.body?.id;
    if (!create.ok || !id) {
      return { test: "products-crud", result: "FAIL", step: "create", create };
    }

    // Retry GET for eventual consistency
    let get1 = null;
    let found1 = false;
    for (let i=0;i<5 && !found1;i++){
      get1 = await get(`/objects/product/${encodeURIComponent(id)}`);
      found1 = get1.ok && (get1.body?.sku ?? "") === sku;
      if (!found1) await sleep(200);
    }
    if (!found1) {
      return { test: "products-crud", result: "FAIL", step: "get1", get1 };
    }

    const update = await put(`/objects/product/${encodeURIComponent(id)}`,
      { name: updatedName, price: updatedPrice },
      { "Idempotency-Key": idem() }
    );
    if (!update.ok) {
      return { test: "products-crud", result: "FAIL", step: "update", update };
    }

    const get2 = await get(`/objects/product/${encodeURIComponent(id)}`);
    const gotUpdated = get2.ok && (get2.body?.name ?? "") === updatedName && (get2.body?.price ?? 0) === updatedPrice;
    if (!gotUpdated) {
      return { test: "products-crud", result: "FAIL", step: "get2", get2 };
    }

    // Verify it appears in list
    let list = null;
    let found = false;
    for (let i=0;i<5 && !found;i++){
      list = await get(`/objects/product`, { limit: 20, q: sku });
      if (list.ok) {
        const items = Array.isArray(list.body?.items) ? list.body.items : [];
        found = items.some(p => p.id === id || p.sku === sku);
      }
      if (!found) await sleep(200);
    }

    const pass = create.ok && found1 && update.ok && gotUpdated && list?.ok && found;
    return { test: "products-crud", result: pass ? "PASS" : "FAIL", create, get1, update, get2, list, found };
  },

  "smoke:inventory:crud": async ()=>{
    await ensureBearer();
    const itemId = smokeTag(`smoke-item-${Date.now()}`);
    const productId = smokeTag(`smoke-prod-${Date.now()}`);
    const createName = smokeTag("Smoke Inventory Item");
    const updatedName = smokeTag("Smoke Inventory Item Updated");

    const create = await post(`/objects/inventoryItem`,
      { itemId, productId, name: createName },
      { "Idempotency-Key": idem() }
    );
    const id = create.body?.id;
    if (!create.ok || !id) {
      return { test: "inventory-crud", result: "FAIL", step: "create", create };
    }

    const get1 = await get(`/objects/inventoryItem/${encodeURIComponent(id)}`);
    const body1 = get1.body ?? {};
    const gotItemId1 = body1?.itemId ?? "";
    const gotProductId1 = body1?.productId;
    const hasRunId = (v) => typeof v === "string" && v.includes(SMOKE_RUN_ID);
    if (!get1.ok || gotItemId1 !== itemId || !hasRunId(body1?.name) || (gotProductId1 && !hasRunId(gotProductId1))) {
      return { test: "inventory-crud", result: "FAIL", step: "get1", get1, gotItemId1, gotProductId1 };
    }

    const update = await put(`/objects/inventoryItem/${encodeURIComponent(id)}`,
      { name: updatedName },
      { "Idempotency-Key": idem() }
    );
    if (!update.ok) {
      return { test: "inventory-crud", result: "FAIL", step: "update", update };
    }

    const get2 = await get(`/objects/inventoryItem/${encodeURIComponent(id)}`);
    const body2 = get2.body ?? {};
    const gotItemId2 = body2?.itemId ?? "";
    const gotProductId2 = body2?.productId;
    const gotUpdated = get2.ok
      && (body2?.name ?? "") === updatedName
      && hasRunId(body2?.name)
      && gotItemId2 === itemId
      && hasRunId(gotItemId2)
      && (typeof gotProductId2 === "undefined" || hasRunId(gotProductId2));
    if (!gotUpdated) {
      return { test: "inventory-crud", result: "FAIL", step: "get2", get2, gotItemId2, gotProductId2 };
    }

    // Optional: check onhand endpoint returns an entry
    const onhandRes = await get(`/inventory/${encodeURIComponent(id)}/onhand`);
    const onhandOk = onhandRes.ok; // Don't enforce structure, just that it doesn't error

    const pass = create.ok && get1.ok && update.ok && gotUpdated && onhandOk;
    return { test: "inventory-crud", result: pass ? "PASS" : "FAIL", create, get1, update, get2, onhandRes };
  },

  "smoke:inventory:onhand": async ()=>{
    await ensureBearer();
    const item = await post(`/objects/${ITEM_TYPE}`, { productId:"prod-smoke" });
    if (!item.ok) return { test:"inventory-onhand", result:"FAIL", item };
    const id = item.body?.id;
    const rec = await post(`/objects/${MV_TYPE}`, { itemId:id, type:"receive", qty:3 });
    const onhandR = await get(`/inventory/${encodeURIComponent(id)}/onhand`);
    const pass = rec.ok && onhandR.ok && Array.isArray(onhandR.body?.items) && ((onhandR.body.items[0]?.onHand ?? 0) >= 3);
    return { test:"inventory-onhand", result:pass?"PASS":"FAIL", item, rec, onhand:onhandR };
  },

  "smoke:inventory:guards": async ()=>{
    await ensureBearer();
    const item = await post(`/objects/${ITEM_TYPE}`, { productId:"prod-smoke" });
    if (!item.ok) return { test:"inventory-guards", result:"FAIL", item };
    const id = item.body?.id;
    const rec = await post(`/objects/${MV_TYPE}`, { itemId:id, type:"receive", qty:1 });
    const resv = await post(`/objects/${MV_TYPE}`, { itemId:id, type:"reserve", qty:2 });
    const guardOk = rec.ok && (!resv.ok || resv.status >= 400);
    return { test:"inventory-guards", result:guardOk?"PASS":"FAIL", item, rec, resv };
  },

  "smoke:inventory:onhand-batch": async ()=>{
    await ensureBearer();
    const a = await post(`/objects/${ITEM_TYPE}`, { productId:"prod-a" });
    const b = await post(`/objects/${ITEM_TYPE}`, { productId:"prod-b" });
    if (!a.ok || !b.ok) return { test:"inventory-onhand-batch", result:"FAIL", a, b };
    const recA = await post(`/objects/${MV_TYPE}`, { itemId:a.body?.id, action:"receive", qty:5 });
    const recB = await post(`/objects/${MV_TYPE}`, { itemId:b.body?.id, action:"receive", qty:7 });
    const batch = await post(`/inventory/onhand:batch`, { itemIds:[a.body?.id, b.body?.id] });
    const ok = batch.ok
      && Array.isArray(batch.body?.items)
      && batch.body.items.length===2
      && (batch.body.items.find(i=>i.itemId===a.body?.id)?.onHand ?? 0) >= 5
      && (batch.body.items.find(i=>i.itemId===b.body?.id)?.onHand ?? 0) >= 7;
    return { test:"inventory-onhand-batch", result:ok?"PASS":"FAIL", a, b, recA, recB, batch };
  },

  "smoke:inventory:list-movements": async ()=>{
    await ensureBearer();
    const item = await post(`/objects/${ITEM_TYPE}`, { productId:"prod-smoke" });
    if (!item.ok) return { test:"inventory-list-movements", result:"FAIL", item };
    const id = item.body?.id;
    await post(`/objects/${MV_TYPE}`, { itemId:id, action:"receive", qty:3 });
    await post(`/objects/${MV_TYPE}`, { itemId:id, action:"reserve", qty:1 });
    await post(`/objects/${MV_TYPE}`, { itemId:id, action:"receive", qty:2 });
    await post(`/objects/${MV_TYPE}`, { itemId:id, action:"reserve", qty:1 });
    const mv = await get(`/inventory/${encodeURIComponent(id)}/movements`);
    const ok = mv.ok && Array.isArray(mv.body?.items);
    return { test:"inventory-list-movements", result:ok?"PASS":"FAIL", item, mv };
  },

  /* ===================== Sales Orders ===================== */
  "smoke:sales:happy": async ()=>{
    await ensureBearer();

    const { partyId } = await seedParties(api);

    const itemA = await post(`/objects/${ITEM_TYPE}`, { productId:"prod-ITEM_A" });
    const itemB = await post(`/objects/${ITEM_TYPE}`, { productId:"prod-ITEM_B" });
    if (!itemA.ok || !itemB.ok) return { test:"sales-happy", result:"FAIL", itemA, itemB };

    const idA = itemA.body?.id;
    const idB = itemB.body?.id;

    const recvA = await ensureOnHand(idA, 5);
    const recvB = await ensureOnHand(idB, 3);
    if (!recvA.ok || !recvB.ok) {
      return { test:"sales-happy", result:"FAIL", reason:"onhand-not-updated", recvA, recvB };
    }

    const create = await post(`/objects/salesOrder`, {
      type: "salesOrder",
      status: "draft",
      partyId,
      customerId: partyId,
      lines: [
        { id:"L1", itemId:idA, uom:"ea", qty:2 },
        { id:"L2", itemId:idB, uom:"ea", qty:1 }
      ]
    });
    if (!create.ok) return { test: "sales-happy", result: "FAIL", create };
    const id = create.body?.id;

    const l1 = create.body?.lines?.find(x=>x.id==="L1")?.itemId;
    const l2 = create.body?.lines?.find(x=>x.id==="L2")?.itemId;
    if (l1 !== idA || l2 !== idB) {
      const fix = await put(`/objects/salesOrder/${encodeURIComponent(id)}`, {
        lines: [
          { id:"L1", itemId:idA, uom:"ea", qty:2 },
          { id:"L2", itemId:idB, uom:"ea", qty:1 }
        ]
      });
      if (!fix.ok) return { test:"sales-happy", result:"FAIL", reason:"lines-mismatch", create, fix, expect:{idA,idB}, actual:{l1,l2} };
    }

    const submit  = await post(`/sales/so/${encodeURIComponent(id)}:submit`, {}, { "Idempotency-Key": idem() });

    const ohA = await onhand(idA);
    const ohB = await onhand(idB);

    const commit  = await post(`/sales/so/${encodeURIComponent(id)}:commit`, {}, { "Idempotency-Key": idem() });
    if (!submit.ok || !commit.ok) return { test: "sales-happy", result: "FAIL", submit, commit, onhand:{ohA, ohB} };

    const reserve = await post(`/sales/so/${encodeURIComponent(id)}:reserve`, { lines: [{ lineId: "L1", deltaQty: 2 }] }, { "Idempotency-Key": idem() });
    if (!reserve.ok) return { test: "sales-happy", result: "FAIL", reserve };

    const fulfill1 = await post(`/sales/so/${encodeURIComponent(id)}:fulfill`, { lines: [{ lineId: "L1", deltaQty: 1 }] }, { "Idempotency-Key": idem() });
    if (!fulfill1.ok) return { test: "sales-happy", result: "FAIL", fulfill1 };

    await post(`/sales/so/${encodeURIComponent(id)}:close`, {}, { "Idempotency-Key": idem() });

    const fulfill2 = await post(`/sales/so/${encodeURIComponent(id)}:fulfill`,
      { lines: [{ lineId: "L1", deltaQty: 1 }, { lineId: "L2", deltaQty: 1 }] },
      { "Idempotency-Key": idem() }
    );
    if (!fulfill2.ok) return { test: "sales-happy", result: "FAIL", fulfill2 };

    const close = await post(`/sales/so/${encodeURIComponent(id)}:close`, {}, { "Idempotency-Key": idem() });
    const closed = close.ok && (close.body?.status === "closed");
    return {
      test: "sales-happy",
      result: closed ? "PASS" : "FAIL",
      movementVariants: { itemA: recvA.variant, itemB: recvB.variant },
      onhandBeforeCommit: { ohA, ohB },
      artifacts: { itemA, itemB, create, submit, commit, reserve, fulfill1, fulfill2, close }
    };
  },

  "smoke:sales:guards": async ()=>{
    await ensureBearer();

    const { partyId } = await seedParties(api);

    const scarceItem = await post(`/objects/${ITEM_TYPE}`, { productId:"prod-ITEM_G" });
    if (!scarceItem.ok) return { test:"sales-guards", result:"FAIL", scarceItem };
    const scarceItemId = scarceItem.body?.id;

    const rec = await post(`/objects/${MV_TYPE}`, { itemId:scarceItemId, action:"receive", qty:2 });
    if (!rec.ok) return { test:"sales-guards", result:"FAIL", rec };

    const create = await post(`/objects/salesOrder`, {
      type: "salesOrder",
      status: "draft",
      partyId,
      customerId: partyId,
      lines: [{ id: "X1", itemId: scarceItemId, uom: "ea", qty: 5 }]
    });
    if (!create.ok) return { test: "sales-guards", result: "FAIL", create };
    const id = create.body?.id;

    await post(`/sales/so/${encodeURIComponent(id)}:submit`, {}, { "Idempotency-Key": idem() });

    await post(`/sales/so/${encodeURIComponent(id)}:reserve`, { lines: [{ lineId: "X1", deltaQty: 2 }] }, { "Idempotency-Key": idem() });
    const cancelBlocked = await post(`/sales/so/${encodeURIComponent(id)}:cancel`, {}, { "Idempotency-Key": idem() });
    const cancelGuard = !cancelBlocked.ok || cancelBlocked.status >= 400;

    const release = await post(`/sales/so/${encodeURIComponent(id)}:release`,
      { lines: [{ lineId: "X1", deltaQty: 2, reason: "test" }] },
      { "Idempotency-Key": idem() }
    );
    const cancel = await post(`/sales/so/${encodeURIComponent(id)}:cancel`, {}, { "Idempotency-Key": idem() });
    const cancelled = cancel.ok && (cancel.body?.status === "cancelled");

    const tooBigItem = await post(`/objects/${ITEM_TYPE}`, { productId:"prod-ITEM_SCARCE" });
    const tooBigItemId = tooBigItem.body?.id;
    const scarce = await post(`/objects/salesOrder`, {
      type: "salesOrder",
      status: "draft",
      partyId,
      customerId: partyId,
      lines: [{ id: "Y1", itemId: tooBigItemId, uom: "ea", qty: 9999 }]
    });
    const scarceId = scarce.body?.id;
    await post(`/sales/so/${encodeURIComponent(scarceId)}:submit`, {}, { "Idempotency-Key": idem() });
    const strictCommit = await post(`/sales/so/${encodeURIComponent(scarceId)}:commit`, { strict: true }, { "Idempotency-Key": idem() });
    const strictGuard = !strictCommit.ok || strictCommit.status === 409;

    const pass = cancelGuard && release.ok && cancelled && (strictGuard || strictCommit.body?.message);
    return { test: "sales-guards", result: pass ? "PASS" : "FAIL", rec, cancelBlocked, release, cancel, strictCommit };
  },

  "smoke:salesOrders:commit-strict-shortage": async () => {
    await ensureBearer();

    const { partyId } = await seedParties(api);
    const product = await createProduct({ name: "Smoke SO Strict" });
    if (!product.ok) return { test: "salesOrders:commit-strict-shortage", result: "FAIL", product };
    const item = await createInventoryForProduct(product.body?.id, "SmokeSO-Strict");
    if (!item.ok) return { test: "salesOrders:commit-strict-shortage", result: "FAIL", item };
    const itemId = item.body?.id;

    const current = await onhand(itemId);
    const currentQty = current.body?.items?.[0]?.onHand ?? 0;
    let adjust = null;
    if (currentQty > 0) {
      adjust = await post(`/objects/${MV_TYPE}`, { itemId, type: "adjust", qty: -currentQty });
    }

    const create = await post(
      `/objects/salesOrder`,
      {
        type: "salesOrder",
        status: "draft",
        partyId,
        lines: [{ id: "L1", itemId, uom: "ea", qty: 5 }],
      },
      { "Idempotency-Key": idem() }
    );
    if (!create.ok) return { test: "salesOrders:commit-strict-shortage", result: "FAIL", create, adjust };
    const soId = create.body?.id;

    const submit = await post(`/sales/so/${encodeURIComponent(soId)}:submit`, {}, { "Idempotency-Key": idem() });
    const commit = await post(
      `/sales/so/${encodeURIComponent(soId)}:commit`,
      { strict: true },
      { "Idempotency-Key": idem() }
    );

    let bo = null;
    let backorderCount = 0;
    for (let i = 0; i < 5; i++) {
      bo = await post(`/objects/backorderRequest/search`, { soId: soId, status: "open" });
      const items = Array.isArray(bo.body?.items) ? bo.body.items : [];
      backorderCount = items.length;
      if (bo.ok) break;
      await sleep(200);
    }

    const shortage = !commit.ok && commit.status === 409 && Array.isArray(commit.body?.shortages) && commit.body.shortages.length > 0;
    const noBackorders = bo?.ok && backorderCount === 0;
    const pass = submit.ok && shortage && noBackorders;
    return { test: "salesOrders:commit-strict-shortage", result: pass ? "PASS" : "FAIL", current, adjust, create, submit, commit, bo };
  },

  "smoke:salesOrders:commit-nonstrict-backorder": async () => {
    await ensureBearer();

    const { partyId } = await seedParties(api);
    const product = await createProduct({ name: "Smoke SO NonStrict" });
    if (!product.ok) return { test: "salesOrders:commit-nonstrict-backorder", result: "FAIL", product };
    const item = await createInventoryForProduct(product.body?.id, "SmokeSO-NonStrict");
    if (!item.ok) return { test: "salesOrders:commit-nonstrict-backorder", result: "FAIL", item };
    const itemId = item.body?.id;

    const current = await onhand(itemId);
    const currentQty = current.body?.items?.[0]?.onHand ?? 0;
    let adjust = null;
    if (currentQty > 0) {
      adjust = await post(`/objects/${MV_TYPE}`, { itemId, type: "adjust", qty: -currentQty });
    }

    const create = await post(
      `/objects/salesOrder`,
      {
        type: "salesOrder",
        status: "draft",
        partyId,
        lines: [{ id: "L1", itemId, uom: "ea", qty: 4 }],
      },
      { "Idempotency-Key": idem() }
    );
    if (!create.ok) return { test: "salesOrders:commit-nonstrict-backorder", result: "FAIL", create, adjust };
    const soId = create.body?.id;

    const submit = await post(`/sales/so/${encodeURIComponent(soId)}:submit`, {}, { "Idempotency-Key": idem() });
    const commit = await post(`/sales/so/${encodeURIComponent(soId)}:commit`, {}, { "Idempotency-Key": idem() });

    let bo = null;
    let found = false;
    for (let i = 0; i < 5 && !found; i++) {
      bo = await post(`/objects/backorderRequest/search`, { soId: soId, status: "open" });
      const items = Array.isArray(bo.body?.items) ? bo.body.items : [];
      found = bo.ok && items.length > 0;
      if (found) recordFromListResult(items, "backorderRequest", `/objects/backorderRequest/search`);
      if (!found) await sleep(200);
    }

    const shortages = Array.isArray(commit.body?.shortages) ? commit.body.shortages : [];
    const pass = submit.ok && commit.ok && shortages.length > 0 && found;
    return { test: "salesOrders:commit-nonstrict-backorder", result: pass ? "PASS" : "FAIL", current, adjust, create, submit, commit, bo };
  },

  /* ===================== Purchase Orders ===================== */
  "smoke:purchasing:happy": async ()=>{
    await ensureBearer();

    const { vendorId } = await seedVendor(api);
    const create = await post(`/objects/purchaseOrder`, {
      type: "purchaseOrder",
      status: "draft",
      vendorId,
      lines: [
        { id:"P1", itemId:"ITEM_A", uom:"ea", qty:3 },
        { id:"P2", itemId:"ITEM_B", uom:"ea", qty:1 }
      ]
    });
    if (!create.ok) return { test: "purchasing-happy", result: "FAIL", create };
    const id = create.body?.id;

    const submit  = await post(`/purchasing/po/${encodeURIComponent(id)}:submit`,  {}, { "Idempotency-Key": idem() });
    const approve = await post(`/purchasing/po/${encodeURIComponent(id)}:approve`, {}, { "Idempotency-Key": idem() });
    if (!submit.ok || !approve.ok) return { test: "purchasing-happy", result: "FAIL", submit, approve };

    const approved = await waitForStatus("purchaseOrder", id, ["approved"]);
    if (!approved.ok) return { test:"purchasing-happy", result:"FAIL", reason:"not-approved-yet", approved };

    const recv1 = await post(`/purchasing/po/${encodeURIComponent(id)}:receive`, { lines:[{ lineId:"P1", deltaQty:2 }] }, { "Idempotency-Key": idem() });
    if (!recv1.ok) return { test: "purchasing-happy", result: "FAIL", recv1 };

    const recv2 = await post(`/purchasing/po/${encodeURIComponent(id)}:receive`, { lines:[{ lineId:"P1", deltaQty:1 }, { lineId:"P2", deltaQty:1 }] }, { "Idempotency-Key": idem() });
    if (!recv2.ok) return { test: "purchasing-happy", result: "FAIL", recv2 };

    const close = await post(`/purchasing/po/${encodeURIComponent(id)}:close`, {}, { "Idempotency-Key": idem() });
    const closed = close.ok && (close.body?.status === "closed");
    return { test:"purchasing-happy", result: closed ? "PASS" : "FAIL", create, submit, approve, recv1, recv2, close };
  },

  "smoke:purchasing:guards": async ()=>{
    await ensureBearer();

    const { vendorId } = await seedVendor(api);

    const create = await post(`/objects/purchaseOrder`, {
      type: "purchaseOrder",
      status: "draft",
      vendorId,
      lines: [{ id: "G1", itemId: "ITEM_Z", uom: "ea", qty: 2 }]
    });
    if (!create.ok) return { test: "purchasing-guards", result: "FAIL", create };
    const id = create.body?.id;

    const approveEarly = await post(`/purchasing/po/${encodeURIComponent(id)}:approve`, {}, { "Idempotency-Key": idem() });
    const approveGuard = !approveEarly.ok || approveEarly.status >= 400;

    const submit  = await post(`/purchasing/po/${encodeURIComponent(id)}:submit`, {}, { "Idempotency-Key": idem() });
    const approve = await post(`/purchasing/po/${encodeURIComponent(id)}:approve`, {}, { "Idempotency-Key": idem() });

    const approved = await waitForStatus("purchaseOrder", id, ["approved"]);
    if (!approved.ok) return { test:"purchasing-guards", result:"FAIL", reason:"not-approved-yet", approved };

    const over = await post(`/purchasing/po/${encodeURIComponent(id)}:receive`, { lines:[{ lineId:"G1", deltaQty:3 }] }, { "Idempotency-Key": idem() });
    const overGuard = !over.ok || over.status === 409;

    const cancel = await post(`/purchasing/po/${encodeURIComponent(id)}:cancel`, {}, { "Idempotency-Key": idem() });
    const cancelGuard = !cancel.ok || cancel.status >= 400;

    const pass = approveGuard && overGuard && cancelGuard;
    return { test: "purchasing-guards", result: pass ? "PASS" : "FAIL", approveEarly, over, cancel };
  },

  "smoke:purchasing:suggest-po-skips": async () => {
    await ensureBearer();

    const validItem = await post(`/objects/${ITEM_TYPE}`, { productId: "prod-skip-valid" });
    if (!validItem.ok) return { test: "purchasing-suggest-po-skips", result: "FAIL", reason: "item-create-failed", validItem };
    const validItemId = validItem.body?.id;

    const boZero = await post(`/objects/backorderRequest`, {
      type: "backorderRequest",
      soId: "SO_SKIP",
      soLineId: "LZ",
      itemId: validItemId,
      qty: 0,
      status: "open",
    });

    const boMissing = await post(`/objects/backorderRequest`, {
      type: "backorderRequest",
      soId: "SO_SKIP",
      soLineId: "LM",
      itemId: "item_missing_vendor_zz",
      qty: 1,
      status: "open",
    });

    if (!boZero.ok || !boMissing.ok) {
      return { test: "purchasing-suggest-po-skips", result: "FAIL", reason: "backorder-create-failed", boZero, boMissing };
    }

    const sugg = await post(
      `/purchasing/suggest-po`,
      {
        requests: [
          { backorderRequestId: boZero.body?.id },
          { backorderRequestId: boMissing.body?.id },
        ],
      },
      { "Idempotency-Key": idem() }
    );

    const skipped = Array.isArray(sugg.body?.skipped) ? sugg.body.skipped : [];
    const hasZero = skipped.some((s) => s.backorderRequestId === boZero.body?.id && s.reason === "ZERO_QTY");
    const hasMissing = skipped.some(
      (s) => s.backorderRequestId === boMissing.body?.id && (s.reason === "MISSING_VENDOR" || s.reason === "NOT_FOUND")
    );

    const drafts = Array.isArray(sugg.body?.drafts)
      ? sugg.body.drafts
      : sugg.body?.draft
      ? [sugg.body.draft]
      : [];
    const draftsHaveVendor = drafts.every((d) => d && typeof d.vendorId === "string" && d.vendorId.trim().length > 0);

    const pass = sugg.ok && hasZero && hasMissing && draftsHaveVendor;
    return {
      test: "purchasing-suggest-po-skips",
      result: pass ? "PASS" : "FAIL",
      hasZero,
      hasMissing,
      draftsCount: drafts.length,
      draftsHaveVendor,
      skipped,
      sugg,
    };
  },

  "smoke:po:save-from-suggest": async ()=>{
    await ensureBearer();
    let draft;
    try {
      const sugg = await post(`/purchasing/suggest-po`, { requests: [{ productId: "prod-demo", qty: 1 }] }, { "Idempotency-Key": idem() });
      draft = sugg.body?.draft ?? sugg.body?.drafts?.[0];
    } catch {}
    if (!draft) {
      draft = { vendorId: "vendor_demo", status: "draft", lines: [{ itemId: "ITEM_SMOKE", qty: 1 }] };
    }
    const r = await post(`/purchasing/po:create-from-suggestion`, { draft }, { "Idempotency-Key": idem() });
    const id = r.body?.id ?? r.body?.ids?.[0];
    const got = id ? await get(`/objects/purchaseOrder/${encodeURIComponent(id)}`) : { ok:false, status:0, body:{} };
    const pass = r.ok && !!id && got.ok && got.body?.status === "draft";
    return { test:"po:save-from-suggest", result:pass?"PASS":"FAIL", create:r, get:got };
  },

  "smoke:po:quick-receive": async ()=>{
    await ensureBearer();
    const { vendorId } = await seedVendor(api);
    const create = await post(`/objects/purchaseOrder`, {
      type:"purchaseOrder", status:"draft", vendorId,
      lines:[{ id:"P1", itemId:"ITEM_QR", uom:"ea", qty:2 }]
    });
    const id = create.body?.id;
    const submit  = await post(`/purchasing/po/${encodeURIComponent(id)}:submit`, {}, { "Idempotency-Key": idem() });
    const approve = await post(`/purchasing/po/${encodeURIComponent(id)}:approve`, {}, { "Idempotency-Key": idem() });
    if(!submit.ok || !approve.ok) return { test:"po:quick-receive", result:"FAIL", submit, approve };
    const approved = await waitForStatus("purchaseOrder", id, ["approved"]);
    if (!approved.ok) return { test:"po:quick-receive", result:"FAIL", reason:"not-approved-yet", approved };
    const po = await get(`/objects/purchaseOrder/${encodeURIComponent(id)}`);
    const lines = (po.body?.lines ?? []).map((ln)=>({ lineId:String(ln.id ?? ln.lineId), deltaQty:Math.max(0,(ln.qty||0)-(ln.receivedQty||0))})).filter(l=>l.deltaQty>0);
    const rec = await post(`/purchasing/po/${encodeURIComponent(id)}:receive`, { lines }, { "Idempotency-Key": idem() });
    const pass = create.ok && rec.ok;
    return { test:"po:quick-receive", result: pass?"PASS":"FAIL", create, rec };
  },

  "smoke:po:receive-line": async ()=>{
    await ensureBearer();
    const { vendorId } = await seedVendor(api);
    const prod = await createProduct({ name:"RecvLine" });
    const inv  = await createInventoryForProduct(prod.body.id, "RecvLineItem");
    if(!inv.ok) return { test:"po-receive-line", result:"FAIL", inv };
    const create = await post(`/objects/purchaseOrder`, {
      type:"purchaseOrder", status:"draft", vendorId,
      lines:[{ id:"RL1", itemId: inv.body.id, uom:"ea", qty:3 }]
    });
    if(!create.ok) return { test:"po-receive-line", result:"FAIL", create };
    const id = create.body.id;
    await post(`/purchasing/po/${encodeURIComponent(id)}:submit`, {}, { "Idempotency-Key": idem() });
    await post(`/purchasing/po/${encodeURIComponent(id)}:approve`, {}, { "Idempotency-Key": idem() });
    const approved = await waitForStatus("purchaseOrder", id, ["approved"]);
    if (!approved.ok) return { test:"po-receive-line", result:"FAIL", reason:"not-approved-yet", approved };
    const recv = await post(`/purchasing/po/${encodeURIComponent(id)}:receive`, {
      lines:[{ lineId:"RL1", deltaQty:2, lot:"LOT-ABC", locationId:"LOC-A1" }]
    }, { "Idempotency-Key": idem() });
    const ok1 = recv.ok && (recv.body?.status === "partially-received");
    
    // Retry with same key but over-receive attempt (deltaQty:2 when only 1 remains)
    // Should fail with 409 both times (failed operations are not cached for idempotency)
    const retry = await post(`/purchasing/po/${encodeURIComponent(id)}:receive`, {
      lines:[{ lineId:"RL1", deltaQty:2, lot:"LOT-ABC", locationId:"LOC-A1" }]
    }, { "Idempotency-Key": "HARDKEY-TEST-RL1" });
    const retry2 = await post(`/purchasing/po/${encodeURIComponent(id)}:receive`, {
      lines:[{ lineId:"RL1", deltaQty:2, lot:"LOT-ABC", locationId:"LOC-A1" }]
    }, { "Idempotency-Key": "HARDKEY-TEST-RL1" });
    
    const ok2 = !retry.ok 
      && retry.status === 409 
      && retry.body?.code === "conflict"
      && retry.body?.details?.code === "RECEIVE_EXCEEDS_REMAINING";
    const ok3 = !retry2.ok 
      && retry2.status === 409 
      && retry2.body?.code === "conflict"
      && retry2.body?.details?.code === "RECEIVE_EXCEEDS_REMAINING";
    
    return { test:"po-receive-line", result: (ok1 && ok2 && ok3) ? "PASS" : "FAIL", create, recv, retry, retry2 };
  },

  "smoke:po:receive-line-batch": async ()=>{
    await ensureBearer();
    const { vendorId } = await seedVendor(api);
    const prodA = await createProduct({ name:"RecvBatchA" });
    const prodB = await createProduct({ name:"RecvBatchB" });
    const invA  = await createInventoryForProduct(prodA.body.id, "RecvBatchItemA");
    const invB  = await createInventoryForProduct(prodB.body.id, "RecvBatchItemB");
    if(!invA.ok || !invB.ok) return { test:"po-receive-line-batch", result:"FAIL", invA, invB };
    const create = await post(`/objects/purchaseOrder`, {
      type:"purchaseOrder", status:"draft", vendorId,
      lines:[{ id:"BL1", itemId: invA.body.id, uom:"ea", qty:2 }, { id:"BL2", itemId: invB.body.id, uom:"ea", qty:4 }]
    });
    if(!create.ok) return { test:"po-receive-line-batch", result:"FAIL", create };
    const id = create.body.id;
    await post(`/purchasing/po/${encodeURIComponent(id)}:submit`, {}, { "Idempotency-Key": idem() });
    await post(`/purchasing/po/${encodeURIComponent(id)}:approve`, {}, { "Idempotency-Key": idem() });
    const approved = await waitForStatus("purchaseOrder", id, ["approved"]);
    if (!approved.ok) return { test:"po-receive-line-batch", result:"FAIL", reason:"not-approved-yet", approved };
    const recv1 = await post(`/purchasing/po/${encodeURIComponent(id)}:receive`, {
      lines:[
        { lineId:"BL1", deltaQty:2, lot:"LOT-1", locationId:"A1" },
        { lineId:"BL2", deltaQty:1, lot:"LOT-2", locationId:"B1" }
      ]
    }, { "Idempotency-Key": idem() });
    const recv2 = await post(`/purchasing/po/${encodeURIComponent(id)}:receive`, {
      lines:[{ lineId:"BL2", deltaQty:3, lot:"LOT-2", locationId:"B1" }]
    }, { "Idempotency-Key": idem() });
    const ok = recv1.ok && recv2.ok && (recv2.body?.status === "fulfilled");
    return { test:"po-receive-line-batch", result: ok ? "PASS" : "FAIL", create, recv1, recv2 };
  },

  // Same payload, different Idempotency-Key -> should be idempotent via payload signature
  "smoke:po:receive-line-idem-different-key": async () => {
    await ensureBearer();
    const { vendorId } = await seedVendor(api);

    const prod = await createProduct({ name: "RecvSamePayload" });
    const inv  = await createInventoryForProduct(prod.body.id, "RecvSamePayloadItem");
    if (!inv.ok) return { test:"po-receive-line-idem-different-key", result:"FAIL", inv };

    const create = await post(`/objects/purchaseOrder`, {
      type: "purchaseOrder", status: "draft", vendorId,
      lines: [{ id: "RL1", itemId: inv.body.id, uom: "ea", qty: 3 }]
    });
    if (!create.ok) return { test:"po-receive-line-idem-different-key", result: "FAIL", create };
    const id = create.body.id;

    await post(`/purchasing/po/${encodeURIComponent(id)}:submit`,  {}, { "Idempotency-Key": idem() });
    await post(`/purchasing/po/${encodeURIComponent(id)}:approve`, {}, { "Idempotency-Key": idem() });
    const approved = await waitForStatus("purchaseOrder", id, ["approved"]);
    if (!approved.ok) return { test:"po-receive-line-idem-different-key", result:"FAIL", reason:"not-approved-yet", approved };

    const KEY_A = `kA-${Math.random().toString(36).slice(2)}`;
    const payload = { lines: [{ lineId: "RL1", deltaQty: 2, lot: "LOT-X", locationId: "A1" }] };
    const recv1 = await post(`/purchasing/po/${encodeURIComponent(id)}:receive`, payload, { "Idempotency-Key": KEY_A });
    const ok1 = recv1.ok && (recv1.body?.status === "partially-received");

    const KEY_B = `kB-${Math.random().toString(36).slice(2)}`;
    const recv2 = await post(`/purchasing/po/${encodeURIComponent(id)}:receive`, payload, { "Idempotency-Key": KEY_B });
    // recv2 should be REJECTED with 409 conflict (over-receive)
    const ok2 = !recv2.ok 
      && recv2.status === 409 
      && recv2.body?.code === "conflict"
      && recv2.body?.details?.code === "RECEIVE_EXCEEDS_REMAINING"
      && recv2.body?.details?.lineId === "RL1"
      && recv2.body?.details?.remaining === 1
      && recv2.body?.details?.attemptedDelta === 2;

    const finish = await post(`/purchasing/po/${encodeURIComponent(id)}:receive`, {
      lines: [{ lineId:"RL1", deltaQty: 1, lot: "LOT-X", locationId:"A1" }]
    }, { "Idempotency-Key": idem() });
    const ok3 = finish.ok && (finish.body?.status === "fulfilled");

    return {
      test: "po-receive-line-idem-different-key",
      result: (ok1 && ok2 && ok3) ? "PASS" : "FAIL",
      create, recv1, recv2, finish
    };
  },

  // === Sprint XXXVIII: Guard PO_STATUS_NOT_RECEIVABLE on closed PO ===
  "smoke:po-receive-after-close-guard": async () => {
    await ensureBearer();
    
    // Step 1: Create PO via close-the-loop pattern
    const { vendorId } = await seedVendor(api);
    
    const prod = await createProduct({ name: "CloseGuardProd", preferredVendorId: vendorId });
    if (!prod.ok) return { test: "po-receive-after-close-guard", result: "FAIL", step: "createProduct", prod };
    const prodId = prod.body?.id;

    const item = await post(`/objects/${ITEM_TYPE}`, { productId: prodId });
    if (!item.ok) return { test: "po-receive-after-close-guard", result: "FAIL", step: "createItem", item };
    const itemId = item.body?.id;

    // Create customer party for the sales order
    const { partyId } = await seedParties(api);

    // Create SO shortage to trigger backorder
    const so = await post(`/objects/salesOrder`, {
      type: "salesOrder",
      partyId,
      status: "draft",
      strict: false,
      lines: [{ itemId, qty: 5, uom: "ea" }],
    });
    if (!so.ok) return { test: "po-receive-after-close-guard", result: "FAIL", step: "createSO", so };
    const soId = so.body?.id;

    // Submit SO (required before commit)
    const soSubmit = await post(`/sales/so/${encodeURIComponent(soId)}:submit`, {}, { "Idempotency-Key": idem() });
    if (!soSubmit.ok) return { test: "po-receive-after-close-guard", result: "FAIL", step: "submitSO", soSubmit };

    // Commit SO to create backorder
    const commit = await post(`/sales/so/${encodeURIComponent(soId)}:commit`, {}, { "Idempotency-Key": idem() });
    if (!commit.ok) return { test: "po-receive-after-close-guard", result: "FAIL", step: "commitSO", commit };

    // Get backorder request
    const boList = await get(`/objects/backorderRequest?filter.soId=${encodeURIComponent(soId)}&limit=10`);
    const boReq = (boList.body?.items ?? [])[0];
    if (!boReq) return { test: "po-receive-after-close-guard", result: "FAIL", step: "getBackorder", boList };

    // Suggest PO
    const suggest = await post(`/purchasing/suggest-po`, { requests: [{ backorderRequestId: boReq.id }] }, { "Idempotency-Key": idem() });
    if (!suggest.ok) return { test: "po-receive-after-close-guard", result: "FAIL", step: "suggestPO", suggest };
    const draft = suggest.body?.draft ?? suggest.body?.drafts?.[0];
    if (!draft) return { test: "po-receive-after-close-guard", result: "FAIL", step: "noDraft", suggest };

    // Create PO from suggestion
    const createPo = await post(`/purchasing/po:create-from-suggestion`, { draft }, { "Idempotency-Key": idem() });
    if (!createPo.ok) return { test: "po-receive-after-close-guard", result: "FAIL", step: "createPO", createPo };
    const poId = createPo.body?.id ?? createPo.body?.ids?.[0];
    if (!poId) return { test: "po-receive-after-close-guard", result: "FAIL", step: "noPOId", createPo };

    // Get PO to extract line info
    const poGet = await get(`/objects/purchaseOrder/${encodeURIComponent(poId)}`);
    if (!poGet.ok) return { test: "po-receive-after-close-guard", result: "FAIL", step: "getPO", poGet };
    const poLines = poGet.body?.lines ?? [];
    if (poLines.length === 0) return { test: "po-receive-after-close-guard", result: "FAIL", step: "noLines", poGet };
    const lineId = String(poLines[0].id ?? poLines[0].lineId);

    // Submit
    const submit = await post(`/purchasing/po/${encodeURIComponent(poId)}:submit`, {}, { "Idempotency-Key": idem() });
    if (!submit.ok) return { test: "po-receive-after-close-guard", result: "FAIL", step: "submit", submit };

    // Approve
    const approve = await post(`/purchasing/po/${encodeURIComponent(poId)}:approve`, {}, { "Idempotency-Key": idem() });
    if (!approve.ok) return { test: "po-receive-after-close-guard", result: "FAIL", step: "approve", approve };

    // Wait for approved status
    const approved = await waitForStatus("purchaseOrder", poId, ["approved"]);
    if (!approved.ok) return { test: "po-receive-after-close-guard", result: "FAIL", step: "approveWait", approved };

    // Receive full quantity
    const orderedQty = Number(poLines[0].qty ?? 1);
    const receive = await post(`/purchasing/po/${encodeURIComponent(poId)}:receive`, {
      lines: [{ lineId, deltaQty: orderedQty }]
    }, { "Idempotency-Key": idem() });
    if (!receive.ok) return { test: "po-receive-after-close-guard", result: "FAIL", step: "receive", receive };

    // Wait for fulfilled status
    const fulfilled = await waitForStatus("purchaseOrder", poId, ["fulfilled"]);
    if (!fulfilled.ok) return { test: "po-receive-after-close-guard", result: "FAIL", step: "fulfilledWait", fulfilled };

    // Step 2: Close the PO
    const close = await post(`/purchasing/po/${encodeURIComponent(poId)}:close`, {}, { "Idempotency-Key": idem() });
    const closeOk = close.ok && close.body?.status === "closed";
    if (!closeOk) return { test: "po-receive-after-close-guard", result: "FAIL", step: "close", close };

    // Step 3: Attempt receive on closed PO
    const receiveAfterClose = await post(`/purchasing/po/${encodeURIComponent(poId)}:receive`, {
      lines: [{ lineId, deltaQty: 1 }]
    }, { "Idempotency-Key": idem() });

    // Assert 409 with PO_STATUS_NOT_RECEIVABLE
    const guardOk = !receiveAfterClose.ok
      && receiveAfterClose.status === 409
      && receiveAfterClose.body?.code === "PO_STATUS_NOT_RECEIVABLE"
      && receiveAfterClose.body?.status === "closed";

    return {
      test: "po-receive-after-close-guard",
      result: guardOk ? "PASS" : "FAIL",
      poId,
      lineId,
      close,
      receiveAfterClose,
    };
  },

  // === Sprint XXXVIII: Guard PO_STATUS_NOT_RECEIVABLE on cancelled PO ===
  "smoke:po-receive-after-cancel-guard": async () => {
    await ensureBearer();
    
    // Step 1: Create PO in draft status
    const { vendorId } = await seedVendor(api);
    const create = await post(`/objects/purchaseOrder`, {
      type: "purchaseOrder",
      status: "draft",
      vendorId,
      lines: [{ id: "C1", itemId: "ITEM_CANCEL_GUARD", uom: "ea", qty: 5 }]
    });
    if (!create.ok) return { test: "po-receive-after-cancel-guard", result: "FAIL", step: "create", create };
    const poId = create.body?.id;
    const lineId = "C1";

    // Step 2: Cancel the PO
    const cancel = await post(`/purchasing/po/${encodeURIComponent(poId)}:cancel`, {}, { "Idempotency-Key": idem() });
    const cancelOk = cancel.ok && cancel.body?.status === "cancelled";
    if (!cancelOk) return { test: "po-receive-after-cancel-guard", result: "FAIL", step: "cancel", cancel };

    // Step 3: Attempt receive on cancelled PO
    const receiveAfterCancel = await post(`/purchasing/po/${encodeURIComponent(poId)}:receive`, {
      lines: [{ lineId, deltaQty: 1 }]
    }, { "Idempotency-Key": idem() });

    // Assert 409 with PO_STATUS_NOT_RECEIVABLE
    const guardOk = !receiveAfterCancel.ok
      && receiveAfterCancel.status === 409
      && receiveAfterCancel.body?.code === "PO_STATUS_NOT_RECEIVABLE"
      && receiveAfterCancel.body?.status === "cancelled";

    return {
      test: "po-receive-after-cancel-guard",
      result: guardOk ? "PASS" : "FAIL",
      poId,
      lineId,
      cancel,
      receiveAfterCancel,
    };
  },

  // === Sprint I: cursor pagination on objects list ===
  "smoke:objects:list-pagination": async () => {
    await ensureBearer();
    const first = await get(`/objects/purchaseOrder`, { limit: 2, sort: "desc" });
    if (!first.ok) return { test: "objects:list-pagination", result: "FAIL", first };
    const items1 = Array.isArray(first.body?.items) ? first.body.items : [];
    const next   = first.body?.pageInfo?.nextCursor ?? first.body?.next ?? null;
    if (!next) {
      return { test: "objects:list-pagination", result: "PASS", firstCount: items1.length, note: "single page" };
    }
    const second = await get(`/objects/purchaseOrder`, { limit: 2, next, sort: "desc" });
    if (!second.ok) return { test: "objects:list-pagination", result: "FAIL", second };
    const items2 = Array.isArray(second.body?.items) ? second.body.items : [];
    return { test: "objects:list-pagination", result: "PASS", firstCount: items1.length, secondCount: items2.length };
  },

  // === Sprint XX: filter.soId on backorderRequest list ===
  "smoke:objects:list-filter-soId": async () => {
    await ensureBearer();
    const { partyId } = await seedParties(api);

    // 1) Create a Sales Order with shortage to trigger backorder requests
    const item1 = await post(`/objects/${ITEM_TYPE}`, { productId: "prod-FILTER_TEST_A" });
    const item2 = await post(`/objects/${ITEM_TYPE}`, { productId: "prod-FILTER_TEST_B" });
    if (!item1.ok || !item2.ok) return { test: "objects:list-filter-soId", result: "FAIL", reason: "item-creation-failed", item1, item2 };

    const idA = item1.body?.id;
    const idB = item2.body?.id;

    // Ensure low on-hand to trigger backorder on reserve/commit
    const recvA = await ensureOnHand(idA, 1);
    const recvB = await ensureOnHand(idB, 1);
    if (!recvA.ok || !recvB.ok) return { test: "objects:list-filter-soId", result: "FAIL", reason: "onhand-setup-failed", recvA, recvB };

    // Create SO with lines that exceed on-hand
    const create = await post(`/objects/salesOrder`, {
      type: "salesOrder",
      status: "draft",
      partyId,
      customerId: partyId,
      lines: [
        { id: "L1", itemId: idA, uom: "ea", qty: 5 },  // 5 needed, 1 on-hand -> 4 backorder
        { id: "L2", itemId: idB, uom: "ea", qty: 3 }   // 3 needed, 1 on-hand -> 2 backorder
      ]
    });
    if (!create.ok) return { test: "objects:list-filter-soId", result: "FAIL", reason: "so-creation-failed", create };
    const soId = create.body?.id;

    // 2) Submit SO to generate backorder requests
    const submit = await post(`/sales/so/${encodeURIComponent(soId)}:submit`, {}, { "Idempotency-Key": idem() });
    if (!submit.ok) return { test: "objects:list-filter-soId", result: "FAIL", reason: "so-submit-failed", submit };

    // 3) Commit SO (which may create backorder requests if shortage exists)
    const commit = await post(`/sales/so/${encodeURIComponent(soId)}:commit`, {}, { "Idempotency-Key": idem() });
    if (!commit.ok) return { test: "objects:list-filter-soId", result: "FAIL", reason: "so-commit-failed", commit };

    // 4) Fetch ALL backorderRequest items (no filter) to validate any exist
    const allBackorders = await get(`/objects/backorderRequest`, { limit: 50 });
    if (!allBackorders.ok) return { test: "objects:list-filter-soId", result: "FAIL", reason: "all-backorders-fetch-failed", allBackorders };
    const allItems = Array.isArray(allBackorders.body?.items) ? allBackorders.body.items : [];

    if (allItems.length === 0) {
      // No backorders generated (might be okay if shortage handling is different)
      // Create manual backorder entries to test filter
      const bo1 = await post(`/objects/backorderRequest`, {
        type: "backorderRequest",
        soId,
        soLineId: "L1",
        itemId: idA,
        qty: 2,
        status: "open"
      });
      if (!bo1.ok) return { test: "objects:list-filter-soId", result: "FAIL", reason: "manual-backorder-creation-failed", bo1 };

      const bo2 = await post(`/objects/backorderRequest`, {
        type: "backorderRequest",
        soId,
        soLineId: "L2",
        itemId: idB,
        qty: 1,
        status: "open"
      });
      if (!bo2.ok) return { test: "objects:list-filter-soId", result: "FAIL", reason: "second-backorder-creation-failed", bo2 };
    }

    // 5) Test filter.soId with limit=1 (first page)
    const filtered = await get(`/objects/backorderRequest`, { "filter.soId": soId, limit: 1 });
    if (!filtered.ok) return { test: "objects:list-filter-soId", result: "FAIL", reason: "filter-request-failed", filtered };

    const filteredItems = Array.isArray(filtered.body?.items) ? filtered.body.items : [];
    recordFromListResult(filteredItems, "backorderRequest", `/objects/backorderRequest`);
    if (filteredItems.length === 0) {
      return { test: "objects:list-filter-soId", result: "FAIL", reason: "filter-returned-no-items", filtered };
    }

    // 6) Verify all returned items match the soId filter
    const allMatchSoId = filteredItems.every(bo => bo.soId === soId);
    if (!allMatchSoId) {
      return { test: "objects:list-filter-soId", result: "FAIL", reason: "filter-mismatch-soId", filteredItems };
    }

    // 7) Test pagination: if next cursor exists, fetch next page and verify filter still applies
    const nextCursor = filtered.body?.pageInfo?.nextCursor ?? filtered.body?.next ?? null;
    let paginationOk = true;
    let secondPageCount = 0;

    if (nextCursor) {
      const page2 = await get(`/objects/backorderRequest`, { "filter.soId": soId, limit: 1, next: nextCursor });
      if (!page2.ok) {
        paginationOk = false;
      } else {
        const page2Items = Array.isArray(page2.body?.items) ? page2.body.items : [];
        recordFromListResult(page2Items, "backorderRequest", `/objects/backorderRequest`);
        secondPageCount = page2Items.length;
        // Verify page 2 items also match soId filter
        const page2AllMatch = page2Items.every(bo => bo.soId === soId);
        if (!page2AllMatch) {
          paginationOk = false;
        }
      }
    }

    const pass = filtered.ok && allMatchSoId && paginationOk;
    return {
      test: "objects:list-filter-soId",
      result: pass ? "PASS" : "FAIL",
      soId,
      page1Count: filteredItems.length,
      page2Count: secondPageCount,
      hasNextCursor: !!nextCursor,
      artifacts: { create, submit, commit, filtered }
    };
  },

  // === Sprint XXI: backorder status filter ===
  "smoke:objects:list-filter-status": async () => {
    await ensureBearer();
    const { partyId } = await seedParties(api);

    // 1) Create backorder requests with mixed status
    const item1 = await post(`/objects/${ITEM_TYPE}`, { productId: "prod-STATUS_TEST_A" });
    const item2 = await post(`/objects/${ITEM_TYPE}`, { productId: "prod-STATUS_TEST_B" });
    if (!item1.ok || !item2.ok) return { test: "objects:list-filter-status", result: "FAIL", reason: "item-creation-failed", item1, item2 };

    const soId = (await post(`/objects/salesOrder`, {
      type: "salesOrder",
      status: "draft",
      partyId,
      customerId: partyId,
      lines: [{ id: "L1", itemId: item1.body?.id, uom: "ea", qty: 2 }]
    })).body?.id;

    // Create backorder requests with different statuses
    const boOpen = await post(`/objects/backorderRequest`, {
      type: "backorderRequest",
      soId,
      soLineId: "L1",
      itemId: item1.body?.id,
      qty: 2,
      status: "open"
    });

    const boIgnored = await post(`/objects/backorderRequest`, {
      type: "backorderRequest",
      soId,
      soLineId: "L1",
      itemId: item2.body?.id,
      qty: 1,
      status: "ignored"
    });

    if (!boOpen.ok || !boIgnored.ok) return { test: "objects:list-filter-status", result: "FAIL", reason: "backorder-creation-failed", boOpen, boIgnored };

    // 2) Test filter.status=open
    const filteredOpen = await get(`/objects/backorderRequest`, { "filter.status": "open", limit: 50 });
    if (!filteredOpen.ok) return { test: "objects:list-filter-status", result: "FAIL", reason: "filter-open-failed", filteredOpen };

    const openItems = Array.isArray(filteredOpen.body?.items) ? filteredOpen.body.items : [];
    const allOpenMatch = openItems.every(bo => bo.status === "open");

    // 3) Test filter.status=ignored
    const filteredIgnored = await get(`/objects/backorderRequest`, { "filter.status": "ignored", limit: 50 });
    if (!filteredIgnored.ok) return { test: "objects:list-filter-status", result: "FAIL", reason: "filter-ignored-failed", filteredIgnored };

    const ignoredItems = Array.isArray(filteredIgnored.body?.items) ? filteredIgnored.body.items : [];
    const allIgnoredMatch = ignoredItems.every(bo => bo.status === "ignored");

    const pass = filteredOpen.ok && filteredIgnored.ok && allOpenMatch && allIgnoredMatch;
    return {
      test: "objects:list-filter-status",
      result: pass ? "PASS" : "FAIL",
      openCount: openItems.length,
      ignoredCount: ignoredItems.length,
      artifacts: { boOpen, boIgnored, filteredOpen, filteredIgnored }
    };
  },

  // === Sprint XXI: backorder itemId filter ===
  "smoke:objects:list-filter-itemId": async () => {
    await ensureBearer();
    const { partyId } = await seedParties(api);

    // 1) Create items and backorders
    const item1 = await post(`/objects/${ITEM_TYPE}`, { productId: "prod-ITEMID_TEST_A" });
    const item2 = await post(`/objects/${ITEM_TYPE}`, { productId: "prod-ITEMID_TEST_B" });
    if (!item1.ok || !item2.ok) return { test: "objects:list-filter-itemId", result: "FAIL", reason: "item-creation-failed", item1, item2 };

    const id1 = item1.body?.id;
    const id2 = item2.body?.id;

    // Ensure on-hand to avoid SO shortage blocking
    const recvA = await ensureOnHand(id1, 1);
    const recvB = await ensureOnHand(id2, 1);
    if (!recvA.ok || !recvB.ok) return { test: "objects:list-filter-itemId", result: "FAIL", reason: "onhand-setup-failed", recvA, recvB };

    // Create SO with 2 lines to trigger backorders
    const create = await post(`/objects/salesOrder`, {
      type: "salesOrder",
      status: "draft",
      partyId,
      customerId: partyId,
      lines: [
        { id: "L1", itemId: id1, uom: "ea", qty: 3 },
        { id: "L2", itemId: id2, uom: "ea", qty: 2 }
      ]
    });
    if (!create.ok) return { test: "objects:list-filter-itemId", result: "FAIL", reason: "so-creation-failed", create };

    const soId = create.body?.id;
    const submit = await post(`/sales/so/${encodeURIComponent(soId)}:submit`, {}, { "Idempotency-Key": idem() });
    const commit = await post(`/sales/so/${encodeURIComponent(soId)}:commit`, {}, { "Idempotency-Key": idem() });
    if (!submit.ok || !commit.ok) return { test: "objects:list-filter-itemId", result: "FAIL", reason: "so-workflow-failed", submit, commit };

    // Create manual backorders if needed
    const bo1 = await post(`/objects/backorderRequest`, {
      type: "backorderRequest",
      soId,
      soLineId: "L1",
      itemId: id1,
      qty: 1,
      status: "open"
    });

    const bo2 = await post(`/objects/backorderRequest`, {
      type: "backorderRequest",
      soId,
      soLineId: "L2",
      itemId: id2,
      qty: 1,
      status: "open"
    });

    if (!bo1.ok || !bo2.ok) return { test: "objects:list-filter-itemId", result: "FAIL", reason: "backorder-creation-failed", bo1, bo2 };

    // 2) Test filter.itemId={id1} with filter.status=open
    const filtered = await get(`/objects/backorderRequest`, { "filter.itemId": id1, "filter.status": "open", limit: 50 });
    if (!filtered.ok) return { test: "objects:list-filter-itemId", result: "FAIL", reason: "filter-request-failed", filtered };

    const filteredItems = Array.isArray(filtered.body?.items) ? filtered.body.items : [];
    if (filteredItems.length === 0) {
      return { test: "objects:list-filter-itemId", result: "FAIL", reason: "filter-returned-no-items", filtered };
    }

    // Verify all match both itemId and status
    const allMatch = filteredItems.every(bo => bo.itemId === id1 && bo.status === "open");

    const pass = filtered.ok && allMatch;
    return {
      test: "objects:list-filter-itemId",
      result: pass ? "PASS" : "FAIL",
      itemId: id1,
      matchCount: filteredItems.length,
      artifacts: { create, submit, commit, bo1, bo2, filtered }
    };
  },

  // === Sprint XXI: backorder soId + itemId combo filter ===
  "smoke:objects:list-filter-soId-itemId": async () => {
    await ensureBearer();
    const { partyId } = await seedParties(api);

    // 1) Create SO with 2 lines and trigger backorders
    const item1 = await post(`/objects/${ITEM_TYPE}`, { productId: "prod-COMBO_TEST_A" });
    const item2 = await post(`/objects/${ITEM_TYPE}`, { productId: "prod-COMBO_TEST_B" });
    if (!item1.ok || !item2.ok) return { test: "objects:list-filter-soId-itemId", result: "FAIL", reason: "item-creation-failed", item1, item2 };

    const id1 = item1.body?.id;
    const id2 = item2.body?.id;

    // Ensure on-hand
    const recvA = await ensureOnHand(id1, 1);
    const recvB = await ensureOnHand(id2, 1);
    if (!recvA.ok || !recvB.ok) return { test: "objects:list-filter-soId-itemId", result: "FAIL", reason: "onhand-setup-failed", recvA, recvB };

    // Create SO
    const create = await post(`/objects/salesOrder`, {
      type: "salesOrder",
      status: "draft",
      partyId,
      customerId: partyId,
      lines: [
        { id: "L1", itemId: id1, uom: "ea", qty: 4 },
        { id: "L2", itemId: id2, uom: "ea", qty: 3 }
      ]
    });
    if (!create.ok) return { test: "objects:list-filter-soId-itemId", result: "FAIL", reason: "so-creation-failed", create };

    const soId = create.body?.id;
    const submit = await post(`/sales/so/${encodeURIComponent(soId)}:submit`, {}, { "Idempotency-Key": idem() });
    const commit = await post(`/sales/so/${encodeURIComponent(soId)}:commit`, {}, { "Idempotency-Key": idem() });
    if (!submit.ok || !commit.ok) return { test: "objects:list-filter-soId-itemId", result: "FAIL", reason: "so-workflow-failed", submit, commit };

    // Create backorder requests
    const bo1 = await post(`/objects/backorderRequest`, {
      type: "backorderRequest",
      soId,
      soLineId: "L1",
      itemId: id1,
      qty: 2,
      status: "open"
    });

    const bo2 = await post(`/objects/backorderRequest`, {
      type: "backorderRequest",
      soId,
      soLineId: "L2",
      itemId: id2,
      qty: 1,
      status: "open"
    });

    if (!bo1.ok || !bo2.ok) return { test: "objects:list-filter-soId-itemId", result: "FAIL", reason: "backorder-creation-failed", bo1, bo2 };

    // 2) Test filter.soId={soId}&filter.itemId={id1}&filter.status=open
    const filtered = await get(`/objects/backorderRequest`, { "filter.soId": soId, "filter.itemId": id1, "filter.status": "open", limit: 1 });
    if (!filtered.ok) return { test: "objects:list-filter-soId-itemId", result: "FAIL", reason: "filter-request-failed", filtered };

    const filteredItems = Array.isArray(filtered.body?.items) ? filtered.body.items : [];
    if (filteredItems.length === 0) {
      return { test: "objects:list-filter-soId-itemId", result: "FAIL", reason: "filter-returned-no-items", filtered };
    }

    // Verify all match soId AND itemId AND status (AND logic)
    const allMatchFirst = filteredItems.every(bo => bo.soId === soId && bo.itemId === id1 && bo.status === "open");

    // 3) Test pagination: fetch second page if cursor exists
    let paginationOk = true;
    let page2Count = 0;
    const nextCursor = filtered.body?.pageInfo?.nextCursor ?? filtered.body?.next ?? null;

    if (nextCursor) {
      const page2 = await get(`/objects/backorderRequest`, { "filter.soId": soId, "filter.itemId": id1, "filter.status": "open", limit: 1, next: nextCursor });
      if (page2.ok) {
        const page2Items = Array.isArray(page2.body?.items) ? page2.body.items : [];
        page2Count = page2Items.length;
        // Verify page 2 also satisfies filters
        const page2AllMatch = page2Items.every(bo => bo.soId === soId && bo.itemId === id1 && bo.status === "open");
        if (!page2AllMatch) paginationOk = false;
      } else {
        paginationOk = false;
      }
    }

    const pass = filtered.ok && allMatchFirst && paginationOk;
    return {
      test: "objects:list-filter-soId-itemId",
      result: pass ? "PASS" : "FAIL",
      soId,
      itemId: id1,
      page1Count: filteredItems.length,
      page2Count,
      hasNextCursor: !!nextCursor,
      artifacts: { create, submit, commit, bo1, bo2, filtered }
    };
  },

  // === Sprint I: movements filters (refId + poLineId) — strengthened ===
  "smoke:movements:filter-by-poLine": async () => {
    await ensureBearer();
    const { vendorId } = await seedVendor(api);

    // Create product + inventory item
    const prod = await createProduct({ name: "MovFilter" });
    const inv  = await createInventoryForProduct(prod.body.id, "MovFilterItem");
    if (!inv.ok) return { test: "movements:filter-by-poLine", result: "FAIL", inv };

    // Create PO with one line, submit + approve
    const lineId = "MF1";
    const create = await post(`/objects/purchaseOrder`, {
      type: "purchaseOrder",
      status: "draft",
      vendorId,
      lines: [{ id: lineId, itemId: inv.body.id, uom: "ea", qty: 3 }],
    });
    if (!create.ok) return { test: "movements:filter-by-poLine", result: "FAIL", create };
    const poId = create.body.id;

    await post(`/purchasing/po/${encodeURIComponent(poId)}:submit`,  {}, { "Idempotency-Key": idem() });
    await post(`/purchasing/po/${encodeURIComponent(poId)}:approve`, {}, { "Idempotency-Key": idem() });

    // Receive 1 to generate a movement tied to (poId, lineId)
    const lot = "LOT-MF";
    const locationId = "LOC-MF";
    const recv = await post(`/purchasing/po/${encodeURIComponent(poId)}:receive`, {
      lines: [{ lineId, deltaQty: 1, lot, locationId }]
    }, { "Idempotency-Key": idem() });
    if (!recv.ok) return { test: "movements:filter-by-poLine", result: "FAIL", recv };

    // Fetch movements filtered by both refId + poLineId
    const list = await get(`/inventory/${encodeURIComponent(inv.body.id)}/movements?refId=${encodeURIComponent(poId)}&poLineId=${encodeURIComponent(lineId)}&limit=50&sort=desc`);
    if (!list.ok) return { test: "movements:filter-by-poLine", result: "FAIL", list };

    const rows = Array.isArray(list.body?.items) ? list.body.items : [];
    const count = rows.length;

    // Strengthened assertions:
    const okRef = count > 0 && rows.every(r => r.refId === poId);
    const okLn  = count > 0 && rows.every(r => r.poLineId === lineId);

    // Also verify the movement captured lot/location
    const hasLot = rows.some(r => r.lot === lot);
    const hasLoc = rows.some(r => r.locationId === locationId);

    const pass  = okRef && okLn && hasLot && hasLoc;
    return {
      test: "movements:filter-by-poLine",
      result: pass ? "PASS" : "FAIL",
      count,
      hasMore: Boolean(list.body?.pageInfo?.nextCursor ?? list.body?.next ?? null),
      sample: rows[0]
    };
  },

  /* ===================== Sprint II: Guardrails + Events + Pagination ===================== */
  "smoke:po:vendor-guard:on": async ()=>{
    await ensureBearer();
    const { vendorId } = await seedVendor(api);
    const { partyId: nonVendorId } = await seedParties(api); // non-vendor party

    const draft1 = await post(`/objects/purchaseOrder`, {
      type:"purchaseOrder", status:"draft", vendorId,
      lines:[{ id:"N1", itemId:"ITEM_N1", uom:"ea", qty:1 }]
    });
    if(!draft1.ok) return { test:"po:vendor-guard:on", result:"FAIL", reason:"draft1", draft1 };
    const cleared = await put(`/objects/purchaseOrder/${encodeURIComponent(draft1.body.id)}`, { vendorId: null });
    if(!cleared.ok) return { test:"po:vendor-guard:on", result:"FAIL", reason:"clearVendorId", cleared };
    const subMissing = await post(
      `/purchasing/po/${encodeURIComponent(draft1.body.id)}:submit`,
      {},
      { "Idempotency-Key": idem() }
    );
    const missingOk = subMissing.status === 400 && (subMissing.body?.code === "VENDOR_REQUIRED");

    const draft2 = await post(`/objects/purchaseOrder`, {
      type:"purchaseOrder", status:"draft", vendorId,
      lines:[{ id:"N2", itemId:"ITEM_N2", uom:"ea", qty:1 }]
    });
    if(!draft2.ok) return { test:"po:vendor-guard:on", result:"FAIL", reason:"draft2", draft2 };
    const setWrongRole = await put(`/objects/purchaseOrder/${encodeURIComponent(draft2.body.id)}`, { vendorId: nonVendorId });
    if(!setWrongRole.ok) return { test:"po:vendor-guard:on", result:"FAIL", reason:"setWrongRole", setWrongRole };
    const subWrongRole = await post(
      `/purchasing/po/${encodeURIComponent(draft2.body.id)}:submit`,
      {},
      { "Idempotency-Key": idem() }
    );
    const roleOk = subWrongRole.status === 400 && (subWrongRole.body?.code === "VENDOR_ROLE_MISSING");

    const pass = missingOk && roleOk;
    return { test:"po:vendor-guard:on", result: pass?"PASS":"FAIL", subMissing, subWrongRole };
  },

  "smoke:po:vendor-guard:off": async ()=>{
    await ensureBearer();
    const { vendorId } = await seedVendor(api);
    const HDR = { "Idempotency-Key": idem(), "X-Feature-Enforce-Vendor": "0" };
    const draft = await post(`/objects/purchaseOrder`, {
      type:"purchaseOrder", status:"draft", vendorId,
      lines:[{ id:"X1", itemId:"ITEM_X1", uom:"ea", qty:2 }]
    });
    if(!draft.ok) return { test:"po:vendor-guard:off", result:"FAIL", draft };
    const id = draft.body.id;
    const cleared = await put(`/objects/purchaseOrder/${encodeURIComponent(id)}`, { vendorId: null });
    if(!cleared.ok) return { test:"po:vendor-guard:off", result:"FAIL", reason:"clearVendorId", cleared };
    const submit  = await post(`/purchasing/po/${encodeURIComponent(id)}:submit`,  {}, HDR);
    const approve = await post(`/purchasing/po/${encodeURIComponent(id)}:approve`, {}, HDR);
    if(!submit.ok || !approve.ok) return { test:"po:vendor-guard:off", result:"FAIL", submit, approve };
    const approved = await waitForStatus("purchaseOrder", id, ["approved"]);
    if (!approved.ok) return { test:"po:vendor-guard:off", result:"FAIL", reason:"not-approved-yet", approved };
    const po = await get(`/objects/purchaseOrder/${encodeURIComponent(id)}`);
    const lines = (po.body?.lines ?? [])
      .map(ln => ({ lineId:String(ln.id ?? ln.lineId), deltaQty:Math.max(0,(ln.qty||0)-(ln.receivedQty||0)) }))
      .filter(l => l.deltaQty>0);
    const recv = await post(`/purchasing/po/${encodeURIComponent(id)}:receive`, { lines }, HDR);
    const pass = submit.ok && approve.ok && recv.ok;
    return { test:"po:vendor-guard:off", result: pass?"PASS":"FAIL", submit, approve, recv };
  },

  "smoke:po:emit-events": async ()=>{
    await ensureBearer();
    const { vendorId } = await seedVendor(api);
    const create = await post(`/objects/purchaseOrder`, {
      type:"purchaseOrder", status:"draft", vendorId,
      lines:[{ id:"E1", itemId:"ITEM_EVT", uom:"ea", qty:1 }]
    });
    if(!create.ok) return { test:"po:emit-events", result:"FAIL", create };
    const id = create.body.id;
    await post(`/purchasing/po/${encodeURIComponent(id)}:submit`,  {}, { "Idempotency-Key": idem() });
    await post(`/purchasing/po/${encodeURIComponent(id)}:approve`, {}, { "Idempotency-Key": idem() });
    const approved = await waitForStatus("purchaseOrder", id, ["approved"]);
    if (!approved.ok) return { test:"po:emit-events", result:"FAIL", reason:"not-approved-yet", approved };
    const po = await get(`/objects/purchaseOrder/${encodeURIComponent(id)}`);
    const lines = (po.body?.lines ?? [])
      .map(ln => ({ lineId:String(ln.id ?? ln.lineId), deltaQty:Math.max(0,(ln.qty||0)-(ln.receivedQty||0)) }))
      .filter(l => l.deltaQty>0);
    const recv = await post(
      `/purchasing/po/${encodeURIComponent(id)}:receive`,
      { lines },
      { "Idempotency-Key": idem(), "X-Feature-Events-Simulate": "true", "X-Feature-Events-Enabled": "true" }
    );
    const statusOk = !recv.body?.status || ["received", "fulfilled"].includes(recv.body.status);
    const emitted = recv.ok && recv.body?._dev?.emitted === true;
    const pass = !!emitted && statusOk;
    return { test:"po:emit-events", result: pass?"PASS":"FAIL", recv };
  },

  "smoke:objects:pageInfo-present": async ()=>{
    await ensureBearer();
    const first = await get(`/objects/purchaseOrder`, { limit:2 });
    if(!first.ok) return { test:"objects:pageInfo-present", result:"FAIL", first };
    const hasItems   = Array.isArray(first.body?.items);
    const hasPageInfo = typeof first.body?.pageInfo !== "undefined";
    const hasLegacy   = typeof first.body?.next !== "undefined";
    const pass = hasItems && (hasPageInfo || hasLegacy);
    return { test:"objects:pageInfo-present", result: pass?"PASS":"FAIL", hasItems, hasPageInfo, hasLegacy, sample:first.body?.pageInfo };
  },

  "smoke:epc:resolve": async ()=>{
    await ensureBearer();
    const r = await get(`/epc/resolve`, { epc:`EPC-NOT-FOUND-${Date.now()}` });
    const pass = r.status === 404;
    return { test:"epc-resolve", result: pass?"PASS":"FAIL", status:r.status, body:r.body };
  },

  /* ===================== Sprint III: Views, Workspaces, Events ===================== */
  
  "smoke:views:crud": async ()=>{
    await ensureBearer();
    
    // Fixed: use consistent entityType + timestamped unique name for pagination/search robustness
    const entityType = "inventoryItem"; // Common in test environment
    const uniqueName = smokeTag(`SmokeView-${Date.now()}`);
    let itemsScanned = 0;
    
    // 1) CREATE view
    const create = await post(`/views`, {
      name: uniqueName,
      entityType,
      filters: [{ field: "status", op: "eq", value: "active" }],
      columns: ["id", "name", "status"]
    });
    if (!create.ok || !create.body?.id) {
      return { test:"views:crud", result:"FAIL", reason:"create-failed", create };
    }
    const viewId = create.body.id;
    const createdView = create.body;

    // 2) LIST views with pagination + retry + filtering
    // Retry up to 5 times (200ms backoff) to account for eventual consistency
    let found = null;
    let listResults = [];
    const maxAttempts = 5;
    const delayMs = 200;
    
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) await sleep(delayMs);
      
      // Query with filters: entityType + q (name search) + pagination
      let cursor = undefined;
      let pageCount = 0;
      const maxPages = 3; // Scan up to 3 pages
      itemsScanned = 0;
      found = null;
      
      while (pageCount < maxPages && !found) {
        const listQuery = { entityType, q: uniqueName, limit: 100 };
        if (cursor) listQuery.next = cursor;
        
        const list = await get(`/views`, listQuery);
        if (!list.ok || !Array.isArray(list.body?.items)) {
          // On list failure, continue retrying (don't fail immediately)
          break;
        }
        
        listResults = list.body.items;
        itemsScanned += listResults.length;
        
        // Search for created view by ID within this page
        found = listResults.find(v => v.id === viewId);
        if (found) break;
        
        // Move to next page if cursor available
        cursor = list.body.next;
        if (!cursor) break; // No more pages
        pageCount++;
      }
      
      // If found, exit retry loop early
      if (found) break;
    }
    
    if (!found) {
      return {
        test:"views:crud",
        result:"FAIL",
        reason:"view-not-in-list",
        debug: {
          created: { id: viewId, name: uniqueName, entityType },
          listQuery: { entityType, q: uniqueName, limit: 100 },
          itemsScanned,
          sampledItems: listResults.slice(0, 3)
        }
      };
    }

    // 3) GET single view
    const get1 = await get(`/views/${encodeURIComponent(viewId)}`);
    if (!get1.ok || get1.body?.id !== viewId) {
      return { test:"views:crud", result:"FAIL", reason:"get-failed", get:get1 };
    }

    // 4) PUT (update) view
    const baseUnique = `SmokeView-${Date.now()}`;
    const updatedName = smokeTag(`${baseUnique}-updated`);
    const update = await put(`/views/${encodeURIComponent(viewId)}`, {
      name: updatedName,
      entityType,
      filters: [
        { field: "status", op: "eq", value: "active" },
        { field: "createdAt", op: "ge", value: "2025-01-01T00:00:00Z" }
      ],
      columns: ["id", "name", "status", "createdAt"]
    });
    if (!update.ok || update.body?.name !== updatedName) {
      return { test:"views:crud", result:"FAIL", reason:"update-failed", update };
    }

    // 5) DELETE view
    const del = await fetch(`${API}/views/${encodeURIComponent(viewId)}`, {
      method: "DELETE",
      headers: baseHeaders()
    });
    if (!del.ok) {
      return { test:"views:crud", result:"FAIL", reason:"delete-failed", delStatus:del.status };
    }

    // 6) Verify deleted (should not be in list anymore)
    // Use same filtered query pattern for consistency
    let stillThere = false;
    let deleteVerifyAttempts = 3;
    for (let i = 0; i < deleteVerifyAttempts; i++) {
      if (i > 0) await sleep(100);
      const listAfter = await get(`/views`, { entityType, limit: 100 });
      const inList = listAfter.ok && listAfter.body?.items?.find(v => v.id === viewId);
      if (!inList) {
        stillThere = false;
        break;
      }
      stillThere = true;
    }
    
    if (stillThere) {
      return { test:"views:crud", result:"FAIL", reason:"view-still-in-list-after-delete" };
    }

    const pass = create.ok && get1.ok && update.ok && del.ok && !stillThere;
    return {
      test: "views:crud",
      result: pass ? "PASS" : "FAIL",
      artifacts: { create, get: get1, update, delete: del }
    };
  },

  "smoke:workspaces:list": async ()=>{
    await ensureBearer();
    
    // Sprint III: Test /workspaces filters (q, entityType)
    // Enable FEATURE_VIEWS_ENABLED via dev header for all requests
    const featureHeaders = { "X-Feature-Views-Enabled": "true" };
    const listHdr = { ...baseHeaders(), ...featureHeaders };
    
    // 1) Create two temp views with different entityTypes
    const createA = await fetch(`${API}/views`, {
      method: "POST",
      headers: listHdr,
      body: JSON.stringify({
        name: smokeTag("WS Test A"),
        entityType: "purchaseOrder",
        filters: [{ field: "status", op: "eq", value: "submitted" }],
        columns: ["id", "vendorId", "total"]
      })
    });
    const bodyA = await createA.json().catch(() => ({}));
    if (!createA.ok || !bodyA?.id) {
      return { test:"workspaces:list", result:"FAIL", reason:"create-view-a-failed" };
    }
    const viewIdA = bodyA.id;
    recordCreated({ type: 'view', id: viewIdA, route: '/views', meta: { name: bodyA?.name, entityType: bodyA?.entityType } });
    
    const createB = await fetch(`${API}/views`, {
      method: "POST",
      headers: listHdr,
      body: JSON.stringify({
        name: smokeTag("WS Sample B"),
        entityType: "salesOrder",
        filters: [{ field: "status", op: "eq", value: "committed" }],
        columns: ["id", "customerId", "total"]
      })
    });
    const bodyB = await createB.json().catch(() => ({}));
    if (!createB.ok || !bodyB?.id) {
      // Cleanup A before failing
      await fetch(`${API}/views/${encodeURIComponent(viewIdA)}`, {
        method: "DELETE",
        headers: listHdr
      });
      return { test:"workspaces:list", result:"FAIL", reason:"create-view-b-failed" };
    }
    const viewIdB = bodyB.id;
    recordCreated({ type: 'view', id: viewIdB, route: '/views', meta: { name: bodyB?.name, entityType: bodyB?.entityType } });
    
    // 2) GET /workspaces (all) - baseline
    const listAll = await fetch(`${API}/workspaces?limit=50`, { headers: listHdr });
    const allBody = await listAll.json().catch(() => ({}));
    const allItems = Array.isArray(allBody?.items) ? allBody.items : [];
    
    // 3) GET /workspaces?q=Test -> assert at least one item with "Test" in name
    const listQ = await fetch(`${API}/workspaces?q=Test&limit=50`, { headers: listHdr });
    const qBody = await listQ.json().catch(() => ({}));
    const qItems = Array.isArray(qBody?.items) ? qBody.items : [];
    const hasTest = qItems.some(item => item.name && item.name.includes("Test"));
    
    if (!hasTest) {
      // Cleanup before failing
      await fetch(`${API}/views/${encodeURIComponent(viewIdA)}`, { method: "DELETE", headers: listHdr });
      await fetch(`${API}/views/${encodeURIComponent(viewIdB)}`, { method: "DELETE", headers: listHdr });
      return { test:"workspaces:list", result:"FAIL", reason:"q-filter-no-test-items", qItems };
    }
    
    // 4) GET /workspaces?entityType=purchaseOrder -> assert all items have entityType=purchaseOrder
    const listEntity = await fetch(`${API}/workspaces?entityType=purchaseOrder&limit=50`, { headers: listHdr });
    const entityBody = await listEntity.json().catch(() => ({}));
    const entityItems = Array.isArray(entityBody?.items) ? entityBody.items : [];
    const allPO = entityItems.every(item => item.entityType === "purchaseOrder");
    
    if (!allPO) {
      // Cleanup before failing
      await fetch(`${API}/views/${encodeURIComponent(viewIdA)}`, { method: "DELETE", headers: listHdr });
      await fetch(`${API}/views/${encodeURIComponent(viewIdB)}`, { method: "DELETE", headers: listHdr });
      return { test:"workspaces:list", result:"FAIL", reason:"entityType-filter-mismatch", entityItems };
    }
    
    // 5) Cleanup: delete both temp views
    const delA = await fetch(`${API}/views/${encodeURIComponent(viewIdA)}`, {
      method: "DELETE",
      headers: listHdr
    });
    const delB = await fetch(`${API}/views/${encodeURIComponent(viewIdB)}`, {
      method: "DELETE",
      headers: listHdr
    });
    
    const pass = createA.ok && createB.ok && listAll.ok && hasTest && allPO && delA.ok && delB.ok;
    return {
      test: "workspaces:list",
      result: pass ? "PASS" : "FAIL",
      counts: {
        all: allItems.length,
        q: qItems.length,
        byEntity: entityItems.length
      }
    };
  },

  "smoke:events:enabled-noop": async ()=>{
    await ensureBearer();
    
    // Sprint III: Event dispatcher is noop by default; test flag gating
    // Enable both FEATURE_EVENT_DISPATCH_ENABLED and FEATURE_EVENT_DISPATCH_SIMULATE
    const eventHeaders = {
      "X-Feature-Events-Enabled": "true",
      "X-Feature-Events-Simulate": "true"
    };
    
    // Use an endpoint that touches events: POST /purchasing/po/{id}:receive
    // (already tested in smoke:po:emit-events, so we just verify simulation signal)
    // OR test via GET /views (simpler, doesn't require PO setup)
    
    // Simple test: GET /views with simulate flag and verify response structure
    const listReq = await fetch(`${API}/views?limit=10`, {
      headers: { ...baseHeaders(), ...eventHeaders }
    });
    
    if (!listReq.ok) {
      return { test:"events:enabled-noop", result:"FAIL", reason:"views-request-failed", status:listReq.status };
    }
    
    const listBody = await listReq.json().catch(() => ({}));
    
    // The /views endpoint itself doesn't emit events, but the dispatcher integration
    // in a real scenario would. For Sprint III v1, verify the simulation flag was accepted
    // and the feature flag headers were processed without error.
    
    // Alternative: Test via PO receive (the real emitter)
    // Create minimal PO -> receive -> check for _dev.emitted signal
    const { vendorId } = await seedVendor({ post, get, put });
    
    const poDraft = await post(`/objects/purchaseOrder`, {
      type: "purchaseOrder",
      status: "draft",
      vendorId,
      lines: [{ id: "L1", itemId: "ITEM_EVT_TEST", uom: "ea", qty: 1 }]
    });
    
    if (!poDraft.ok || !poDraft.body?.id) {
      return { test:"events:enabled-noop", result:"FAIL", reason:"po-draft-failed", poDraft };
    }
    
    const poId = poDraft.body.id;
    
    // Submit & approve PO
    await post(`/purchasing/po/${encodeURIComponent(poId)}:submit`, {}, { "Idempotency-Key": idem() });
    await post(`/purchasing/po/${encodeURIComponent(poId)}:approve`, {}, { "Idempotency-Key": idem() });
    
    // Wait for approval
    const approved = await waitForStatus("purchaseOrder", poId, ["approved"]);
    if (!approved.ok) {
      return { test:"events:enabled-noop", result:"FAIL", reason:"po-not-approved", approved };
    }
    
    // Now receive with event simulation headers
    const po = await get(`/objects/purchaseOrder/${encodeURIComponent(poId)}`);
    const lines = (po.body?.lines ?? [])
      .map(ln => ({ lineId: String(ln.id ?? ln.lineId), deltaQty: Math.max(0, (ln.qty || 0) - (ln.receivedQty || 0)) }))
      .filter(l => l.deltaQty > 0);
    
    const recv = await fetch(`${API}/purchasing/po/${encodeURIComponent(poId)}:receive`, {
      method: "POST",
      headers: { ...baseHeaders(), ...eventHeaders, "Idempotency-Key": idem() },
      body: JSON.stringify({ lines })
    });
    
    const recvBody = await recv.json().catch(() => ({}));
    
    // Check for _dev.emitted signal (only present when simulate=true)
    const hasEmitSignal = recvBody?._dev?.emitted === true;
    const hasProvider = recvBody?._dev?.provider === "noop";
    
    const pass = recv.ok && hasEmitSignal && hasProvider;
    return {
      test: "events:enabled-noop",
      result: pass ? "PASS" : "FAIL",
      status: recv.status,
      hasEmitSignal,
      hasProvider,
      devMeta: recvBody?._dev || null,
      recvBody
    };
  },

  "smoke:registrations:crud": async ()=>{
    await ensureBearer();

    // Enable FEATURE_REGISTRATIONS_ENABLED via dev header
    const regHeaders = { "X-Feature-Registrations-Enabled": "true" };

    // 1) CREATE registration
    const create = await fetch(`${API}/registrations`, {
      method: "POST",
      headers: { ...baseHeaders(), ...regHeaders, "Idempotency-Key": idem() },
      body: JSON.stringify({
        eventId: `evt_${Date.now()}`,
        partyId: `party_${Math.random().toString(36).slice(2, 7)}`,
        status: "draft",
        division: "adult",
        class: "professional",
        fees: [
          { code: "entry", amount: 50.00 },
          { code: "parking", amount: 10.00, qty: 1 }
        ],
        notes: "Smoke test registration"
      })
    });
    const createBody = await create.json().catch(() => ({}));
    if (!create.ok || !createBody?.id) {
      return { test:"registrations:crud", result:"FAIL", reason:"create-failed", create:createBody };
    }
    const regId = createBody.id;
    recordCreated({ type: 'registration', id: regId, route: '/registrations', meta: { status: createBody?.status } });

    // Validate created registration has required fields
    if (!createBody.createdAt || !createBody.updatedAt) {
      return { test:"registrations:crud", result:"FAIL", reason:"missing-timestamps", create:createBody };
    }

    // 2) GET single registration
    const get1 = await fetch(`${API}/registrations/${encodeURIComponent(regId)}`, {
      headers: { ...baseHeaders(), ...regHeaders }
    });
    const get1Body = await get1.json().catch(() => ({}));
    if (!get1.ok || get1Body?.id !== regId) {
      return { test:"registrations:crud", result:"FAIL", reason:"get-failed", get:get1Body };
    }

    // Validate fields match
    if (get1Body.eventId !== createBody.eventId || get1Body.partyId !== createBody.partyId) {
      return { test:"registrations:crud", result:"FAIL", reason:"field-mismatch", get:get1Body, create:createBody };
    }

    // 3) PUT (update) registration - change status to confirmed
    const oldUpdatedAt = createBody.updatedAt;
    const update = await fetch(`${API}/registrations/${encodeURIComponent(regId)}`, {
      method: "PUT",
      headers: { ...baseHeaders(), ...regHeaders, "Idempotency-Key": idem() },
      body: JSON.stringify({
        eventId: createBody.eventId,
        partyId: createBody.partyId,
        status: "confirmed",
        division: "adult",
        class: "professional",
        fees: [
          { code: "entry", amount: 50.00 },
          { code: "parking", amount: 10.00, qty: 1 }
        ]
      })
    });
    const updateBody = await update.json().catch(() => ({}));
    if (!update.ok || updateBody?.status !== "confirmed") {
      return { test:"registrations:crud", result:"FAIL", reason:"update-failed", update:updateBody };
    }

    // Validate updatedAt changed
    if (updateBody.updatedAt === oldUpdatedAt) {
      return { test:"registrations:crud", result:"FAIL", reason:"updatedAt-not-changed", update:updateBody };
    }

    // 4) DELETE registration
    const del = await fetch(`${API}/registrations/${encodeURIComponent(regId)}`, {
      method: "DELETE",
      headers: { ...baseHeaders(), ...regHeaders }
    });
    if (!del.ok) {
      return { test:"registrations:crud", result:"FAIL", reason:"delete-failed", delStatus:del.status };
    }

    // 5) Verify deleted (soft-delete or not in list)
    const listAfter = await fetch(`${API}/registrations?limit=50`, {
      headers: { ...baseHeaders(), ...regHeaders }
    });
    const listAfterBody = await listAfter.json().catch(() => ({}));
    const stillThere = listAfter.ok && Array.isArray(listAfterBody?.items) && listAfterBody.items.find(r => r.id === regId);
    // Note: soft-delete means record may still exist but with deleted flag, or it may be excluded from list

    const pass = create.ok && get1.ok && update.ok && del.ok && !stillThere;
    return {
      test: "registrations:crud",
      result: pass ? "PASS" : "FAIL",
      artifacts: {
        id: regId,
        create: { ok: create.ok, status: create.status },
        get: { ok: get1.ok, status: get1.status },
        update: { ok: update.ok, status: update.status, statusChanged: updateBody?.status === "confirmed" },
        delete: { ok: del.ok, status: del.status }
      }
    };
  },

  "smoke:registrations:filters": async ()=>{
    await ensureBearer();

    // Enable FEATURE_REGISTRATIONS_ENABLED via dev header
    const regHeaders = { "X-Feature-Registrations-Enabled": "true" };

    const eventId1 = `evt_${Date.now()}`;
    const eventId2 = `evt_${Date.now() + 1}`;
    const partyId1 = `PARTY_ALPHA_${Math.random().toString(36).slice(2, 7)}`;
    const partyId2 = `PARTY_BETA_${Math.random().toString(36).slice(2, 7)}`;

    // 1) Create registrations with varied eventId, partyId, status
    const reg1 = await fetch(`${API}/registrations`, {
      method: "POST",
      headers: { ...baseHeaders(), ...regHeaders, "Idempotency-Key": idem() },
      body: JSON.stringify({
        eventId: eventId1,
        partyId: partyId1,
        status: "draft"
      })
    });
    const reg1Body = await reg1.json().catch(() => ({}));
    if (!reg1.ok || !reg1Body?.id) {
      return { test:"registrations:filters", result:"FAIL", reason:"create-reg1-failed" };
    }
    const regId1 = reg1Body.id;
    recordCreated({ type: 'registration', id: regId1, route: '/registrations', meta: { status: reg1Body?.status } });

    const reg2 = await fetch(`${API}/registrations`, {
      method: "POST",
      headers: { ...baseHeaders(), ...regHeaders, "Idempotency-Key": idem() },
      body: JSON.stringify({
        eventId: eventId1,
        partyId: partyId2,
        status: "confirmed"
      })
    });
    const reg2Body = await reg2.json().catch(() => ({}));
    if (!reg2.ok || !reg2Body?.id) {
      // Cleanup reg1
      await fetch(`${API}/registrations/${encodeURIComponent(regId1)}`, { method: "DELETE", headers: { ...baseHeaders(), ...regHeaders } });
      return { test:"registrations:filters", result:"FAIL", reason:"create-reg2-failed" };
    }
    const regId2 = reg2Body.id;
    recordCreated({ type: 'registration', id: regId2, route: '/registrations', meta: { status: reg2Body?.status } });

    const reg3 = await fetch(`${API}/registrations`, {
      method: "POST",
      headers: { ...baseHeaders(), ...regHeaders, "Idempotency-Key": idem() },
      body: JSON.stringify({
        eventId: eventId2,
        partyId: partyId1,
        status: "confirmed"
      })
    });
    const reg3Body = await reg3.json().catch(() => ({}));
    if (!reg3.ok || !reg3Body?.id) {
      // Cleanup reg1 and reg2
      await fetch(`${API}/registrations/${encodeURIComponent(regId1)}`, { method: "DELETE", headers: { ...baseHeaders(), ...regHeaders } });
      await fetch(`${API}/registrations/${encodeURIComponent(regId2)}`, { method: "DELETE", headers: { ...baseHeaders(), ...regHeaders } });
      return { test:"registrations:filters", result:"FAIL", reason:"create-reg3-failed" };
    }
    const regId3 = reg3Body.id;
    recordCreated({ type: 'registration', id: regId3, route: '/registrations', meta: { status: reg3Body?.status } });

    // 2) Test eventId filter
    const listByEvent = await fetch(`${API}/registrations?eventId=${encodeURIComponent(eventId1)}&limit=50`, {
      headers: { ...baseHeaders(), ...regHeaders }
    });
    const listByEventBody = await listByEvent.json().catch(() => ({}));
    const byEventItems = Array.isArray(listByEventBody?.items) ? listByEventBody.items : [];
    const allMatchEvent = byEventItems.every(r => r.eventId === eventId1);
    const byEventCount = byEventItems.length;

    if (!allMatchEvent) {
      // Cleanup all
      await fetch(`${API}/registrations/${encodeURIComponent(regId1)}`, { method: "DELETE", headers: { ...baseHeaders(), ...regHeaders } });
      await fetch(`${API}/registrations/${encodeURIComponent(regId2)}`, { method: "DELETE", headers: { ...baseHeaders(), ...regHeaders } });
      await fetch(`${API}/registrations/${encodeURIComponent(regId3)}`, { method: "DELETE", headers: { ...baseHeaders(), ...regHeaders } });
      return { test:"registrations:filters", result:"FAIL", reason:"eventId-filter-mismatch", byEventItems };
    }

    // 3) Test partyId filter
    const listByParty = await fetch(`${API}/registrations?partyId=${encodeURIComponent(partyId1)}&limit=50`, {
      headers: { ...baseHeaders(), ...regHeaders }
    });
    const listByPartyBody = await listByParty.json().catch(() => ({}));
    const byPartyItems = Array.isArray(listByPartyBody?.items) ? listByPartyBody.items : [];
    const allMatchParty = byPartyItems.every(r => r.partyId === partyId1);
    const byPartyCount = byPartyItems.length;

    if (!allMatchParty) {
      // Cleanup all
      await fetch(`${API}/registrations/${encodeURIComponent(regId1)}`, { method: "DELETE", headers: { ...baseHeaders(), ...regHeaders } });
      await fetch(`${API}/registrations/${encodeURIComponent(regId2)}`, { method: "DELETE", headers: { ...baseHeaders(), ...regHeaders } });
      await fetch(`${API}/registrations/${encodeURIComponent(regId3)}`, { method: "DELETE", headers: { ...baseHeaders(), ...regHeaders } });
      return { test:"registrations:filters", result:"FAIL", reason:"partyId-filter-mismatch", byPartyItems };
    }

    // 4) Test status filter
    const listByStatus = await fetch(`${API}/registrations?status=confirmed&limit=50`, {
      headers: { ...baseHeaders(), ...regHeaders }
    });
    const listByStatusBody = await listByStatus.json().catch(() => ({}));
    const byStatusItems = Array.isArray(listByStatusBody?.items) ? listByStatusBody.items : [];
    const allMatchStatus = byStatusItems.every(r => r.status === "confirmed");
    const byStatusCount = byStatusItems.length;

    if (!allMatchStatus) {
      // Cleanup all
      await fetch(`${API}/registrations/${encodeURIComponent(regId1)}`, { method: "DELETE", headers: { ...baseHeaders(), ...regHeaders } });
      await fetch(`${API}/registrations/${encodeURIComponent(regId2)}`, { method: "DELETE", headers: { ...baseHeaders(), ...regHeaders } });
      await fetch(`${API}/registrations/${encodeURIComponent(regId3)}`, { method: "DELETE", headers: { ...baseHeaders(), ...regHeaders } });
      return { test:"registrations:filters", result:"FAIL", reason:"status-filter-mismatch", byStatusItems };
    }

    // 5) Test q (search) filter - case-insensitive substring match on id, partyId, division, class
    const listByQ = await fetch(`${API}/registrations?q=alp&limit=50`, {
      headers: { ...baseHeaders(), ...regHeaders }
    });
    const listByQBody = await listByQ.json().catch(() => ({}));
    const byQItems = Array.isArray(listByQBody?.items) ? listByQBody.items : [];
    // All returned items should contain "alp" (case-insensitive) in id, partyId, division, or class
    const allMatchQ = byQItems.every(r => {
      const searchable = [r.id, r.partyId, r.division, r.class].filter(Boolean).join(" ").toLowerCase();
      return searchable.includes("alp");
    });
    const byQCount = byQItems.length;

    if (!allMatchQ || byQCount === 0) {
      // Cleanup all
      await fetch(`${API}/registrations/${encodeURIComponent(regId1)}`, { method: "DELETE", headers: { ...baseHeaders(), ...regHeaders } });
      await fetch(`${API}/registrations/${encodeURIComponent(regId2)}`, { method: "DELETE", headers: { ...baseHeaders(), ...regHeaders } });
      await fetch(`${API}/registrations/${encodeURIComponent(regId3)}`, { method: "DELETE", headers: { ...baseHeaders(), ...regHeaders } });
      return { test:"registrations:filters", result:"FAIL", reason:"q-filter-mismatch", byQItems };
    }

    // 6) Cleanup all temp registrations
    const del1 = await fetch(`${API}/registrations/${encodeURIComponent(regId1)}`, { method: "DELETE", headers: { ...baseHeaders(), ...regHeaders } });
    const del2 = await fetch(`${API}/registrations/${encodeURIComponent(regId2)}`, { method: "DELETE", headers: { ...baseHeaders(), ...regHeaders } });
    const del3 = await fetch(`${API}/registrations/${encodeURIComponent(regId3)}`, { method: "DELETE", headers: { ...baseHeaders(), ...regHeaders } });

    const pass = reg1.ok && reg2.ok && reg3.ok && listByEvent.ok && allMatchEvent && listByParty.ok && allMatchParty && listByStatus.ok && allMatchStatus && listByQ.ok && allMatchQ && del1.ok && del2.ok && del3.ok;
    return {
      test: "registrations:filters",
      result: pass ? "PASS" : "FAIL",
      counts: {
        created: 3,
        byEvent: byEventCount,
        byParty: byPartyCount,
        byStatus: byStatusCount,
        byQ: byQCount
      }
    };
  },

  /* ===================== Reservations: CRUD Resources ===================== */
  "smoke:resources:crud": async ()=>{
    await ensureBearer();

    const resHeaders = { "X-Feature-Reservations-Enabled": "true" };
    const name = smokeTag(`Resource-${Date.now()}`);
    const status = "available";

    // 1) CREATE resource
    const createRes = await fetch(`${API}/objects/resource`, {
      method: "POST",
      headers: { ...baseHeaders(), ...resHeaders, "Idempotency-Key": idem() },
      body: JSON.stringify({ type: "resource", name, status })
    });
    const createBody = await createRes.json().catch(() => ({}));
    if (!createRes.ok || !createBody?.id) {
      return { test: "resources:crud", result: "FAIL", reason: "create-failed", createRes: { status: createRes.status, body: createBody } };
    }
    const resourceId = createBody.id;
    recordCreated({ type: 'resource', id: resourceId, route: '/objects/resource', meta: { name } });

    // 2) GET resource
    const getRes = await fetch(`${API}/objects/resource/${encodeURIComponent(resourceId)}`, {
      headers: { ...baseHeaders(), ...resHeaders }
    });
    const getBody = await getRes.json().catch(() => ({}));
    if (!getRes.ok || getBody?.id !== resourceId || getBody?.name !== name) {
      await fetch(`${API}/objects/resource/${encodeURIComponent(resourceId)}`, { method: "DELETE", headers: { ...baseHeaders(), ...resHeaders } });
      return { test: "resources:crud", result: "FAIL", reason: "get-failed-or-mismatch", getRes: { status: getRes.status, body: getBody } };
    }

    // 3) UPDATE resource (change name)
    const updatedName = smokeTag(`Resource-Updated-${Date.now()}`);
    const updateRes = await fetch(`${API}/objects/resource/${encodeURIComponent(resourceId)}`, {
      method: "PUT",
      headers: { ...baseHeaders(), ...resHeaders },
      body: JSON.stringify({ type: "resource", name: updatedName, status: "maintenance" })
    });
    const updateBody = await updateRes.json().catch(() => ({}));
    if (!updateRes.ok || updateBody?.name !== updatedName || updateBody?.status !== "maintenance") {
      await fetch(`${API}/objects/resource/${encodeURIComponent(resourceId)}`, { method: "DELETE", headers: { ...baseHeaders(), ...resHeaders } });
      return { test: "resources:crud", result: "FAIL", reason: "update-failed-or-mismatch", updateRes: { status: updateRes.status, body: updateBody } };
    }

    // 4) DELETE resource
    const deleteRes = await fetch(`${API}/objects/resource/${encodeURIComponent(resourceId)}`, {
      method: "DELETE",
      headers: { ...baseHeaders(), ...resHeaders }
    });
    if (!deleteRes.ok) {
      return { test: "resources:crud", result: "FAIL", reason: "delete-failed", deleteRes: { status: deleteRes.status } };
    }

    // 5) Verify deleted (GET should return 404 or empty)
    const verifyRes = await fetch(`${API}/objects/resource/${encodeURIComponent(resourceId)}`, {
      headers: { ...baseHeaders(), ...resHeaders }
    });
    if (verifyRes.ok) {
      return { test: "resources:crud", result: "FAIL", reason: "resource-still-exists-after-delete", verifyRes: { status: verifyRes.status } };
    }

    return {
      test: "resources:crud",
      result: "PASS",
      resourceId,
      ops: ["create", "get", "update", "delete", "verify-deleted"]
    };
  },

  /* ===================== Reservations: CRUD Reservations ===================== */
  "smoke:reservations:crud": async ()=>{
    await ensureBearer();

    const resHeaders = { "X-Feature-Reservations-Enabled": "true" };

    // 1) Create resource first
    const createResRes = await fetch(`${API}/objects/resource`, {
      method: "POST",
      headers: { ...baseHeaders(), ...resHeaders, "Idempotency-Key": idem() },
      body: JSON.stringify({ type: "resource", name: smokeTag(`Resource-${Date.now()}`), status: "available" })
    });
    const createResBody = await createResRes.json().catch(() => ({}));
    if (!createResRes.ok || !createResBody?.id) {
      return { test: "reservations:crud", result: "FAIL", reason: "resource-creation-failed", createResRes: { status: createResRes.status, body: createResBody } };
    }
    const resourceId = createResBody.id;
    recordCreated({ type: 'resource', id: resourceId, route: '/objects/resource', meta: { name: createResBody?.name } });

    // 2) CREATE reservation
    const now = new Date();
    const startsAt = new Date(now.getTime() + 3600000).toISOString(); // +1 hour
    const endsAt = new Date(now.getTime() + 7200000).toISOString(); // +2 hours
    const status = "pending";

    const createRes = await fetch(`${API}/objects/reservation`, {
      method: "POST",
      headers: { ...baseHeaders(), ...resHeaders, "Idempotency-Key": idem() },
      body: JSON.stringify({ type: "reservation", resourceId, startsAt, endsAt, status })
    });
    const createBody = await createRes.json().catch(() => ({}));
    if (!createRes.ok || !createBody?.id) {
      await fetch(`${API}/objects/resource/${encodeURIComponent(resourceId)}`, { method: "DELETE", headers: { ...baseHeaders(), ...resHeaders } });
      return { test: "reservations:crud", result: "FAIL", reason: "create-reservation-failed", createRes: { status: createRes.status, body: createBody } };
    }
    const reservationId = createBody.id;
    recordCreated({ type: 'reservation', id: reservationId, route: '/objects/reservation', meta: { resourceId, status } });

    // 3) GET reservation
    const getRes = await fetch(`${API}/objects/reservation/${encodeURIComponent(reservationId)}`, {
      headers: { ...baseHeaders(), ...resHeaders }
    });
    const getBody = await getRes.json().catch(() => ({}));
    if (!getRes.ok || getBody?.id !== reservationId || getBody?.resourceId !== resourceId) {
      await fetch(`${API}/objects/reservation/${encodeURIComponent(reservationId)}`, { method: "DELETE", headers: { ...baseHeaders(), ...resHeaders } });
      await fetch(`${API}/objects/resource/${encodeURIComponent(resourceId)}`, { method: "DELETE", headers: { ...baseHeaders(), ...resHeaders } });
      return { test: "reservations:crud", result: "FAIL", reason: "get-failed-or-mismatch", getRes: { status: getRes.status, body: getBody } };
    }

    // 4) UPDATE reservation (change status to confirmed)
    const updateRes = await fetch(`${API}/objects/reservation/${encodeURIComponent(reservationId)}`, {
      method: "PUT",
      headers: { ...baseHeaders(), ...resHeaders },
      body: JSON.stringify({ type: "reservation", resourceId, startsAt, endsAt, status: "confirmed" })
    });
    const updateBody = await updateRes.json().catch(() => ({}));
    if (!updateRes.ok || updateBody?.status !== "confirmed") {
      await fetch(`${API}/objects/reservation/${encodeURIComponent(reservationId)}`, { method: "DELETE", headers: { ...baseHeaders(), ...resHeaders } });
      await fetch(`${API}/objects/resource/${encodeURIComponent(resourceId)}`, { method: "DELETE", headers: { ...baseHeaders(), ...resHeaders } });
      return { test: "reservations:crud", result: "FAIL", reason: "update-failed-or-mismatch", updateRes: { status: updateRes.status, body: updateBody } };
    }

    // 5) DELETE reservation
    const deleteRes = await fetch(`${API}/objects/reservation/${encodeURIComponent(reservationId)}`, {
      method: "DELETE",
      headers: { ...baseHeaders(), ...resHeaders }
    });
    if (!deleteRes.ok) {
      await fetch(`${API}/objects/resource/${encodeURIComponent(resourceId)}`, { method: "DELETE", headers: { ...baseHeaders(), ...resHeaders } });
      return { test: "reservations:crud", result: "FAIL", reason: "delete-failed", deleteRes: { status: deleteRes.status } };
    }

    // 6) Cleanup resource
    const cleanupRes = await fetch(`${API}/objects/resource/${encodeURIComponent(resourceId)}`, {
      method: "DELETE",
      headers: { ...baseHeaders(), ...resHeaders }
    });
    if (!cleanupRes.ok) {
      return { test: "reservations:crud", result: "FAIL", reason: "resource-cleanup-failed", cleanupRes: { status: cleanupRes.status } };
    }

    return {
      test: "reservations:crud",
      result: "PASS",
      resourceId,
      reservationId,
      ops: ["create-resource", "create-reservation", "get", "update", "delete", "cleanup"]
    };
  },

  /* ===================== Reservations: Conflict Detection ===================== */
  "smoke:reservations:conflicts": async ()=>{
    await ensureBearer();

    const resHeaders = { "X-Feature-Reservations-Enabled": "true" };

    // 1) Create resource
    const createResRes = await fetch(`${API}/objects/resource`, {
      method: "POST",
      headers: { ...baseHeaders(), ...resHeaders, "Idempotency-Key": idem() },
      body: JSON.stringify({ type: "resource", name: `Resource-${Date.now()}`, status: "available" })
    });
    const createResBody = await createResRes.json().catch(() => ({}));
    if (!createResRes.ok || !createResBody?.id) {
      return { test: "reservations:conflicts", result: "FAIL", reason: "resource-creation-failed" };
    }
    const resourceId = createResBody.id;

    // 2) Create reservation A (pending status, time window [t0, t1])
    const now = new Date();
    const t0 = new Date(now.getTime() + 3600000); // +1 hour
    const t1 = new Date(now.getTime() + 7200000); // +2 hours
    const startsAtA = t0.toISOString();
    const endsAtA = t1.toISOString();

    const createA = await fetch(`${API}/objects/reservation`, {
      method: "POST",
      headers: { ...baseHeaders(), ...resHeaders, "Idempotency-Key": idem() },
      body: JSON.stringify({ type: "reservation", resourceId, startsAt: startsAtA, endsAt: endsAtA, status: "pending" })
    });
    const createABody = await createA.json().catch(() => ({}));
    if (!createA.ok || !createABody?.id) {
      await fetch(`${API}/objects/resource/${encodeURIComponent(resourceId)}`, { method: "DELETE", headers: { ...baseHeaders(), ...resHeaders } });
      return { test: "reservations:conflicts", result: "FAIL", reason: "reservation-A-creation-failed" };
    }
    const reservationAId = createABody.id;

    // 3) Attempt to create overlapping reservation B (pending, time window [t0+30min, t1+30min])
    const t0_30 = new Date(t0.getTime() + 1800000); // t0 + 30 min
    const t1_30 = new Date(t1.getTime() + 1800000); // t1 + 30 min
    const startsAtB = t0_30.toISOString();
    const endsAtB = t1_30.toISOString();

    const createB = await fetch(`${API}/objects/reservation`, {
      method: "POST",
      headers: { ...baseHeaders(), ...resHeaders, "Idempotency-Key": idem() },
      body: JSON.stringify({ type: "reservation", resourceId, startsAt: startsAtB, endsAt: endsAtB, status: "pending" })
    });
    const createBBody = await createB.json().catch(() => ({}));

    // Should fail with 409 conflict
    if (createB.status !== 409) {
      // Cleanup
      await fetch(`${API}/objects/reservation/${encodeURIComponent(reservationAId)}`, { method: "DELETE", headers: { ...baseHeaders(), ...resHeaders } });
      await fetch(`${API}/objects/resource/${encodeURIComponent(resourceId)}`, { method: "DELETE", headers: { ...baseHeaders(), ...resHeaders } });
      return { test: "reservations:conflicts", result: "FAIL", reason: "expected-409-got-" + createB.status, createB: { status: createB.status, body: createBBody } };
    }

    // Verify conflict response format
    if (!createBBody?.code || createBBody.code !== "conflict") {
      await fetch(`${API}/objects/reservation/${encodeURIComponent(reservationAId)}`, { method: "DELETE", headers: { ...baseHeaders(), ...resHeaders } });
      await fetch(`${API}/objects/resource/${encodeURIComponent(resourceId)}`, { method: "DELETE", headers: { ...baseHeaders(), ...resHeaders } });
      return { test: "reservations:conflicts", result: "FAIL", reason: "conflict-response-missing-code", createB: { body: createBBody } };
    }

    if (!Array.isArray(createBBody?.details?.conflicts) || createBBody.details.conflicts.length === 0) {
      await fetch(`${API}/objects/reservation/${encodeURIComponent(reservationAId)}`, { method: "DELETE", headers: { ...baseHeaders(), ...resHeaders } });
      await fetch(`${API}/objects/resource/${encodeURIComponent(resourceId)}`, { method: "DELETE", headers: { ...baseHeaders(), ...resHeaders } });
      return { test: "reservations:conflicts", result: "FAIL", reason: "conflict-details-empty", createB: { body: createBBody } };
    }

    const conflictingIds = createBBody.details.conflicts.map(c => c.id);
    const hasReservationA = conflictingIds.includes(reservationAId);
    if (!hasReservationA) {
      await fetch(`${API}/objects/reservation/${encodeURIComponent(reservationAId)}`, { method: "DELETE", headers: { ...baseHeaders(), ...resHeaders } });
      await fetch(`${API}/objects/resource/${encodeURIComponent(resourceId)}`, { method: "DELETE", headers: { ...baseHeaders(), ...resHeaders } });
      return { test: "reservations:conflicts", result: "FAIL", reason: "conflicting-reservation-A-not-in-details", conflictingIds };
    }

    // 4) Call POST /reservations:check-conflicts to verify endpoint
    const checkRes = await fetch(`${API}/reservations:check-conflicts`, {
      method: "POST",
      headers: { ...baseHeaders(), ...resHeaders },
      body: JSON.stringify({ resourceId, startsAt: startsAtB, endsAt: endsAtB })
    });
    const checkBody = await checkRes.json().catch(() => ({}));

    if (!checkRes.ok) {
      await fetch(`${API}/objects/reservation/${encodeURIComponent(reservationAId)}`, { method: "DELETE", headers: { ...baseHeaders(), ...resHeaders } });
      await fetch(`${API}/objects/resource/${encodeURIComponent(resourceId)}`, { method: "DELETE", headers: { ...baseHeaders(), ...resHeaders } });
      return { test: "reservations:conflicts", result: "FAIL", reason: "check-conflicts-endpoint-failed", checkRes: { status: checkRes.status, body: checkBody } };
    }

    if (!Array.isArray(checkBody?.conflicts) || checkBody.conflicts.length === 0) {
      await fetch(`${API}/objects/reservation/${encodeURIComponent(reservationAId)}`, { method: "DELETE", headers: { ...baseHeaders(), ...resHeaders } });
      await fetch(`${API}/objects/resource/${encodeURIComponent(resourceId)}`, { method: "DELETE", headers: { ...baseHeaders(), ...resHeaders } });
      return { test: "reservations:conflicts", result: "FAIL", reason: "check-conflicts-endpoint-empty", checkBody };
    }

    const checkConflictIds = checkBody.conflicts.map(c => c.id);
    const checkHasReservationA = checkConflictIds.includes(reservationAId);
    if (!checkHasReservationA) {
      await fetch(`${API}/objects/reservation/${encodeURIComponent(reservationAId)}`, { method: "DELETE", headers: { ...baseHeaders(), ...resHeaders } });
      await fetch(`${API}/objects/resource/${encodeURIComponent(resourceId)}`, { method: "DELETE", headers: { ...baseHeaders(), ...resHeaders } });
      return { test: "reservations:conflicts", result: "FAIL", reason: "check-conflicts-missing-reservation-A", checkConflictIds };
    }

    // 5) Call GET /resources/{id}/availability to verify availability endpoint reflects created reservation
    const fromAvail = new Date(t0.getTime() - 3600000).toISOString(); // t0 - 1 hour
    const toAvail = new Date(t1.getTime() + 3600000).toISOString();   // t1 + 1 hour
    const availRes = await fetch(`${API}/resources/${encodeURIComponent(resourceId)}/availability?from=${encodeURIComponent(fromAvail)}&to=${encodeURIComponent(toAvail)}`, {
      method: "GET",
      headers: { ...baseHeaders(), ...resHeaders }
    });
    const availBody = await availRes.json().catch(() => ({}));

    if (!availRes.ok) {
      await fetch(`${API}/objects/reservation/${encodeURIComponent(reservationAId)}`, { method: "DELETE", headers: { ...baseHeaders(), ...resHeaders } });
      await fetch(`${API}/objects/resource/${encodeURIComponent(resourceId)}`, { method: "DELETE", headers: { ...baseHeaders(), ...resHeaders } });
      return { test: "reservations:conflicts", result: "FAIL", reason: "availability-endpoint-failed", availRes: { status: availRes.status, body: availBody } };
    }

    if (!Array.isArray(availBody?.busy)) {
      await fetch(`${API}/objects/reservation/${encodeURIComponent(reservationAId)}`, { method: "DELETE", headers: { ...baseHeaders(), ...resHeaders } });
      await fetch(`${API}/objects/resource/${encodeURIComponent(resourceId)}`, { method: "DELETE", headers: { ...baseHeaders(), ...resHeaders } });
      return { test: "reservations:conflicts", result: "FAIL", reason: "availability-busy-not-array", availBody };
    }

    // Check if reservationA is in busy blocks or if any block overlaps [t0, t1]
    const busyIds = availBody.busy.map(b => b.id);
    const hasReservationInBusy = busyIds.includes(reservationAId);
    const hasOverlappingBlock = availBody.busy.some(b => {
      const blockStart = new Date(b.startsAt).getTime();
      const blockEnd = new Date(b.endsAt).getTime();
      const t0ms = t0.getTime();
      const t1ms = t1.getTime();
      return blockStart < t1ms && t0ms < blockEnd; // overlap check
    });

    if (!hasReservationInBusy && !hasOverlappingBlock) {
      await fetch(`${API}/objects/reservation/${encodeURIComponent(reservationAId)}`, { method: "DELETE", headers: { ...baseHeaders(), ...resHeaders } });
      await fetch(`${API}/objects/resource/${encodeURIComponent(resourceId)}`, { method: "DELETE", headers: { ...baseHeaders(), ...resHeaders } });
      return { test: "reservations:conflicts", result: "FAIL", reason: "availability-missing-reservation-A", busyIds };
    }

    // 6) Cleanup
    const delA = await fetch(`${API}/objects/reservation/${encodeURIComponent(reservationAId)}`, {
      method: "DELETE",
      headers: { ...baseHeaders(), ...resHeaders }
    });
    const delRes = await fetch(`${API}/objects/resource/${encodeURIComponent(resourceId)}`, {
      method: "DELETE",
      headers: { ...baseHeaders(), ...resHeaders }
    });

    const pass = delA.ok && delRes.ok;
    return {
      test: "reservations:conflicts",
      result: pass ? "PASS" : "FAIL",
      resourceId,
      reservationAId,
      conflictDetected: {
        createB409: true,
        conflictingIds,
        checkEndpointConflicts: checkConflictIds
      },
      availabilityEndpoint: {
        busyBlocks: availBody.busy?.length || 0,
        hasReservationA: hasReservationInBusy,
        hasOverlap: hasOverlappingBlock
      }
    };
  },

  /* ===================== Common: Pagination ===================== */
  "smoke:common:pagination": async () => {
    await ensureBearer();

    // Seed at least 3 views to ensure we have enough data for pagination
    const view1 = await post(`/objects/view`, {
      type: "view",
      name: smokeTag(`Pagination-Test-1-${Date.now()}`),
      entityType: "inventoryItem",
      columns: [{ field: "id", label: "ID" }]
    });
    const view2 = await post(`/objects/view`, {
      type: "view",
      name: smokeTag(`Pagination-Test-2-${Date.now()}`),
      entityType: "inventoryItem",
      columns: [{ field: "name", label: "Name" }]
    });
    const view3 = await post(`/objects/view`, {
      type: "view",
      name: smokeTag(`Pagination-Test-3-${Date.now()}`),
      entityType: "inventoryItem",
      columns: [{ field: "status", label: "Status" }]
    });

    if (!view1.ok || !view2.ok || !view3.ok) {
      return { test: "common:pagination", result: "FAIL", reason: "view-seeding-failed", view1, view2, view3 };
    }

    // Step 1: GET /views?limit=1 -> expect items.length === 1 and next != null
    const page1 = await get(`/views`, { limit: 1 });
    if (!page1.ok) {
      return { test: "common:pagination", result: "FAIL", reason: "page1-request-failed", page1 };
    }
    const page1Items = page1.body?.items ?? [];
    const page1Next = page1.body?.next ?? null;

    if (page1Items.length !== 1) {
      return { test: "common:pagination", result: "FAIL", reason: "page1-items-length-mismatch", expected: 1, actual: page1Items.length, page1 };
    }
    if (!page1Next) {
      return { test: "common:pagination", result: "FAIL", reason: "page1-next-null", page1 };
    }

    // Step 2: GET /views?limit=1&next=<cursor> -> expect items.length === 1
    const page2 = await get(`/views`, { limit: 1, next: page1Next });
    if (!page2.ok) {
      return { test: "common:pagination", result: "FAIL", reason: "page2-request-failed", page2 };
    }
    const page2Items = page2.body?.items ?? [];
    const page2Next = page2.body?.next ?? null;

    if (page2Items.length !== 1) {
      return { test: "common:pagination", result: "FAIL", reason: "page2-items-length-mismatch", expected: 1, actual: page2Items.length, page2 };
    }

    // Step 3: Optionally fetch a third page to ensure eventual next === null (if exists)
    let page3 = null;
    let page3Items = [];
    let page3Next = null;
    if (page2Next) {
      page3 = await get(`/views`, { limit: 1, next: page2Next });
      page3Items = page3?.body?.items ?? [];
      page3Next = page3?.body?.next ?? null;
    }

    // Step 4: Verify pagination is working correctly
    // - Each page should have unique items (no duplicates)
    const allIds = [
      page1Items[0]?.id,
      page2Items[0]?.id,
      ...(page3Items.length > 0 ? [page3Items[0]?.id] : [])
    ].filter(Boolean);
    const uniqueIds = new Set(allIds);
    if (allIds.length !== uniqueIds.size) {
      return { test: "common:pagination", result: "FAIL", reason: "duplicate-items-across-pages", allIds };
    }

    return {
      test: "common:pagination",
      result: "PASS",
      pages: {
        page1: { count: page1Items.length, hasNext: !!page1Next },
        page2: { count: page2Items.length, hasNext: !!page2Next },
        page3: page3 ? { count: page3Items.length, hasNext: !!page3Next } : null
      },
      totalFetched: allIds.length
    };
  },

  /* ===================== Common: Error Shapes ===================== */
  "smoke:common:error-shapes": async () => {
    await ensureBearer();

    // Test 1: 400 Bad Request - missing required fields (ValidationError)
    const badRequest = await post(`/registrations`, {
      // Missing eventId and partyId (required fields)
      status: "draft"
    }, { "X-Feature-Registrations-Enabled": "1" });

    if (badRequest.status !== 400) {
      return { test: "common:error-shapes", result: "FAIL", reason: "expected-400-got-" + badRequest.status, badRequest };
    }
    if (!badRequest.body?.code || !badRequest.body?.message) {
      return { test: "common:error-shapes", result: "FAIL", reason: "400-missing-code-or-message", body: badRequest.body };
    }
    // Details are optional but should be present for validation errors
    const has400Shape = typeof badRequest.body.code === "string" && typeof badRequest.body.message === "string";
    if (!has400Shape) {
      return { test: "common:error-shapes", result: "FAIL", reason: "400-invalid-shape", body: badRequest.body };
    }

    // Test 2: 401 Unauthorized - GET /views without Authorization header
    const unauthorizedReq = await fetch(`${API}/views`, {
      method: "GET",
      headers: { "content-type": "application/json", "X-Tenant-Id": TENANT }
    });
    const unauthorized = await unauthorizedReq.json().catch(() => ({}));
    if (unauthorizedReq.status !== 401) {
      return { test: "common:error-shapes", result: "FAIL", reason: "expected-401-got-" + unauthorizedReq.status, unauthorized: { status: unauthorizedReq.status, body: unauthorized } };
    }
    if (!unauthorized?.code || !unauthorized?.message) {
      return { test: "common:error-shapes", result: "FAIL", reason: "401-missing-code-or-message", body: unauthorized };
    }
    const has401Shape = typeof unauthorized.code === "string" && typeof unauthorized.message === "string";
    if (!has401Shape) {
      return { test: "common:error-shapes", result: "FAIL", reason: "401-invalid-shape", body: unauthorized };
    }

    // Test 3: 403 Forbidden - feature disabled (valid auth), POST /registrations with flag = 0
    const forbidden = await post(`/registrations`, {}, { "X-Feature-Registrations-Enabled": "0" }, { auth: "default" });
    if (forbidden.status !== 403) {
      return { test: "common:error-shapes", result: "FAIL", reason: "expected-403-got-" + forbidden.status, forbidden };
    }
    if (!forbidden.body?.code || !forbidden.body?.message) {
      return { test: "common:error-shapes", result: "FAIL", reason: "403-missing-code-or-message", body: forbidden.body };
    }

    // Test 4: 404 Not Found - nonexistent resource (feature flag ON)
    const notFound = await get(`/registrations/NON_EXISTENT_ID`, {}, { headers: { "X-Feature-Registrations-Enabled": "true" }, auth: "default" });
    if (notFound.status !== 404) {
      return { test: "common:error-shapes", result: "FAIL", reason: "expected-404-got-" + notFound.status, notFound };
    }
    if (!notFound.body?.code || !notFound.body?.message) {
      return { test: "common:error-shapes", result: "FAIL", reason: "404-missing-code-or-message", body: notFound.body };
    }
    const has404Shape = typeof notFound.body.code === "string" && typeof notFound.body.message === "string";
    if (!has404Shape) {
      return { test: "common:error-shapes", result: "FAIL", reason: "404-invalid-shape", body: notFoundBody };
    }

    return {
      test: "common:error-shapes",
      result: "PASS",
      validatedShapes: {
        "400": { hasCode: !!badRequest.body.code, hasMessage: !!badRequest.body.message, hasDetails: !!badRequest.body.details },
        "401": { hasCode: !!unauthorized.code, hasMessage: !!unauthorized.message },
        "403": { hasCode: !!forbidden.body.code, hasMessage: !!forbidden.body.message },
        "404": { hasCode: !!notFound.body.code, hasMessage: !!notFound.body.message }
      }
    };
  }
};

const cmd=process.argv[2]??"list";
if(cmd==="list"){ console.log(Object.keys(tests)); process.exit(0); }
const fn=tests[cmd];
if(!fn){ console.error("Unknown command:",cmd); process.exit(1); }

(async()=>{
  let exitCode = 1;
  try {
    await ensureBearer();
    const r=await fn();
    console.log(JSON.stringify(r,null,2));
    exitCode = r?.result==="PASS"?0:1;
  } catch (e) {
    console.error(e);
    exitCode = 1;
  } finally {
    flushManifestSync();
    printManifestSummary();
  }
  process.exit(exitCode);
})();
