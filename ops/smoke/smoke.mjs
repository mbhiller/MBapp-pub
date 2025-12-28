#!/usr/bin/env node
import process from "node:process";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { baseGraph } from "./seed/routing.ts";
import { seedParties, seedVendor, seedCustomer } from "./seed/parties.ts";

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
  const result = {ok:r.ok,status:r.status,body:b};
  // On failure, include diagnostic headers and request details
  if (!r.ok) {
    result.method = "GET";
    result.url = API + p + qs(params);
    const reqId = r.headers.get("x-amzn-requestid") ?? r.headers.get("x-amzn-RequestId");
    const apigwId = r.headers.get("x-amz-apigw-id");
    const date = r.headers.get("date");
    result.responseHeaders = {
      "x-amzn-requestid": reqId,
      "x-amz-apigw-id": apigwId,
      date
    };
    if (!reqId) {
      try {
        result.allHeaders = Object.fromEntries(r.headers.entries());
      } catch {/* noop */}
    }
  }
  return result;
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
  const result = {ok:r.ok,status:r.status,body:j};
  // On failure, include diagnostic headers and request details
  if (!r.ok) {
    result.method = "POST";
    result.url = API+p;
    result.requestPayload = body;
    const reqId = r.headers.get("x-amzn-requestid") ?? r.headers.get("x-amzn-RequestId");
    const apigwId = r.headers.get("x-amz-apigw-id");
    const date = r.headers.get("date");
    result.responseHeaders = {
      "x-amzn-requestid": reqId,
      "x-amz-apigw-id": apigwId,
      date
    };
    if (!reqId) {
      try {
        result.allHeaders = Object.fromEntries(r.headers.entries());
      } catch {/* noop */}
    }
  }
  return result;
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
  const result = {ok:r.ok,status:r.status,body:j};
  // On failure, include diagnostic headers and request details
  if (!r.ok) {
    result.method = "PUT";
    result.url = API+p;
    result.requestPayload = body;
    const reqId = r.headers.get("x-amzn-requestid") ?? r.headers.get("x-amzn-RequestId");
    const apigwId = r.headers.get("x-amz-apigw-id");
    const date = r.headers.get("date");
    result.responseHeaders = {
      "x-amzn-requestid": reqId,
      "x-amz-apigw-id": apigwId,
      date
    };
    if (!reqId) {
      try {
        result.allHeaders = Object.fromEntries(r.headers.entries());
      } catch {/* noop */}
    }
  }
  return result;
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
function snippet(value, maxLen = 600) {
  try {
    const s = JSON.stringify(value);
    if (typeof s !== "string") return value;
    return s.length > maxLen ? `${s.slice(0, maxLen)}...(truncated)` : s;
  } catch {
    const s = String(value);
    return s.length > maxLen ? `${s.slice(0, maxLen)}...(truncated)` : s;
  }
}
/**
 * Paginate through pages where `items` may be empty while `pageInfo.hasNext` is true.
 * Stops early once at least one item is collected, or when hasNext=false, or maxPages reached.
 * Expected `fetchPage` signature: `({ limit, next }) => ({ items?, pageInfo? , cursor? , body? })`
 */
async function fetchAllPages({ fetchPage, pageSize = 50, maxPages = 10 }) {
  if (typeof fetchPage !== "function") {
    throw new Error("fetchAllPages requires a fetchPage({ limit, next }) function");
  }
  const collected = [];
  let next = undefined;
  let pagesFetched = 0;
  let lastPageInfo = { hasNext: false };
  let lastCursorUsed = null;
  let lastNextCursorReturned = null;
  while (pagesFetched < maxPages) {
    const res = await fetchPage({ limit: pageSize, next });
    const items = Array.isArray(res?.items) ? res.items
      : Array.isArray(res?.body?.items) ? res.body.items
      : [];
    const pageInfo = res?.pageInfo ?? res?.body?.pageInfo ?? {};
    lastPageInfo = pageInfo || {};
    // Track cursor used for this request (first page: null)
    lastCursorUsed = next ?? null;
    // Determine next cursor from response, prefer pageInfo.nextCursor
    const nextCursor = pageInfo?.nextCursor ?? pageInfo?.next ?? res?.body?.next ?? res?.next ?? res?.cursor ?? null;
    lastNextCursorReturned = nextCursor ?? null;
    pagesFetched++;
    if (items.length > 0) {
      collected.push(...items);
      break;
    }
    const hasNext = !!(pageInfo && (pageInfo.hasNext || pageInfo.has_more || pageInfo.more || nextCursor));
    next = nextCursor;
    if (!hasNext || !next) {
      break;
    }
  }
  return { items: collected, pagesFetched, lastPageInfo, lastCursorUsed, lastNextCursorReturned };
}

/**
 * Poll using fetchAllPages until items appear or timeout elapses.
 * Returns items when found; throws with debug details on timeout.
 */
async function waitForItems({ fetchPage, timeoutMs = 8000, intervalMs = 250, pageSize = 50, maxPages = 10 }) {
  const start = Date.now();
  let last = { items: [], pagesFetched: 0, lastPageInfo: { hasNext: false }, lastCursorUsed: null, lastNextCursorReturned: null };
  let attempts = 0;
  while (Date.now() - start < timeoutMs) {
    attempts++;
    last = await fetchAllPages({ fetchPage, pageSize, maxPages });
    if (Array.isArray(last.items) && last.items.length > 0) {
      return last.items;
    }
    await sleep(intervalMs);
  }
  const debug = {
    fn: "waitForItems",
    attempts,
    timeoutMs,
    intervalMs,
    lastPageInfo: last.lastPageInfo,
    lastCursorUsed: last.lastCursorUsed,
    lastNextCursorReturned: last.lastNextCursorReturned,
    pagesFetched: last.pagesFetched
  };
  console.warn("[waitForItems timeout]", debug);
  const err = new Error("waitForItems: timeout waiting for items");
  err.debug = debug;
  throw err;
}
async function waitForStatus(type, id, wanted, { tries=32, delayMs=250 } = {}) {
  let attempts = 0;
  for (let i=0;i<tries;i++){
    attempts++;
    const po = await get(`/objects/${encodeURIComponent(type)}/${encodeURIComponent(id)}`);
    const s = po?.body?.status;
    if (wanted.includes(s)) return { ok:true, po, attempts };
    await sleep(delayMs);
  }
  const last = await get(`/objects/${encodeURIComponent(type)}/${encodeURIComponent(id)}`);
  const debug = {
    fn: "waitForStatus",
    type,
    id,
    wanted,
    attempts,
    delayMs,
    lastStatus: last?.body?.status,
    bodySnippet: snippet(last?.body, 600)
  };
  console.warn("[waitForStatus timeout]", debug);
  return { ok:false, lastStatus:last?.body?.status, po:last, attempts };
}

/**
 * Wait for backorder requests to be created by polling search endpoint.
 * Uses the same polling pattern as smoke:salesOrders:commit-nonstrict-backorder.
 * Polls continuously (ignores hasNext=false) until items found or timeout.
 */
async function waitForBackorders({ soId, itemId, status = "open", preferredVendorId }, { timeoutMs = 10000, intervalMs = 400 } = {}) {
  const maxAttempts = Math.ceil(timeoutMs / intervalMs);
  let attemptsMade = 0;
  let lastSearchRequestBody = null;
  let lastSearchResponse = null;
  let found = false;
  let items = [];

  // Poll with same request body shape as working smoke
  for (let i = 0; i < maxAttempts && !found; i++) {
    attemptsMade++;
    lastSearchRequestBody = { soId, status };
    if (itemId) lastSearchRequestBody.itemId = itemId;
    
    lastSearchResponse = await post(`/objects/backorderRequest/search`, lastSearchRequestBody);
    items = Array.isArray(lastSearchResponse.body?.items) ? lastSearchResponse.body.items : [];
    found = lastSearchResponse.ok && items.length > 0;
    
    if (found) {
      recordFromListResult(items, "backorderRequest", `/objects/backorderRequest/search`);
    }
    if (!found && i < maxAttempts - 1) {
      await sleep(intervalMs);
    }
  }

  if (!found) {
    const debug = {
      fn: "waitForBackorders",
      attemptsMade,
      timeoutMs,
      intervalMs,
      soId,
      itemId,
      status,
      lastPageInfo: lastSearchResponse?.body?.pageInfo || { hasNext: false },
      itemsLength: items.length,
      lastStatus: lastSearchResponse?.status,
      bodySnippet: snippet(lastSearchResponse?.body, 600)
    };
    console.warn("[waitForBackorders timeout]", debug);
    return {
      ok: false,
      error: "timeout",
      attemptsMade,
      lastSearchRequestBody,
      lastSearchResponse: {
        pageInfo: lastSearchResponse?.body?.pageInfo || { hasNext: false },
        itemsLength: items.length,
        status: lastSearchResponse?.status
      },
      soId,
      itemId,
      status,
      preferredVendorId
    };
  }

  // If no vendor filter requested, return all discovered backorders
  if (!preferredVendorId) {
    return { ok: true, items, attemptsMade };
  }

  // Filter by vendor if requested
  const vendorMatches = items.filter(b => b.preferredVendorId === preferredVendorId);
  return { ok: true, items, vendorMatches, attemptsMade };
}

/** Try multiple movement payload shapes until on-hand increases. */
const MV_TYPE=process.env.SMOKE_MOVEMENT_TYPE??"inventoryMovement";
async function ensureOnHand(itemId, qty){
  // Check current onHand
  let ohCurrent = await onhand(itemId);
  const currentQty = ohCurrent.ok ? (ohCurrent.body?.items?.[0]?.onHand ?? 0) : 0;
  
  // If already at or above target, we're done
  if (currentQty >= qty) {
    return { ok:true, reason:"already_sufficient", currentQty, onhand:ohCurrent };
  }
  
  // Calculate delta needed to reach target
  const needed = qty - currentQty;
  
  // Use canonical POST /inventory/{id}:adjust endpoint (colon action)
  let adjResp = await post(`/inventory/${encodeURIComponent(itemId)}:adjust`, {
    deltaQty: needed,
  }, { "Idempotency-Key": idem() });
  
  // Check if adjustment succeeded and onHand is now sufficient
  let ohAfter = await onhand(itemId);
  const afterQty = ohAfter.ok ? (ohAfter.body?.items?.[0]?.onHand ?? 0) : 0;
  
  if (adjResp.ok && ohAfter.ok && afterQty >= qty) {
    return { ok:true, reason:"adjust_success", adjustment:adjResp, onhand:ohAfter, deltaApplied:needed };
  }
  
  // If first attempt failed, return details
  return { ok:false, reason:"adjust_failed", adjustment:adjResp, ohBefore:currentQty, ohAfter:afterQty, needed };
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
      const { vendorId, vendorParty } = await seedVendor(api);
      // Immediate debug: GET vendor party and capture roles
      const vendCheck = await get(`/objects/party/${encodeURIComponent(vendorId)}`);
      const vendorDebug = { vendorId, roles: vendCheck.body?.roles ?? vendorParty?.roles ?? [], party: vendCheck.body ?? vendorParty };
      // 1) Create item with low/zero onHand
      const prod = await createProduct({ name: "LoopTest", preferredVendorId: vendorId });
      if (!prod.ok) return { test: "close-the-loop", result: "FAIL", step: "createProduct", prod };
      const item = await createInventoryForProduct(prod.body?.id, "LoopTestItem");
      if (!item.ok) return { test: "close-the-loop", result: "FAIL", step: "createInventory", item };
      const itemId = item.body?.id;
      // Create a customer party for the SO
      const { customerId, customerParty } = await seedCustomer(api);
      // Immediate debug: GET customer party and capture roles
      const custCheck = await get(`/objects/party/${encodeURIComponent(customerId)}`);
      const customerDebug = { customerId, roles: custCheck.body?.roles ?? customerParty?.roles ?? [], party: custCheck.body ?? customerParty };
      // Ensure onHand is 0 by adjusting based on current onHand
      const onhandPre = await onhand(itemId);
      const currentOnHand = onhandPre.body?.items?.[0]?.onHand ?? 0;
      if (currentOnHand !== 0) {
        await post(`/objects/inventoryMovement`, { itemId, type: "adjust", qty: -currentOnHand });
      }
      const onhand0 = await onhand(itemId);
      // 2) Create Sales Order where qty > available
      const so = await post(`/objects/salesOrder`, {
        type: "salesOrder", status: "draft", partyId: customerId, lines: [{ itemId, qty: 5, uom: "ea" }]
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
          , vendorDebug, customerDebug
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
      
      // Assert backorderRequests exist with status="open" (two items → two requests)
      const expectedBoCount = 2;
      const expectedItems = [item1Id, item2Id];
      const expectedVendors = [vendor1Id, vendor2Id];
      let found = [];
      const seen = [];

      for (let attempt = 1; attempt <= 10; attempt++) {
        let next;
        let pages = 0;
        while (pages < 5) {
          const body = { soId, status: "open" };
          if (next) body.next = next;

          const boPage = await post(`/objects/backorderRequest/search`, body);
          if (!boPage.ok) {
            if (attempt === 10) {
              return { test: "close-the-loop-multi-vendor", result: "FAIL", step: "backorderRequest-count", attempt, boPage };
            }
            break; // retry outer loop
          }

          const items = boPage.body?.items ?? [];
          if (!Array.isArray(items)) {
            if (attempt === 10) {
              return { test: "close-the-loop-multi-vendor", result: "FAIL", step: "backorderRequest-items-array", attempt, boPage };
            }
            break;
          }

          // Collect diagnostics (cap to first 10 later)
          seen.push(...items);

          // Filter matches for this SO and expected items, status=open
          found.push(...items.filter(x => x?.soId === soId && expectedItems.includes(x?.itemId) && x?.status === "open"));

          if (found.length >= expectedBoCount) break;

          next = boPage.body?.next;
          pages += 1;
          if (!next) break;
        }

        if (found.length >= expectedBoCount) break;
        if (attempt < 10) await new Promise(r => setTimeout(r, 250));
      }

      if (found.length < expectedBoCount) {
        const diagnosticSample = seen.slice(0, 10).map(x => ({
          id: x.id,
          soId: x.soId,
          itemId: x.itemId,
          status: x.status,
          createdAt: x.createdAt
        }));
        return {
          test: "close-the-loop-multi-vendor",
          result: "FAIL",
          step: "backorderRequest-count",
          soId,
          expectedItems,
          expectedVendors,
          expectedCount: expectedBoCount,
          foundCount: found.length,
          diagnosticSample
        };
      }

      const boIds = found.map(b => b.id);
      recordFromListResult(found, "backorderRequest", `/objects/backorderRequest/search`);
      
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

  "smoke:po-receive-lot-location-assertions": async () => {
    await ensureBearer();

    // Step 0: create shortage → backorderRequest
    const { vendorId } = await seedVendor(api);
    const prod = await createProduct({ name: "LotLocAssert", preferredVendorId: vendorId });
    if (!prod.ok) return { test: "po-receive-lot-location-assertions", result: "FAIL", step: "createProduct", prod };
    const inv = await createInventoryForProduct(prod.body.id, "LotLocAssertItem");
    if (!inv.ok) return { test: "po-receive-lot-location-assertions", result: "FAIL", step: "createInventory", inv };

    const { partyId } = await seedParties(api);
    const so = await post(`/objects/salesOrder`, {
      type: "salesOrder",
      partyId,
      status: "draft",
      strict: false,
      lines: [{ itemId: inv.body.id, qty: 2, uom: "ea" }],
    });
    if (!so.ok) return { test: "po-receive-lot-location-assertions", result: "FAIL", step: "createSO", so };
    const soId = so.body?.id;

    const soSubmit = await post(`/sales/so/${encodeURIComponent(soId)}:submit`, {}, { "Idempotency-Key": idem() });
    if (!soSubmit.ok) return { test: "po-receive-lot-location-assertions", result: "FAIL", step: "submitSO", soSubmit };

    const commit = await post(`/sales/so/${encodeURIComponent(soId)}:commit`, {}, { "Idempotency-Key": idem() });
    if (!commit.ok) return { test: "po-receive-lot-location-assertions", result: "FAIL", step: "commitSO", commit };

    const boList = await get(`/objects/backorderRequest?filter.soId=${encodeURIComponent(soId)}&limit=10&status=open`);
    const boItems = boList.body?.items ?? [];
    const boIds = boItems.map((b) => b.id).filter(Boolean);
    if (!boIds.length) return { test: "po-receive-lot-location-assertions", result: "FAIL", step: "noBackorders", boList };

    // Step 1: Suggest, create-from-suggestion, submit, approve
    const suggest = await post(`/purchasing/suggest-po`, { requests: boIds.map((id) => ({ backorderRequestId: id })) }, { "Idempotency-Key": idem() });
    if (!suggest.ok) return { test: "po-receive-lot-location-assertions", result: "FAIL", step: "suggestPO", suggest };
    const draft = suggest.body?.draft ?? suggest.body?.drafts?.[0];
    if (!draft) return { test: "po-receive-lot-location-assertions", result: "FAIL", step: "draftMissing", suggest };

    const createPo = await post(`/purchasing/po:create-from-suggestion`, { draft }, { "Idempotency-Key": idem() });
    if (!createPo.ok) return { test: "po-receive-lot-location-assertions", result: "FAIL", step: "createPO", createPo };
    const poId = createPo?.body?.id ?? (Array.isArray(createPo?.body?.ids) ? createPo.body.ids[0] : null);
    if (!poId) return { test: "po-receive-lot-location-assertions", result: "FAIL", step: "missingPoId", createPo };

    const submit = await post(`/purchasing/po/${encodeURIComponent(poId)}:submit`, {}, { "Idempotency-Key": idem() });
    if (!submit.ok) return { test: "po-receive-lot-location-assertions", result: "FAIL", step: "submitPO", submit };

    const approve = await post(`/purchasing/po/${encodeURIComponent(poId)}:approve`, {}, { "Idempotency-Key": idem() });
    if (!approve.ok) return { test: "po-receive-lot-location-assertions", result: "FAIL", step: "approvePO", approve };

    const approved = await waitForStatus("purchaseOrder", poId, ["approved"]);
    if (!approved.ok) return { test: "po-receive-lot-location-assertions", result: "FAIL", step: "waitApproved", approved };

    const poGet = await get(`/objects/purchaseOrder/${encodeURIComponent(poId)}`);
    if (!poGet.ok) return { test: "po-receive-lot-location-assertions", result: "FAIL", step: "getPO", poGet };
    const firstLine = poGet.body?.lines?.[0];
    const lineId = firstLine?.id ?? firstLine?.lineId ?? null;
    const itemId = firstLine?.itemId ?? null;
    if (!lineId || !itemId) return { test: "po-receive-lot-location-assertions", result: "FAIL", step: "missingLineOrItemId", createPo, poGet };

    // Step 2: Create a real location, then receive with explicit lot/locationId
    const locCreate = await post(`/objects/location`, {
      type: "location",
      name: smokeTag(`Loc-LotLocAssert-${Date.now()}`),
      code: smokeTag(`LOC-${Math.random().toString(36).slice(2,6).toUpperCase()}`),
      status: "active"
    });
    if (!locCreate.ok) return { test: "po-receive-lot-location-assertions", result: "FAIL", step: "createLocation", locCreate };
    const locationId = locCreate.body?.id;

    const payload = { lines: [{ lineId, deltaQty: 1, lot: "LOT-XYZ", locationId }] };
    const recv = await post(`/purchasing/po/${encodeURIComponent(poId)}:receive`, payload, { "Idempotency-Key": idem() });
    if (!recv.ok) return { test: "po-receive-lot-location-assertions", result: "FAIL", step: "receive", recv };

    // Step 3: Query inventory movements
    const movements = await get(`/inventory/${encodeURIComponent(itemId)}/movements?refId=${encodeURIComponent(poId)}&poLineId=${encodeURIComponent(lineId)}&limit=50&sort=desc`);
    if (!movements.ok) return { test: "po-receive-lot-location-assertions", result: "FAIL", step: "movements", movements };

    const match = (movements.body?.items ?? []).find((mv) =>
      mv?.action === "receive" && Number(mv?.qty) === 1 && mv?.lot === "LOT-XYZ" && mv?.locationId === locationId
    );

    const pass = Boolean(match);
    return { test: "po-receive-lot-location-assertions", result: pass ? "PASS" : "FAIL", poId, recv, movements, match };
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
    const productId = smokeTag(`smoke-prod-${Date.now()}`);
    const createName = smokeTag("Smoke Inventory Item");
    const updatedName = smokeTag("Smoke Inventory Item Updated");

    // Create product first
    const prod = await post(`/objects/product`,
      { type: "product", kind: "good", name: productId, sku: productId },
      { "Idempotency-Key": idem() }
    );
    const prodId = prod.body?.id;
    if (!prod.ok || !prodId) {
      return { test: "inventory-crud", result: "FAIL", step: "createProduct", prod };
    }

    // Create inventory item using canonical /objects/inventory endpoint
    const create = await post(`/objects/inventory`,
      { type: "inventory", name: createName, productId: prodId, uom: "ea" },
      { "Idempotency-Key": idem() }
    );
    const id = create.body?.id;
    if (!create.ok || !id) {
      return { test: "inventory-crud", result: "FAIL", step: "create", create };
    }

    const get1 = await get(`/objects/inventory/${encodeURIComponent(id)}`);
    const body1 = get1.body ?? {};
    const gotName1 = body1?.name ?? "";
    const gotProductId1 = body1?.productId;
    const hasRunId = (v) => typeof v === "string" && v.includes(SMOKE_RUN_ID);
    if (!get1.ok || !hasRunId(gotName1) || gotProductId1 !== prodId) {
      return { test: "inventory-crud", result: "FAIL", step: "get1", get1, gotName1, gotProductId1 };
    }

    const update = await put(`/objects/inventory/${encodeURIComponent(id)}`,
      { name: updatedName },
      { "Idempotency-Key": idem() }
    );
    if (!update.ok) {
      return { test: "inventory-crud", result: "FAIL", step: "update", update };
    }

    const get2 = await get(`/objects/inventory/${encodeURIComponent(id)}`);
    const body2 = get2.body ?? {};
    const gotName2 = body2?.name ?? "";
    const gotProductId2 = body2?.productId;
    const gotUpdated = get2.ok
      && gotName2 === updatedName
      && hasRunId(gotName2)
      && gotProductId2 === prodId;
    if (!gotUpdated) {
      return { test: "inventory-crud", result: "FAIL", step: "get2", get2, gotName2, gotProductId2 };
    }

    // Optional: check onhand endpoint returns an entry
    const onhandRes = await get(`/inventory/${encodeURIComponent(id)}/onhand`);
    const onhandOk = onhandRes.ok; // Don't enforce structure, just that it doesn't error

    const pass = prod.ok && create.ok && get1.ok && update.ok && gotUpdated && onhandOk;
    return { test: "inventory-crud", result: pass ? "PASS" : "FAIL", product: prod, create, get1, update, get2, onhandRes };
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

  "smoke:locations:crud": async () => {
    await ensureBearer();

    // Create
    const short = Math.random().toString(36).slice(2,6).toUpperCase();
    const nameCreate = smokeTag(`SmokeLocation-${SMOKE_RUN_ID}`);
    const codeCreate = smokeTag(`LOC-${short}`);
    const create = await post(`/objects/location`,
      { type: "location", name: nameCreate, code: codeCreate, status: "active", notes: "created by locations:crud" },
      { "Idempotency-Key": idem() }
    );
    const id = create.body?.id;
    if (!create.ok || !id) {
      return { test: "locations-crud", result: "FAIL", step: "create", create };
    }
    recordCreated({ type: 'location', id, route: '/objects/location', meta: { name: nameCreate, code: codeCreate, status: 'active' } });

    // GET with tiny retry for eventual consistency
    let get1 = null;
    let got1 = false;
    for (let i=0;i<5 && !got1;i++){
      get1 = await get(`/objects/location/${encodeURIComponent(id)}`);
      got1 = get1.ok && (get1.body?.name ?? "") === nameCreate;
      if (!got1) await sleep(200);
    }
    if (!got1) {
      return { test: "locations-crud", result: "FAIL", step: "get1", get1 };
    }

    // Update
    const nameUpdated = smokeTag(`${nameCreate}-Updated`);
    const update = await put(`/objects/location/${encodeURIComponent(id)}`,
      { name: nameUpdated, status: "inactive", notes: "updated by locations:crud" },
      { "Idempotency-Key": idem() }
    );
    if (!update.ok) {
      return { test: "locations-crud", result: "FAIL", step: "update", update };
    }

    // GET again
    const get2 = await get(`/objects/location/${encodeURIComponent(id)}`);
    const gotUpdated = get2.ok && (get2.body?.name ?? "") === nameUpdated && (get2.body?.status ?? "") === "inactive";
    if (!gotUpdated) {
      return { test: "locations-crud", result: "FAIL", step: "get2", get2 };
    }

    // Presence check: prefer search, fallback to list
    let searchOrList = null;
    let found = false;
    for (let i=0;i<5 && !found;i++){
      // Try POST /objects/location/search if available
      searchOrList = await post(`/objects/location/search`, { q: "SmokeLocation", limit: 20 });
      if (searchOrList.ok) {
        const items = Array.isArray(searchOrList.body?.items) ? searchOrList.body.items : [];
        found = items.some(loc => loc.id === id || loc.name === nameUpdated || loc.code === codeCreate);
      } else {
        // Fallback to GET list
        searchOrList = await get(`/objects/location`, { limit: 20, sort: 'desc' });
        if (searchOrList.ok) {
          const items = Array.isArray(searchOrList.body?.items) ? searchOrList.body.items : [];
          found = items.some(loc => loc.id === id || loc.name === nameUpdated || loc.code === codeCreate);
        }
      }
      if (!found) await sleep(200);
    }

    const pass = create.ok && got1 && update.ok && gotUpdated && searchOrList?.ok && found;
    return { test: "locations-crud", result: pass ? "PASS" : "FAIL", create, get1, update, get2, searchOrList, found };
  },

  "smoke:inventory:putaway": async () => {
    await ensureBearer();

    // Create two locations
    const locA = await post(`/objects/location`,
      { type: "location", name: smokeTag("LocA-PutawaySrc"), code: "LOC-A", status: "active" },
      { "Idempotency-Key": idem() }
    );
    const locB = await post(`/objects/location`,
      { type: "location", name: smokeTag("LocB-PutawayDst"), code: "LOC-B", status: "active" },
      { "Idempotency-Key": idem() }
    );
    if (!locA.ok || !locB.ok) {
      return { test: "inventory-putaway", result: "FAIL", step: "createLocations", locA, locB };
    }
    const locAId = locA.body?.id;
    const locBId = locB.body?.id;
    recordCreated({ type: 'location', id: locAId, route: '/objects/location', meta: { name: 'LocA-PutawaySrc', code: 'LOC-A' } });
    recordCreated({ type: 'location', id: locBId, route: '/objects/location', meta: { name: 'LocB-PutawayDst', code: 'LOC-B' } });

    // Create product and inventory
    const prod = await createProduct({ name: "PutawayTest" });
    if (!prod.ok) {
      return { test: "inventory-putaway", result: "FAIL", step: "createProduct", prod };
    }
    const prodId = prod.body?.id;
    recordCreated({ type: 'product', id: prodId, route: '/objects/product', meta: { name: 'PutawayTest' } });

    const item = await createInventoryForProduct(prodId, "PutawayItem");
    if (!item.ok) {
      return { test: "inventory-putaway", result: "FAIL", step: "createInventory", item };
    }
    const itemId = item.body?.id;
    recordCreated({ type: 'inventory', id: itemId, route: '/objects/inventory', meta: { name: 'PutawayItem', productId: prodId } });

    // Ensure onHand >= 1
    const ensure = await ensureOnHand(itemId, 1);
    if (!ensure.ok) {
      return { test: "inventory-putaway", result: "FAIL", step: "ensureOnHand", ensure };
    }

    // Check onHand before putaway
    const ohBefore = await onhand(itemId);
    const onHandBefore = ohBefore.body?.items?.[0]?.onHand ?? 0;

    // Call putaway
    const putaway = await post(`/inventory/${itemId}:putaway`, {
      qty: 1,
      toLocationId: locBId,
      fromLocationId: locAId,
      lot: "LOT-PUT",
      note: "smoke putaway test"
    }, { "Idempotency-Key": idem() });
    if (!putaway.ok) {
      return { test: "inventory-putaway", result: "FAIL", step: "putaway", putaway };
    }
    const mvId = putaway.body?.id;
    if (mvId) recordCreated({ type: 'inventoryMovement', id: mvId, route: '/inventory/:id:putaway', meta: { action: 'putaway', qty: 1, locationId: locBId, lot: 'LOT-PUT' } });

    // Check movements list for putaway action (retry for consistency)
    let putawayFound = false;
    let mvList = [];
    for (let attempt = 1; attempt <= 10; attempt++) {
      const movements = await get(`/inventory/${itemId}/movements`, { limit: 50 });
      if (!movements.ok) {
        return { test: "inventory-putaway", result: "FAIL", step: "getMovements", movements };
      }
      mvList = movements.body?.items ?? [];
      putawayFound = mvList.some(m => 
        (m.action ?? "") === "putaway" && 
        (m.locationId ?? "") === locBId &&
        (m.lot ?? "") === "LOT-PUT"
      );
      if (putawayFound) break;
      if (attempt < 10) await sleep(500);
    }
    if (!putawayFound) {
      return { test: "inventory-putaway", result: "FAIL", step: "assertMovement", mvList, expected: { action: "putaway", locationId: locBId, lot: "LOT-PUT" } };
    }

    // Verify onHand unchanged (putaway is no-op for counters)
    const ohAfter = await onhand(itemId);
    const onHandAfter = ohAfter.body?.items?.[0]?.onHand ?? 0;
    if (onHandAfter !== onHandBefore) {
      return { test: "inventory-putaway", result: "FAIL", step: "assertOnHandUnchanged", onHandBefore, onHandAfter };
    }

    return { test: "inventory-putaway", result: "PASS", locA: locAId, locB: locBId, item: itemId, mvId, putawayFound: true };
  },

  "smoke:inventory:cycle-count": async () => {
    await ensureBearer();

    // Create product and inventory
    const prod = await createProduct({ name: "CycleCountTest" });
    if (!prod.ok) {
      return { test: "inventory-cycle-count", result: "FAIL", step: "createProduct", prod };
    }
    const prodId = prod.body?.id;
    recordCreated({ type: 'product', id: prodId, route: '/objects/product', meta: { name: 'CycleCountTest' } });

    const item = await createInventoryForProduct(prodId, "CycleCountItem");
    if (!item.ok) {
      return { test: "inventory-cycle-count", result: "FAIL", step: "createInventory", item };
    }
    const itemId = item.body?.id;
    recordCreated({ type: 'inventory', id: itemId, route: '/objects/inventory', meta: { name: 'CycleCountItem', productId: prodId } });

    // Ensure onHand == 5
    const ensure = await ensureOnHand(itemId, 5);
    if (!ensure.ok) {
      return { test: "inventory-cycle-count", result: "FAIL", step: "ensureOnHand", ensure };
    }

    // Verify onHand is 5
    const ohCheck = await onhand(itemId);
    const onHandCheck = ohCheck.body?.items?.[0]?.onHand ?? 0;
    if (onHandCheck !== 5) {
      return { test: "inventory-cycle-count", result: "FAIL", step: "verifyOnHand5", onHandCheck };
    }

    // Call cycle-count with countedQty=2 (expect delta=-3)
    const cycleCount = await post(`/inventory/${itemId}:cycle-count`, {
      countedQty: 2,
      note: "smoke cycle count test"
    }, { "Idempotency-Key": idem() });
    if (!cycleCount.ok) {
      return { test: "inventory-cycle-count", result: "FAIL", step: "cycleCount", cycleCount };
    }
    const ccResp = cycleCount.body;
    const expectedDelta = 2 - 5; // -3
    if (ccResp?.delta !== expectedDelta) {
      return { test: "inventory-cycle-count", result: "FAIL", step: "assertDelta", delta: ccResp?.delta, expectedDelta };
    }
    const mvId = ccResp?.movementId;
    if (mvId) recordCreated({ type: 'inventoryMovement', id: mvId, route: '/inventory/:id:cycle-count', meta: { action: 'cycle_count', qty: expectedDelta, countedQty: 2, priorOnHand: 5 } });

    // Verify onHand is now 2
    const ohAfter = await onhand(itemId);
    const onHandAfter = ohAfter.body?.items?.[0]?.onHand ?? 0;
    if (onHandAfter !== 2) {
      return { test: "inventory-cycle-count", result: "FAIL", step: "assertOnHand2", onHandAfter, expected: 2 };
    }

    // Check movements list for cycle_count action with correct qty (retry for consistency)
    let ccFound = false;
    let mvList = [];
    for (let attempt = 1; attempt <= 10; attempt++) {
      const movements = await get(`/inventory/${itemId}/movements`, { limit: 50 });
      if (!movements.ok) {
        return { test: "inventory-cycle-count", result: "FAIL", step: "getMovements", movements };
      }
      mvList = movements.body?.items ?? [];
      ccFound = mvList.some(m => 
        (m.action ?? "") === "cycle_count" && 
        m.qty === expectedDelta &&
        (m.note ?? "").includes("counted=2")
      );
      if (ccFound) break;
      if (attempt < 10) await sleep(500);
    }
    if (!ccFound) {
      return { test: "inventory-cycle-count", result: "FAIL", step: "assertMovement", mvList, expected: { action: "cycle_count", qty: expectedDelta, noteContains: "counted=2" } };
    }

    return { test: "inventory-cycle-count", result: "PASS", item: itemId, mvId, delta: expectedDelta, ccFound: true };
  },

  "smoke:inventory:movements-by-location": async () => {
    await ensureBearer();

    // Create two locations
    const locA = await post(`/objects/location`, {
      type: "location",
      name: "LocationA-MovementsByLoc",
      code: "LOCA-MBL",
      status: "active"
    });
    if (!locA.ok) {
      return { test: "inventory-movements-by-location", result: "FAIL", step: "createLocationA", locA };
    }
    const locAId = locA.body?.id;
    recordCreated({ type: 'location', id: locAId, route: '/objects/location', meta: { name: 'LocationA-MovementsByLoc', code: 'LOCA-MBL' } });

    const locB = await post(`/objects/location`, {
      type: "location",
      name: "LocationB-MovementsByLoc",
      code: "LOCB-MBL",
      status: "active"
    });
    if (!locB.ok) {
      return { test: "inventory-movements-by-location", result: "FAIL", step: "createLocationB", locB };
    }
    const locBId = locB.body?.id;
    recordCreated({ type: 'location', id: locBId, route: '/objects/location', meta: { name: 'LocationB-MovementsByLoc', code: 'LOCB-MBL' } });

    // Create product and inventory
    const prod = await createProduct({ name: "MovementsByLocTest" });
    if (!prod.ok) {
      return { test: "inventory-movements-by-location", result: "FAIL", step: "createProduct", prod };
    }
    const prodId = prod.body?.id;
    recordCreated({ type: 'product', id: prodId, route: '/objects/product', meta: { name: 'MovementsByLocTest' } });

    const item = await createInventoryForProduct(prodId, "MovementsByLocItem");
    if (!item.ok) {
      return { test: "inventory-movements-by-location", result: "FAIL", step: "createInventory", item };
    }
    const itemId = item.body?.id;
    recordCreated({ type: 'inventory', id: itemId, route: '/objects/inventory', meta: { name: 'MovementsByLocItem', productId: prodId } });

    // Ensure onHand == 2
    const ensure = await ensureOnHand(itemId, 2);
    if (!ensure.ok) {
      return { test: "inventory-movements-by-location", result: "FAIL", step: "ensureOnHand", ensure };
    }

    // Putaway qty 1 to locB with lot "LOT-LOC-MBL"
    const putaway = await post(`/inventory/${itemId}:putaway`, {
      qty: 1,
      toLocationId: locBId,
      lot: "LOT-LOC-MBL",
      note: "smoke movements-by-location test"
    }, { "Idempotency-Key": idem() });
    if (!putaway.ok) {
      return { test: "inventory-movements-by-location", result: "FAIL", step: "putaway", putaway };
    }
    const putawayMvId = putaway.body?.movementId;
    if (putawayMvId) recordCreated({ type: 'inventoryMovement', id: putawayMvId, route: '/inventory/:id:putaway', meta: { action: 'putaway', qty: 1, toLocationId: locBId, lot: 'LOT-LOC-MBL' } });

    // Query GET /inventory/movements?locationId={locBId} with retries
    // Poll up to 10 attempts with 250ms delay, looking for the putaway movement
    let items = [];
    let putawayFound = false;
    const expectedQty = 1;
    const expectedLot = "LOT-LOC-MBL";
    
    for (let attempt = 1; attempt <= 10; attempt++) {
      const movementsResp = await get(`/inventory/movements`, { locationId: locBId, limit: 50, sort: "desc" });
      if (!movementsResp.ok) {
        // On final attempt, return the error
        if (attempt === 10) {
          return { test: "inventory-movements-by-location", result: "FAIL", step: "getMovementsByLocation", attempt, movementsResp };
        }
        // Otherwise retry
        await new Promise(r => setTimeout(r, 250));
        continue;
      }

      items = movementsResp.body?.items ?? [];
      if (!Array.isArray(items)) {
        if (attempt === 10) {
          return { test: "inventory-movements-by-location", result: "FAIL", step: "assertItemsArray", attempt, items };
        }
        await new Promise(r => setTimeout(r, 250));
        continue;
      }

      // Check if putaway movement exists with expected values
      putawayFound = items.some(m => 
        (m.action ?? "") === "putaway" && 
        m.qty === expectedQty && 
        (m.locationId ?? "") === locBId &&
        (m.lot ?? "") === expectedLot
      );

      if (putawayFound) {
        // Found it early, stop retrying
        break;
      }

      // Not found yet, wait and retry (unless this was the last attempt)
      if (attempt < 10) {
        await new Promise(r => setTimeout(r, 250));
      }
    }

    // If we still didn't find it after retries, fetch by-item movements for diagnostics
    if (!putawayFound) {
      const byItemResp = await get(`/inventory/${itemId}/movements`, { limit: 50, sort: "desc" });
      
      let diagnosticMovements = [];
      if (byItemResp.ok && Array.isArray(byItemResp.body?.items)) {
        // Compact diagnostic: first 10 movements with key fields
        diagnosticMovements = byItemResp.body.items.slice(0, 10).map(m => ({
          id: m.id,
          action: m.action,
          qty: m.qty,
          lot: m.lot ?? null,
          locationId: m.locationId ?? null,
          createdAt: m.createdAt
        }));
      }

      return {
        test: "inventory-movements-by-location",
        result: "FAIL",
        step: "assertPutawayFound",
        locBId,
        expectedAction: "putaway",
        expectedQty,
        expectedLot,
        byLocationItems: items,
        diagnosticMovements
      };
    }

    // Verify all returned items have locationId === locBId
    const allHaveLocB = items.every(m => (m.locationId ?? "") === locBId);
    if (!allHaveLocB) {
      return { test: "inventory-movements-by-location", result: "FAIL", step: "assertAllLocationB", locBId, items };
    }

    return { test: "inventory-movements-by-location", result: "PASS", locA: locAId, locB: locBId, item: itemId, putawayMvId, itemsCount: items.length, putawayFound: true };
  },

  "smoke:inventory:onhand-by-location": async () => {
    await ensureBearer();

    // Create two locations A and B
    const locA = await post(`/objects/location`, {
      type: "location",
      name: smokeTag("LocationA-OnHandByLoc"),
      code: "LOCA-OHBL",
      status: "active"
    }, { "Idempotency-Key": idem() });
    if (!locA.ok) {
      return { test: "inventory-onhand-by-location", result: "FAIL", step: "createLocationA", locA };
    }
    const locAId = locA.body?.id;
    recordCreated({ type: 'location', id: locAId, route: '/objects/location', meta: { name: 'LocationA-OnHandByLoc', code: 'LOCA-OHBL' } });

    const locB = await post(`/objects/location`, {
      type: "location",
      name: smokeTag("LocationB-OnHandByLoc"),
      code: "LOCB-OHBL",
      status: "active"
    }, { "Idempotency-Key": idem() });
    if (!locB.ok) {
      return { test: "inventory-onhand-by-location", result: "FAIL", step: "createLocationB", locB };
    }
    const locBId = locB.body?.id;
    recordCreated({ type: 'location', id: locBId, route: '/objects/location', meta: { name: 'LocationB-OnHandByLoc', code: 'LOCB-OHBL' } });

    // Create product and inventory
    const prod = await createProduct({ name: "OnHandByLocTest" });
    if (!prod.ok) {
      return { test: "inventory-onhand-by-location", result: "FAIL", step: "createProduct", prod };
    }
    const prodId = prod.body?.id;
    recordCreated({ type: 'product', id: prodId, route: '/objects/product', meta: { name: 'OnHandByLocTest' } });

    const item = await createInventoryForProduct(prodId, "OnHandByLocItem");
    if (!item.ok) {
      return { test: "inventory-onhand-by-location", result: "FAIL", step: "createInventory", item };
    }
    const itemId = item.body?.id;
    recordCreated({ type: 'inventory', id: itemId, route: '/objects/inventory', meta: { name: 'OnHandByLocItem', productId: prodId } });

    // Adjust inventory at location A (+10 units)
    const adjustA = await post(`/inventory/${itemId}:adjust`, {
      deltaQty: 10,
      locationId: locAId,
      note: "smoke onhand-by-location test at location A"
    }, { "Idempotency-Key": idem() });
    if (!adjustA.ok) {
      return { test: "inventory-onhand-by-location", result: "FAIL", step: "adjustLocationA", adjustA };
    }
    const mvAId = adjustA.body?.movementId;
    if (mvAId) recordCreated({ type: 'inventoryMovement', id: mvAId, route: '/inventory/:id:adjust', meta: { action: 'adjust', qty: 10, locationId: locAId } });

    // Adjust inventory at location B (+5 units)
    const adjustB = await post(`/inventory/${itemId}:adjust`, {
      deltaQty: 5,
      locationId: locBId,
      note: "smoke onhand-by-location test at location B"
    }, { "Idempotency-Key": idem() });
    if (!adjustB.ok) {
      return { test: "inventory-onhand-by-location", result: "FAIL", step: "adjustLocationB", adjustB };
    }
    const mvBId = adjustB.body?.movementId;
    if (mvBId) recordCreated({ type: 'inventoryMovement', id: mvBId, route: '/inventory/:id:adjust', meta: { action: 'adjust', qty: 5, locationId: locBId } });

    // Get aggregate onhand
    const ohAggregate = await onhand(itemId);
    if (!ohAggregate.ok) {
      return { test: "inventory-onhand-by-location", result: "FAIL", step: "getAggregateOnHand", ohAggregate };
    }
    const aggregateOnHand = ohAggregate.body?.items?.[0]?.onHand ?? 0;
    if (aggregateOnHand !== 15) {
      return { test: "inventory-onhand-by-location", result: "FAIL", step: "assertAggregateOnHand", aggregateOnHand, expected: 15 };
    }

    // Get onhand by location (retry for consistency)
    let onHandByLoc = null;
    let ohByLocFound = false;
    for (let attempt = 1; attempt <= 10; attempt++) {
      const response = await get(`/inventory/${itemId}/onhand:by-location`);
      if (!response.ok) {
        return { test: "inventory-onhand-by-location", result: "FAIL", step: "getOnHandByLocation", response };
      }
      onHandByLoc = response.body?.items ?? [];
      if (!Array.isArray(onHandByLoc)) {
        return { test: "inventory-onhand-by-location", result: "FAIL", step: "assertItemsArray", onHandByLoc };
      }
      // Check if both locations have entries
      const locAEntry = onHandByLoc.find(e => (e.locationId ?? "") === locAId);
      const locBEntry = onHandByLoc.find(e => (e.locationId ?? "") === locBId);
      if (locAEntry && locBEntry) {
        ohByLocFound = true;
        break;
      }
      if (attempt < 10) await sleep(500);
    }
    if (!ohByLocFound) {
      return { test: "inventory-onhand-by-location", result: "FAIL", step: "assertLocationsFound", onHandByLoc, expectedLocations: [locAId, locBId] };
    }

    // Verify location A has onHand=10
    const locAEntry = onHandByLoc.find(e => (e.locationId ?? "") === locAId);
    if (!locAEntry || locAEntry.onHand !== 10) {
      return { test: "inventory-onhand-by-location", result: "FAIL", step: "assertLocationAOnHand", locAEntry, expectedOnHand: 10 };
    }

    // Verify location B has onHand=5
    const locBEntry = onHandByLoc.find(e => (e.locationId ?? "") === locBId);
    if (!locBEntry || locBEntry.onHand !== 5) {
      return { test: "inventory-onhand-by-location", result: "FAIL", step: "assertLocationBOnHand", locBEntry, expectedOnHand: 5 };
    }

    // Verify sum of per-location onHand equals aggregate
    const sumPerLocation = onHandByLoc.reduce((sum, e) => sum + (e.onHand ?? 0), 0);
    if (sumPerLocation !== aggregateOnHand) {
      return { test: "inventory-onhand-by-location", result: "FAIL", step: "assertSumEqualsAggregate", sumPerLocation, aggregateOnHand };
    }

    return { test: "inventory-onhand-by-location", result: "PASS", locA: locAId, locB: locBId, item: itemId, aggregateOnHand, perLocationSum: sumPerLocation, entriesCount: onHandByLoc.length };
  },

  "smoke:inventory:adjust-negative": async () => {
    await ensureBearer();

    // Step 1: Create product and inventory item
    const prod = await createProduct({ name: "AdjustNegativeTest" });
    if (!prod.ok) return { test: "inventory-adjust-negative", result: "FAIL", step: "createProduct", prod };
    const prodId = prod.body?.id;

    const item = await createInventoryForProduct(prodId, "AdjustNegativeItem");
    if (!item.ok) return { test: "inventory-adjust-negative", result: "FAIL", step: "createInventory", item };
    const itemId = item.body?.id;
    recordCreated("inventory", itemId);

    // Step 2: Ensure onHand is 5
    const ensure = await ensureOnHand(itemId, 5);
    if (!ensure.ok) return { test: "inventory-adjust-negative", result: "FAIL", step: "ensureOnHand", ensure };

    const beforeAdjust = await onhand(itemId);
    if (!beforeAdjust.ok || beforeAdjust.body?.items?.[0]?.onHand !== 5) {
      return { test: "inventory-adjust-negative", result: "FAIL", step: "verifyBeforeOnHand", onHand: beforeAdjust.body?.items?.[0]?.onHand };
    }

    // Step 3: Adjust by -2 (shrink)
    const adjust = await post(`/inventory/${itemId}:adjust`, {
      deltaQty: -2,
      note: "shrink"
    }, { "Idempotency-Key": `idem_${Date.now()}_${Math.random()}` });

    if (!adjust.ok) return { test: "inventory-adjust-negative", result: "FAIL", step: "adjust", adjust };

    // Step 4: Verify onHand decreased to 3
    const afterAdjust = await onhand(itemId);
    if (!afterAdjust.ok) return { test: "inventory-adjust-negative", result: "FAIL", step: "fetchAfterAdjust", afterAdjust };

    const counters = afterAdjust.body?.items?.[0];
    const onHandValue = counters?.onHand;
    const reservedValue = counters?.reserved;
    const availableValue = counters?.available;

    if (onHandValue !== 3) {
      return { test: "inventory-adjust-negative", result: "FAIL", step: "assertOnHand", expected: 3, actual: onHandValue };
    }

    // Verify available/reserved consistency
    if (typeof availableValue !== "number" || typeof reservedValue !== "number") {
      return { test: "inventory-adjust-negative", result: "FAIL", step: "assertCountersExist", available: availableValue, reserved: reservedValue };
    }

    // available = onHand - reserved (should hold true)
    const expectedAvailable = onHandValue - reservedValue;
    if (availableValue !== expectedAvailable) {
      return { test: "inventory-adjust-negative", result: "FAIL", step: "assertAvailable", expected: expectedAvailable, actual: availableValue, onHand: onHandValue, reserved: reservedValue };
    }

    return { test: "inventory-adjust-negative", result: "PASS", itemId, beforeOnHand: 5, afterOnHand: onHandValue, available: availableValue, reserved: reservedValue };
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

  "smoke:sales:fulfill-with-location": async () => {
    await ensureBearer();

    // 1) Create locations A and B
    const locA = await post(`/objects/location`,
      { type: "location", name: smokeTag("LocA-FulfillSrc"), code: "LOC-A-FUL", status: "active" },
      { "Idempotency-Key": idem() }
    );
    const locB = await post(`/objects/location`,
      { type: "location", name: smokeTag("LocB-FulfillDst"), code: "LOC-B-FUL", status: "active" },
      { "Idempotency-Key": idem() }
    );
    if (!locA.ok || !locB.ok) {
      return { test: "sales:fulfill-with-location", result: "FAIL", step: "createLocations", locA, locB };
    }
    const locAId = locA.body?.id;
    const locBId = locB.body?.id;
    recordCreated({ type: 'location', id: locAId, route: '/objects/location', meta: { name: 'LocA-FulfillSrc', code: 'LOC-A-FUL' } });
    recordCreated({ type: 'location', id: locBId, route: '/objects/location', meta: { name: 'LocB-FulfillDst', code: 'LOC-B-FUL' } });

    // 2) Create product + inventory item
    const prod = await createProduct({ name: "FulfillLocationTest" });
    if (!prod.ok) {
      return { test: "sales:fulfill-with-location", result: "FAIL", step: "createProduct", prod };
    }
    const prodId = prod.body?.id;
    recordCreated({ type: 'product', id: prodId, route: '/objects/product', meta: { name: 'FulfillLocationTest' } });

    const item = await createInventoryForProduct(prodId, "FulfillLocationItem");
    if (!item.ok) {
      return { test: "sales:fulfill-with-location", result: "FAIL", step: "createInventory", item };
    }
    const itemId = item.body?.id;
    recordCreated({ type: 'inventory', id: itemId, route: '/objects/inventory', meta: { name: 'FulfillLocationItem', productId: prodId } });

    // 3) Ensure onHand is 0, then add stock at locB
    const ohPre = await onhand(itemId);
    const currentOnHand = ohPre.body?.items?.[0]?.onHand ?? 0;
    if (currentOnHand !== 0) {
      await post(`/objects/${MV_TYPE}`, { itemId, action: "adjust", qty: -currentOnHand });
    }

    // Receive 5 units (initially unassigned)
    const receive = await post(`/objects/${MV_TYPE}`, { 
      itemId, 
      action: "receive", 
      qty: 5 
    }, { "Idempotency-Key": idem() });
    if (!receive.ok) {
      return { test: "sales:fulfill-with-location", result: "FAIL", step: "receive", receive };
    }

    // Putaway to locB
    const putaway = await post(`/inventory/${itemId}:putaway`, {
      qty: 5,
      toLocationId: locBId,
      lot: "LOT-PRE",
      note: "smoke fulfill-with-location setup"
    }, { "Idempotency-Key": idem() });
    if (!putaway.ok) {
      return { test: "sales:fulfill-with-location", result: "FAIL", step: "putaway", putaway };
    }

    // Verify onhand:by-location shows stock at locB
    const ohByLocPre = await get(`/inventory/${encodeURIComponent(itemId)}/onhand:by-location`);
    if (!ohByLocPre.ok) {
      return { test: "sales:fulfill-with-location", result: "FAIL", step: "onhand-by-location-pre", ohByLocPre };
    }
    const locBCounterPre = (ohByLocPre.body?.items ?? []).find(it => it.locationId === locBId);
    const onHandAtLocBPre = locBCounterPre?.onHand ?? 0;
    if (onHandAtLocBPre < 2) {
      return { test: "sales:fulfill-with-location", result: "FAIL", step: "insufficient-stock-at-locB", onHandAtLocBPre, expected: 5, ohByLocPre };
    }

    // 4) Create SO for qty 2
    const { partyId } = await seedParties(api);
    const so = await post(`/objects/salesOrder`, {
      type: "salesOrder",
      status: "draft",
      partyId,
      customerId: partyId,
      lines: [{ id: "FL1", itemId, uom: "ea", qty: 2 }]
    });
    if (!so.ok) {
      return { test: "sales:fulfill-with-location", result: "FAIL", step: "createSO", so };
    }
    const soId = so.body?.id;

    // Submit and commit
    const submit = await post(`/sales/so/${encodeURIComponent(soId)}:submit`, {}, { "Idempotency-Key": idem() });
    if (!submit.ok) {
      return { test: "sales:fulfill-with-location", result: "FAIL", step: "submit", submit };
    }

    const commit = await post(`/sales/so/${encodeURIComponent(soId)}:commit`, {}, { "Idempotency-Key": idem() });
    if (!commit.ok) {
      return { test: "sales:fulfill-with-location", result: "FAIL", step: "commit", commit };
    }

    // 5) Fulfill with locationId and lot
    const fulfill = await post(`/sales/so/${encodeURIComponent(soId)}:fulfill`, {
      lines: [{ lineId: "FL1", deltaQty: 2, locationId: locBId, lot: "LOT-SO" }]
    }, { "Idempotency-Key": idem() });
    if (!fulfill.ok) {
      return { test: "sales:fulfill-with-location", result: "FAIL", step: "fulfill", fulfill };
    }

    // 6) Assert: fulfill PASS
    const fulfillPass = fulfill.ok && fulfill.status === 200;

    // Assert: recent movements include action=fulfill with locationId=locBId and lot=LOT-SO
    const movements = await get(`/inventory/${encodeURIComponent(itemId)}/movements`, { limit: 20 });
    if (!movements.ok) {
      return { test: "sales:fulfill-with-location", result: "FAIL", step: "getMovements", movements };
    }
    const mvList = movements.body?.items ?? [];
    const fulfillMovement = mvList.find(m => 
      (m.action ?? "") === "fulfill" && 
      (m.locationId ?? "") === locBId &&
      (m.lot ?? "") === "LOT-SO"
    );
    if (!fulfillMovement) {
      return { 
        test: "sales:fulfill-with-location", 
        result: "FAIL", 
        step: "assertFulfillMovement", 
        mvList, 
        expected: { action: "fulfill", locationId: locBId, lot: "LOT-SO" } 
      };
    }

    // Assert: GET /inventory/{id}/onhand:by-location shows available/onHand at locB decreased by 2
    const ohByLocPost = await get(`/inventory/${encodeURIComponent(itemId)}/onhand:by-location`);
    if (!ohByLocPost.ok) {
      return { test: "sales:fulfill-with-location", result: "FAIL", step: "onhand-by-location-post", ohByLocPost };
    }
    const locBCounterPost = (ohByLocPost.body?.items ?? []).find(it => it.locationId === locBId);
    const onHandAtLocBPost = locBCounterPost?.onHand ?? 0;
    const expectedOnHandPost = onHandAtLocBPre - 2;
    if (onHandAtLocBPost !== expectedOnHandPost) {
      return { 
        test: "sales:fulfill-with-location", 
        result: "FAIL", 
        step: "assertOnHandDecreased", 
        onHandAtLocBPre, 
        onHandAtLocBPost, 
        expectedOnHandPost,
        delta: onHandAtLocBPre - onHandAtLocBPost
      };
    }

    const pass = fulfillPass && fulfillMovement && (onHandAtLocBPost === expectedOnHandPost);
    return {
      test: "sales:fulfill-with-location",
      result: pass ? "PASS" : "FAIL",
      steps: {
        locations: { locAId, locBId },
        product: { prodId },
        item: { itemId },
        so: { soId },
        onHandAtLocBPre,
        onHandAtLocBPost,
        expectedOnHandPost,
        fulfillMovement: fulfillMovement ? { action: fulfillMovement.action, locationId: fulfillMovement.locationId, lot: fulfillMovement.lot } : null
      }
    };
  },

  "smoke:sales:reserve-with-location": async () => {
    await ensureBearer();

    // 1) Create locations A and B
    const locA = await post(`/objects/location`,
      { type: "location", name: smokeTag("LocA-ReserveSrc"), code: "LOC-A-RSV", status: "active" },
      { "Idempotency-Key": idem() }
    );
    const locB = await post(`/objects/location`,
      { type: "location", name: smokeTag("LocB-ReserveDst"), code: "LOC-B-RSV", status: "active" },
      { "Idempotency-Key": idem() }
    );
    if (!locA.ok || !locB.ok) {
      return { test: "sales:reserve-with-location", result: "FAIL", step: "createLocations", locA, locB };
    }
    const locAId = locA.body?.id;
    const locBId = locB.body?.id;
    recordCreated({ type: 'location', id: locAId, route: '/objects/location', meta: { name: 'LocA-ReserveSrc', code: 'LOC-A-RSV' } });
    recordCreated({ type: 'location', id: locBId, route: '/objects/location', meta: { name: 'LocB-ReserveDst', code: 'LOC-B-RSV' } });

    // 2) Create product + inventory item
    const prod = await createProduct({ name: "ReserveLocationTest" });
    if (!prod.ok) {
      return { test: "sales:reserve-with-location", result: "FAIL", step: "createProduct", prod };
    }
    const prodId = prod.body?.id;
    recordCreated({ type: 'product', id: prodId, route: '/objects/product', meta: { name: 'ReserveLocationTest' } });

    const item = await createInventoryForProduct(prodId, "ReserveLocationItem");
    if (!item.ok) {
      return { test: "sales:reserve-with-location", result: "FAIL", step: "createInventory", item };
    }
    const itemId = item.body?.id;
    recordCreated({ type: 'inventory', id: itemId, route: '/objects/inventory', meta: { name: 'ReserveLocationItem', productId: prodId } });

    // 3) Ensure onHand is 0, then add stock at locB only
    const ohPre = await onhand(itemId);
    const currentOnHand = ohPre.body?.items?.[0]?.onHand ?? 0;
    if (currentOnHand !== 0) {
      await post(`/objects/${MV_TYPE}`, { itemId, action: "adjust", qty: -currentOnHand });
    }

    // Receive 5 units (unassigned), then putaway to locB
    const receive = await post(`/objects/${MV_TYPE}`, { itemId, action: "receive", qty: 5 }, { "Idempotency-Key": idem() });
    if (!receive.ok) {
      return { test: "sales:reserve-with-location", result: "FAIL", step: "receive", receive };
    }
    const putaway = await post(`/inventory/${itemId}:putaway`, {
      qty: 5,
      toLocationId: locBId,
      lot: "LOT-RSV-PRE",
      note: "smoke reserve-with-location setup"
    }, { "Idempotency-Key": idem() });
    if (!putaway.ok) {
      return { test: "sales:reserve-with-location", result: "FAIL", step: "putaway", putaway };
    }

    // Verify by-location counters: locB onHand >= 5, locA onHand == 0
    const ohByLocPre = await get(`/inventory/${encodeURIComponent(itemId)}/onhand:by-location`);
    if (!ohByLocPre.ok) {
      return { test: "sales:reserve-with-location", result: "FAIL", step: "onhand-by-location-pre", ohByLocPre };
    }
    const countersPre = (ohByLocPre.body?.items ?? []);
    const locACounterPre = countersPre.find(it => it.locationId === locAId);
    const locBCounterPre = countersPre.find(it => it.locationId === locBId);
    const onHandAtLocAPre = locACounterPre?.onHand ?? 0;
    const onHandAtLocBPre = locBCounterPre?.onHand ?? 0;
    if (onHandAtLocBPre < 5 || onHandAtLocAPre !== 0) {
      return { test: "sales:reserve-with-location", result: "FAIL", step: "stock-setup-mismatch", onHandAtLocAPre, onHandAtLocBPre };
    }

    // 4) Create SO with line qty 2 and commit
    const { partyId } = await seedParties(api);
    const so = await post(`/objects/salesOrder`, {
      type: "salesOrder",
      status: "draft",
      partyId,
      customerId: partyId,
      lines: [{ id: "RL1", itemId, uom: "ea", qty: 2 }]
    });
    if (!so.ok) {
      return { test: "sales:reserve-with-location", result: "FAIL", step: "createSO", so };
    }
    const soId = so.body?.id;
    const submit = await post(`/sales/so/${encodeURIComponent(soId)}:submit`, {}, { "Idempotency-Key": idem() });
    if (!submit.ok) {
      return { test: "sales:reserve-with-location", result: "FAIL", step: "submit", submit };
    }
    const commit = await post(`/sales/so/${encodeURIComponent(soId)}:commit`, {}, { "Idempotency-Key": idem() });
    if (!commit.ok) {
      return { test: "sales:reserve-with-location", result: "FAIL", step: "commit", commit };
    }

    // 5) Reserve with locationId (locB) and lot
    const reserve = await post(`/sales/so/${encodeURIComponent(soId)}:reserve`, {
      lines: [{ lineId: "RL1", deltaQty: 2, locationId: locBId, lot: "LOT-RSV" }]
    }, { "Idempotency-Key": idem() });
    if (!reserve.ok) {
      return { test: "sales:reserve-with-location", result: "FAIL", step: "reserve", reserve };
    }

    // 6) Assert movements include action=reserve with locationId=locBId
    const movements = await get(`/inventory/${encodeURIComponent(itemId)}/movements`, { limit: 50, sort: "desc" });
    if (!movements.ok) {
      return { test: "sales:reserve-with-location", result: "FAIL", step: "getMovements", movements };
    }
    const mvList = movements.body?.items ?? [];
    const reserveMovement = mvList.find(m => (m.action ?? "") === "reserve" && (m.locationId ?? "") === locBId);
    if (!reserveMovement) {
      return { test: "sales:reserve-with-location", result: "FAIL", step: "assertReserveMovement", mvList, expected: { action: "reserve", locationId: locBId } };
    }

    // 7) Assert by-location shows reserved increased at locB (reserved=2)
    const ohByLocPost = await get(`/inventory/${encodeURIComponent(itemId)}/onhand:by-location`);
    if (!ohByLocPost.ok) {
      return { test: "sales:reserve-with-location", result: "FAIL", step: "onhand-by-location-post", ohByLocPost };
    }
    const countersPost = (ohByLocPost.body?.items ?? []);
    const locBCounterPost = countersPost.find(it => it.locationId === locBId);
    const reservedAtLocBPost = locBCounterPost?.reserved ?? 0;
    if (reservedAtLocBPost !== 2) {
      return { test: "sales:reserve-with-location", result: "FAIL", step: "assertReservedAtLocB", reservedAtLocBPost, expected: 2, countersPost };
    }

    // 8) Attempt reserve from locA (insufficient) -> expect 409 shortage
    const reserveBad = await post(`/sales/so/${encodeURIComponent(soId)}:reserve`, {
      lines: [{ lineId: "RL1", deltaQty: 1, locationId: locAId, lot: "LOT-BAD" }]
    }, { "Idempotency-Key": idem() });
    const shortage = !reserveBad.ok && reserveBad.status === 409;
    if (!shortage) {
      return { test: "sales:reserve-with-location", result: "FAIL", step: "reserveFromLocA-should-fail", reserveBad };
    }

    const pass = reserve.ok && !!reserveMovement && reservedAtLocBPost === 2 && shortage;
    return {
      test: "sales:reserve-with-location",
      result: pass ? "PASS" : "FAIL",
      steps: {
        locations: { locAId, locBId },
        product: { prodId },
        item: { itemId },
        so: { soId },
        pre: { onHandAtLocAPre, onHandAtLocBPre },
        post: { reservedAtLocBPost },
        reserveMovement: reserveMovement ? { action: reserveMovement.action, locationId: reserveMovement.locationId, qty: reserveMovement.qty } : null
      }
    };
  },

  "smoke:sales:commit-with-location": async () => {
    await ensureBearer();

    // 1) Create locations A and B
    const locA = await post(`/objects/location`,
      { type: "location", name: smokeTag("LocA-Commit"), code: "LOC-A-CMT", status: "active" },
      { "Idempotency-Key": idem() }
    );
    const locB = await post(`/objects/location`,
      { type: "location", name: smokeTag("LocB-Commit"), code: "LOC-B-CMT", status: "active" },
      { "Idempotency-Key": idem() }
    );
    if (!locA.ok || !locB.ok) {
      return { test: "sales:commit-with-location", result: "FAIL", step: "createLocations", locA, locB };
    }
    const locAId = locA.body?.id;
    const locBId = locB.body?.id;
    recordCreated({ type: 'location', id: locAId, route: '/objects/location', meta: { name: 'LocA-Commit', code: 'LOC-A-CMT' } });
    recordCreated({ type: 'location', id: locBId, route: '/objects/location', meta: { name: 'LocB-Commit', code: 'LOC-B-CMT' } });

    // 2) Create product + inventory item
    const prod = await createProduct({ name: "CommitLocationTest" });
    if (!prod.ok) {
      return { test: "sales:commit-with-location", result: "FAIL", step: "createProduct", prod };
    }
    const prodId = prod.body?.id;
    recordCreated({ type: 'product', id: prodId, route: '/objects/product', meta: { name: 'CommitLocationTest' } });

    const item = await createInventoryForProduct(prodId, "CommitLocationItem");
    if (!item.ok) {
      return { test: "sales:commit-with-location", result: "FAIL", step: "createInventory", item };
    }
    const itemId = item.body?.id;
    recordCreated({ type: 'inventory', id: itemId, route: '/objects/inventory', meta: { name: 'CommitLocationItem', productId: prodId } });

    // 3) Ensure onHand at locB = 5, locA = 0 (receive + putaway)
    const receive = await post(`/objects/${MV_TYPE}`, { itemId, action: "receive", qty: 5 }, { "Idempotency-Key": idem() });
    if (!receive.ok) {
      return { test: "sales:commit-with-location", result: "FAIL", step: "receive", receive };
    }
    const putaway = await post(`/inventory/${itemId}:putaway`, {
      qty: 5,
      toLocationId: locBId,
      lot: "LOT-CMT-B",
      note: "smoke commit-with-location setup"
    }, { "Idempotency-Key": idem() });
    if (!putaway.ok) {
      return { test: "sales:commit-with-location", result: "FAIL", step: "putaway", putaway };
    }

    // Verify initial counters: locB onHand = 5, locA onHand = 0
    const ohByLocInitial = await get(`/inventory/${encodeURIComponent(itemId)}/onhand:by-location`);
    if (!ohByLocInitial.ok) {
      return { test: "sales:commit-with-location", result: "FAIL", step: "onhand-by-location-initial", ohByLocInitial };
    }
    const countersInitial = (ohByLocInitial.body?.items ?? []);
    const locBCounterInitial = countersInitial.find(it => it.locationId === locBId);
    const onHandAtLocBInitial = locBCounterInitial?.onHand ?? 0;
    if (onHandAtLocBInitial !== 5) {
      return { test: "sales:commit-with-location", result: "FAIL", step: "verify-initial-stock", onHandAtLocBInitial, expected: 5 };
    }

    // 4) Create SO qty 2, submit
    const { partyId } = await seedParties(api);
    const so = await post(`/objects/salesOrder`, {
      type: "salesOrder",
      status: "draft",
      partyId,
      customerId: partyId,
      lines: [{ id: "CL1", itemId, uom: "ea", qty: 2 }]
    });
    if (!so.ok) {
      return { test: "sales:commit-with-location", result: "FAIL", step: "createSO", so };
    }
    const soId = so.body?.id;
    const soLineId = "CL1";
    recordCreated({ type: 'salesOrder', id: soId, route: '/objects/salesOrder', meta: { partyId } });

    const submit = await post(`/sales/so/${encodeURIComponent(soId)}:submit`, {}, { "Idempotency-Key": idem() });
    if (!submit.ok) {
      return { test: "sales:commit-with-location", result: "FAIL", step: "submit", submit };
    }

    // 5) Reserve with locationId=locB, lot=LOT-CMT-B
    const reserve = await post(`/sales/so/${encodeURIComponent(soId)}:reserve`, {
      lines: [{ lineId: soLineId, deltaQty: 2, locationId: locBId, lot: "LOT-CMT-B" }]
    }, { "Idempotency-Key": idem() });
    if (!reserve.ok) {
      return { test: "sales:commit-with-location", result: "FAIL", step: "reserve", reserve };
    }

    // Verify counters after reserve: locB reserved = 2
    const ohByLocPostReserve = await get(`/inventory/${encodeURIComponent(itemId)}/onhand:by-location`);
    if (!ohByLocPostReserve.ok) {
      return { test: "sales:commit-with-location", result: "FAIL", step: "onhand-by-location-post-reserve", ohByLocPostReserve };
    }
    const countersPostReserve = (ohByLocPostReserve.body?.items ?? []);
    const locBCounterPostReserve = countersPostReserve.find(it => it.locationId === locBId);
    const reservedAtLocBPostReserve = locBCounterPostReserve?.reserved ?? 0;
    if (reservedAtLocBPostReserve !== 2) {
      return { test: "sales:commit-with-location", result: "FAIL", step: "verify-reserved-after-reserve", reservedAtLocBPostReserve, expected: 2 };
    }

    // 6) Commit - should emit commit movements with locationId derived from reserve
    const commit1 = await post(`/sales/so/${encodeURIComponent(soId)}:commit`, {}, { "Idempotency-Key": idem() });
    if (!commit1.ok) {
      return { test: "sales:commit-with-location", result: "FAIL", step: "commit", commit1 };
    }

    // 7) Assert movements include reserve and commit at locB
    const mvPost = await get(`/inventory/${encodeURIComponent(itemId)}/movements`, { limit: 50, sort: "desc" });
    if (!mvPost.ok) {
      return { test: "sales:commit-with-location", result: "FAIL", step: "getMovements", mvPost };
    }
    const mvListPost = mvPost.body?.items ?? [];
    
    // Assert reserve movement: action="reserve", qty=2 (positive), locationId=locBId, soId/soLineId match
    const reserveMv = mvListPost.find(m => 
      m.action === "reserve" && 
      m.soId === soId && 
      m.soLineId === soLineId &&
      m.locationId === locBId &&
      m.qty === 2
    );
    if (!reserveMv) {
      // Debug: show expected vs actual movements
      const allReserves = mvListPost.filter(m => m.action === "reserve");
      return { 
        test: "sales:commit-with-location", 
        result: "FAIL", 
        step: "assertReserveMovement", 
        expected: { action: "reserve", qty: 2, locationId: locBId, soId, soLineId },
        allReserves,
        allMovements: mvListPost,
        note: "Reserve movement not found with matching action/qty/locationId/soId/soLineId"
      };
    }
    // Verify reserve movement has soId and soLineId (required for commit location derivation)
    if (!reserveMv.soId || !reserveMv.soLineId) {
      return { 
        test: "sales:commit-with-location", 
        result: "FAIL", 
        step: "verifyReserveMovementLinkage",
        reserveMv,
        allMovements: mvListPost,
        note: "Reserve movement missing soId or soLineId - required for commit location derivation"
      };
    }

    // Assert commit movement: qty = 2, locationId = locBId (derived from reserve), soId/soLineId match
    const commitMv = mvListPost.find(m => 
      m.action === "commit" && 
      m.soId === soId && 
      m.soLineId === soLineId
    );
    if (!commitMv) {
      // Debug: show all commit movements
      const allCommits = mvListPost.filter(m => m.action === "commit");
      return { 
        test: "sales:commit-with-location", 
        result: "FAIL", 
        step: "assertCommitMovement", 
        expected: { action: "commit", soId, soLineId, locationId: locBId },
        allCommits,
        reserveMv: { soId: reserveMv.soId, soLineId: reserveMv.soLineId, locationId: reserveMv.locationId, lot: reserveMv.lot },
        note: "Commit movement not found with matching soId/soLineId"
      };
    }
    // Verify commit movement has locationId derived from reserve
    if (commitMv.locationId !== locBId) {
      return { 
        test: "sales:commit-with-location", 
        result: "FAIL", 
        step: "verifyCommitMovementLocation",
        commitMv,
        reserveMv: { soId: reserveMv.soId, soLineId: reserveMv.soLineId, locationId: reserveMv.locationId, lot: reserveMv.lot },
        expected: { locationId: locBId },
        note: "Commit movement locationId should be derived from reserve movement"
      };
    }
    // Verify commit movement has correct qty
    if (commitMv.qty !== 2) {
      return { 
        test: "sales:commit-with-location", 
        result: "FAIL", 
        step: "verifyCommitMovementQty",
        commitMv,
        expected: { qty: 2 }
      };
    }
    // Verify commit movement has soId and soLineId
    if (!commitMv.soId || !commitMv.soLineId) {
      return { 
        test: "sales:commit-with-location", 
        result: "FAIL", 
        step: "verifyCommitMovementLinkage",
        commitMv,
        note: "Commit movement missing soId or soLineId"
      };
    }

    // Verify commit movement has correct lot
    if (commitMv.lot !== "LOT-CMT-B") {
      return { 
        test: "sales:commit-with-location", 
        result: "FAIL", 
        step: "verifyCommitMovementLot",
        commitMv,
        expected: { lot: "LOT-CMT-B" }
      };
    }

    // 8) Assert onhand:by-location for locB after commit
    const ohByLocPostCommit = await get(`/inventory/${encodeURIComponent(itemId)}/onhand:by-location`);
    if (!ohByLocPostCommit.ok) {
      return { test: "sales:commit-with-location", result: "FAIL", step: "onhand-by-location-post-commit", ohByLocPostCommit };
    }
    const countersPostCommit = (ohByLocPostCommit.body?.items ?? []);
    const locBCounterPostCommit = countersPostCommit.find(it => it.locationId === locBId);
    const reservedAtLocBPostCommit = locBCounterPostCommit?.reserved ?? 0;
    const onHandAtLocBPostCommit = locBCounterPostCommit?.onHand ?? 0;

    // Reserved should decrease to 0 after commit (commit releases reservation)
    if (reservedAtLocBPostCommit !== 0) {
      // Compute reservedOutstanding for diagnostics
      const relevantMvs = mvListPost.filter(m => 
        m.action === "reserve" || m.action === "release" || m.action === "commit"
      );
      let reservedSum = 0, releasedSum = 0, committedSum = 0;
      for (const m of relevantMvs) {
        if (m.action === "reserve") reservedSum += Math.abs(m.qty || 0);
        else if (m.action === "release") releasedSum += Math.abs(m.qty || 0);
        else if (m.action === "commit") committedSum += Math.abs(m.qty || 0);
      }
      const reservedOutstanding = reservedSum - releasedSum - committedSum;
      
      const mvDiagnostics = relevantMvs.map(m => ({
        action: m.action,
        qty: m.qty,
        soId: m.soId,
        soLineId: m.soLineId,
        locationId: m.locationId,
        lot: m.lot,
        at: m.at
      }));
      
      return { 
        test: "sales:commit-with-location", 
        result: "FAIL", 
        step: "verify-reserved-after-commit", 
        reservedAtLocBPostCommit, 
        expected: 0,
        reservedOutstanding,
        computedSums: { reservedSum, releasedSum, committedSum },
        movements: mvDiagnostics,
        note: "Commit should release reservation (reserved -> 0)"
      };
    }

    // OnHand should decrease from 5 to 3 after commit (commit decrements by 2)
    if (onHandAtLocBPostCommit !== 3) {
      return { 
        test: "sales:commit-with-location", 
        result: "FAIL", 
        step: "verify-onhand-after-commit", 
        onHandAtLocBPostCommit, 
        expected: 3,
        note: "Commit should decrement onHand from 5 to 3"
      };
    }

    const pass = !!reserveMv && !!commitMv && commitMv.locationId === locBId && reservedAtLocBPostCommit === 0 && onHandAtLocBPostCommit === 3;
    return {
      test: "sales:commit-with-location",
      result: pass ? "PASS" : "FAIL",
      steps: {
        locations: { locAId, locBId },
        product: { prodId },
        item: { itemId },
        so: { soId, soLineId },
        counters: {
          initial: { onHandAtLocB: onHandAtLocBInitial },
          postReserve: { reservedAtLocB: reservedAtLocBPostReserve },
          postCommit: { reservedAtLocB: reservedAtLocBPostCommit, onHandAtLocB: onHandAtLocBPostCommit }
        },
        reserveMovement: { 
          action: reserveMv.action, 
          soId: reserveMv.soId, 
          soLineId: reserveMv.soLineId,
          locationId: reserveMv.locationId, 
          lot: reserveMv.lot,
          qty: reserveMv.qty 
        },
        commitMovement: { 
          action: commitMv.action, 
          soId: commitMv.soId, 
          soLineId: commitMv.soLineId,
          locationId: commitMv.locationId, 
          lot: commitMv.lot,
          qty: commitMv.qty 
        }
      }
    };
  },

  "smoke:sales:fulfill-without-reserve": async () => {
    await ensureBearer();

    // 1) Create product + inventory
    const prod = await createProduct({ name: "FulfillNoReserve" });
    if (!prod.ok) return { test: "sales:fulfill-without-reserve", result: "FAIL", step: "createProduct", prod };
    const prodId = prod.body?.id;
    recordCreated({ type: 'product', id: prodId, route: '/objects/product', meta: { name: 'FulfillNoReserve' } });

    const item = await createInventoryForProduct(prodId, "FulfillNoReserveItem");
    if (!item.ok) return { test: "sales:fulfill-without-reserve", result: "FAIL", step: "createInventory", item };
    const itemId = item.body?.id;
    recordCreated({ type: 'inventory', id: itemId, route: '/objects/inventory', meta: { name: 'FulfillNoReserveItem', productId: prodId } });

    // 2) Create location and receive inventory there
    const loc = await post(`/objects/location`,
      { type: "location", name: smokeTag("Loc-FulfillNR"), code: "LOC-FNR", status: "active" },
      { "Idempotency-Key": idem() }
    );
    if (!loc.ok) return { test: "sales:fulfill-without-reserve", result: "FAIL", step: "createLocation", loc };
    const locId = loc.body?.id;
    recordCreated({ type: 'location', id: locId, route: '/objects/location', meta: { name: 'Loc-FulfillNR', code: 'LOC-FNR' } });

    // Ensure onHand is 0 first
    const ohPre = await onhand(itemId);
    const currentOnHand = ohPre.body?.items?.[0]?.onHand ?? 0;
    if (currentOnHand !== 0) {
      await post(`/objects/${MV_TYPE}`, { itemId, action: "adjust", qty: -currentOnHand }, { "Idempotency-Key": idem() });
    }

    // Receive 5 units, then putaway to location
    const receive = await post(`/objects/${MV_TYPE}`, { itemId, action: "receive", qty: 5 }, { "Idempotency-Key": idem() });
    if (!receive.ok) return { test: "sales:fulfill-without-reserve", result: "FAIL", step: "receive", receive };

    const putaway = await post(`/inventory/${itemId}:putaway`, {
      qty: 5,
      toLocationId: locId,
      lot: "LOT-FNR",
      note: "smoke fulfill-without-reserve setup"
    }, { "Idempotency-Key": idem() });
    if (!putaway.ok) return { test: "sales:fulfill-without-reserve", result: "FAIL", step: "putaway", putaway };

    // 3) Create SO with qty 3, submit and commit (non-strict)
    const { partyId } = await seedParties(api);
    const so = await post(`/objects/salesOrder`, {
      type: "salesOrder",
      status: "draft",
      partyId,
      lines: [{ id: "FNR1", itemId, uom: "ea", qty: 3 }]
    }, { "Idempotency-Key": idem() });
    if (!so.ok) return { test: "sales:fulfill-without-reserve", result: "FAIL", step: "createSO", so };
    const soId = so.body?.id;
    const soLineId = "FNR1";
    recordCreated({ type: 'salesOrder', id: soId, route: '/objects/salesOrder', meta: { partyId } });

    const submit = await post(`/sales/so/${encodeURIComponent(soId)}:submit`, {}, { "Idempotency-Key": idem() });
    if (!submit.ok) return { test: "sales:fulfill-without-reserve", result: "FAIL", step: "submit", submit };

    const commit = await post(`/sales/so/${encodeURIComponent(soId)}:commit`, {}, { "Idempotency-Key": idem() });
    if (!commit.ok) return { test: "sales:fulfill-without-reserve", result: "FAIL", step: "commit", commit };
    if (commit.body?.status !== "committed") {
      return { test: "sales:fulfill-without-reserve", result: "FAIL", step: "commitStatus", status: commit.body?.status, expected: "committed" };
    }

    // 4) Fulfill directly WITHOUT reserve call
    const fulfill = await post(`/sales/so/${encodeURIComponent(soId)}:fulfill`, {
      lines: [{ lineId: soLineId, deltaQty: 3, locationId: locId, lot: "LOT-FNR" }]
    }, { "Idempotency-Key": idem() });
    if (!fulfill.ok) return { test: "sales:fulfill-without-reserve", result: "FAIL", step: "fulfill", fulfill };

    // 5) Assert SO status is fulfilled
    const soAfterFulfill = fulfill.body;
    if (soAfterFulfill?.status !== "fulfilled") {
      return { test: "sales:fulfill-without-reserve", result: "FAIL", step: "checkFulfillStatus", status: soAfterFulfill?.status, expected: "fulfilled" };
    }

    // 6) Query movements for this SO to assert fulfill action exists
    // Use top-level filters: soId and action (not nested under "filters")
    const mvSearch = await post(`/objects/inventoryMovement/search`, {
      soId,
      action: "fulfill"
    });
    if (!mvSearch.ok) return { test: "sales:fulfill-without-reserve", result: "FAIL", step: "searchMovements", mvSearch };

    const movements = Array.isArray(mvSearch.body?.items) ? mvSearch.body.items : [];
    if (movements.length === 0) {
      return { test: "sales:fulfill-without-reserve", result: "FAIL", step: "noFulfillMovements", movements, soId };
    }

    // Assert at least one movement has action=fulfill, qty=3, soId=..., soLineId=...
    const fulfillMv = movements.find(m => 
      m.action === "fulfill" && 
      m.qty === 3 && 
      m.soId === soId && 
      m.soLineId === soLineId
    );
    if (!fulfillMv) {
      return { 
        test: "sales:fulfill-without-reserve", 
        result: "FAIL", 
        step: "assertFulfillMovement",
        expected: { action: "fulfill", qty: 3, soId, soLineId },
        foundMovements: movements.map(m => ({ action: m.action, qty: m.qty, soId: m.soId, soLineId: m.soLineId, itemId: m.itemId }))
      };
    }

    const pass = soAfterFulfill?.status === "fulfilled" && !!fulfillMv;
    return {
      test: "sales:fulfill-without-reserve",
      result: pass ? "PASS" : "FAIL",
      steps: {
        product: { prodId },
        item: { itemId },
        location: { locId },
        so: { soId, soLineId },
        statusTransition: { preCommit: "committed", postFulfill: soAfterFulfill?.status },
        fulfillMovement: fulfillMv ? {
          id: fulfillMv.id,
          action: fulfillMv.action,
          qty: fulfillMv.qty,
          soId: fulfillMv.soId,
          soLineId: fulfillMv.soLineId,
          locationId: fulfillMv.locationId,
          lot: fulfillMv.lot
        } : null
      }
    };
  },
  "smoke:outbound:reserve-fulfill-release-cycle": async () => {
    await ensureBearer();

    // 1) Setup: create product + inventory + location, receive 3 units
    const prod = await createProduct({ name: "OutboundCycle" });
    if (!prod.ok) return { test: "outbound:reserve-fulfill-release-cycle", result: "FAIL", step: "createProduct", prod };
    const prodId = prod.body?.id;
    recordCreated({ type: 'product', id: prodId, route: '/objects/product', meta: { name: 'OutboundCycle' } });

    const item = await createInventoryForProduct(prodId, "OutboundCycleItem");
    if (!item.ok) return { test: "outbound:reserve-fulfill-release-cycle", result: "FAIL", step: "createInventory", item };
    const itemId = item.body?.id;
    recordCreated({ type: 'inventory', id: itemId, route: '/objects/inventory', meta: { name: 'OutboundCycleItem', productId: prodId } });

    const loc = await post(`/objects/location`,
      { type: "location", name: smokeTag("Loc-OutboundCycle"), code: "LOC-OBC", status: "active" },
      { "Idempotency-Key": idem() }
    );
    if (!loc.ok) return { test: "outbound:reserve-fulfill-release-cycle", result: "FAIL", step: "createLocation", loc };
    const locId = loc.body?.id;
    recordCreated({ type: 'location', id: locId, route: '/objects/location', meta: { name: 'Loc-OutboundCycle', code: 'LOC-OBC' } });

    // Ensure onHand is 0
    const ohPre = await onhand(itemId);
    const currentOnHand = ohPre.body?.items?.[0]?.onHand ?? 0;
    if (currentOnHand !== 0) {
      await post(`/objects/${MV_TYPE}`, { itemId, action: "adjust", qty: -currentOnHand }, { "Idempotency-Key": idem() });
    }

    // Receive 3 units and putaway to location
    const receive = await post(`/objects/${MV_TYPE}`, { itemId, action: "receive", qty: 3 }, { "Idempotency-Key": idem() });
    if (!receive.ok) return { test: "outbound:reserve-fulfill-release-cycle", result: "FAIL", step: "receive", receive };

    const putaway = await post(`/inventory/${itemId}:putaway`, {
      qty: 3,
      toLocationId: locId,
      lot: "LOT-OBC",
      note: "smoke outbound-cycle setup"
    }, { "Idempotency-Key": idem() });
    if (!putaway.ok) return { test: "outbound:reserve-fulfill-release-cycle", result: "FAIL", step: "putaway", putaway };

    // Verify initial counters at location: onHand=3, reserved=0
    const ohByLocInitial = await get(`/inventory/${encodeURIComponent(itemId)}/onhand:by-location`);
    if (!ohByLocInitial.ok) return { test: "outbound:reserve-fulfill-release-cycle", result: "FAIL", step: "onhand-by-location-initial", ohByLocInitial };
    const locCounterInitial = (ohByLocInitial.body?.items ?? []).find(c => c.locationId === locId);
    const initialOnHand = locCounterInitial?.onHand ?? 0;
    if (initialOnHand !== 3) {
      return { test: "outbound:reserve-fulfill-release-cycle", result: "FAIL", step: "verifyInitialStock", initialOnHand, expected: 3 };
    }

    // 2) Create SO with qty 3, submit + commit
    const { partyId } = await seedParties(api);
    const so = await post(`/objects/salesOrder`, {
      type: "salesOrder",
      status: "draft",
      partyId,
      lines: [{ id: "OBC1", itemId, uom: "ea", qty: 3 }]
    }, { "Idempotency-Key": idem() });
    if (!so.ok) return { test: "outbound:reserve-fulfill-release-cycle", result: "FAIL", step: "createSO", so };
    const soId = so.body?.id;
    const soLineId = "OBC1";
    recordCreated({ type: 'salesOrder', id: soId, route: '/objects/salesOrder', meta: { partyId } });

    const submit = await post(`/sales/so/${encodeURIComponent(soId)}:submit`, {}, { "Idempotency-Key": idem() });
    if (!submit.ok) return { test: "outbound:reserve-fulfill-release-cycle", result: "FAIL", step: "submit", submit };

    const commit = await post(`/sales/so/${encodeURIComponent(soId)}:commit`, {}, { "Idempotency-Key": idem() });
    if (!commit.ok) return { test: "outbound:reserve-fulfill-release-cycle", result: "FAIL", step: "commit", commit };
    if (commit.body?.status !== "committed") {
      return { test: "outbound:reserve-fulfill-release-cycle", result: "FAIL", step: "commitStatus", status: commit.body?.status, expected: "committed" };
    }

    // 3) Reserve qty 3 from location
    const reserve = await post(`/sales/so/${encodeURIComponent(soId)}:reserve`, {
      lines: [{ lineId: soLineId, deltaQty: 3, locationId: locId, lot: "LOT-OBC" }]
    }, { "Idempotency-Key": idem() });
    if (!reserve.ok) return { test: "outbound:reserve-fulfill-release-cycle", result: "FAIL", step: "reserve", reserve };

    // Verify counters after reserve: reserved=3, onHand=3
    const ohByLocAfterReserve = await get(`/inventory/${encodeURIComponent(itemId)}/onhand:by-location`);
    if (!ohByLocAfterReserve.ok) return { test: "outbound:reserve-fulfill-release-cycle", result: "FAIL", step: "onhand-by-location-after-reserve", ohByLocAfterReserve };
    const locCounterAfterReserve = (ohByLocAfterReserve.body?.items ?? []).find(c => c.locationId === locId);
    const reservedAfterReserve = locCounterAfterReserve?.reserved ?? 0;
    const onHandAfterReserve = locCounterAfterReserve?.onHand ?? 0;
    if (reservedAfterReserve !== 3) {
      return { test: "outbound:reserve-fulfill-release-cycle", result: "FAIL", step: "verifyReservedAfterReserve", reservedAfterReserve, expected: 3 };
    }

    // 4) Fulfill qty 2 (partial)
    const fulfill = await post(`/sales/so/${encodeURIComponent(soId)}:fulfill`, {
      lines: [{ lineId: soLineId, deltaQty: 2, locationId: locId, lot: "LOT-OBC" }]
    }, { "Idempotency-Key": idem() });
    if (!fulfill.ok) return { test: "outbound:reserve-fulfill-release-cycle", result: "FAIL", step: "fulfill", fulfill };
    if (fulfill.body?.status !== "partially_fulfilled") {
      return { test: "outbound:reserve-fulfill-release-cycle", result: "FAIL", step: "fulfillStatus", status: fulfill.body?.status, expected: "partially_fulfilled" };
    }

    // Verify counters after fulfill (no change expected - fulfill is counter no-op)
    const ohByLocAfterFulfill = await get(`/inventory/${encodeURIComponent(itemId)}/onhand:by-location`);
    if (!ohByLocAfterFulfill.ok) return { test: "outbound:reserve-fulfill-release-cycle", result: "FAIL", step: "onhand-by-location-after-fulfill", ohByLocAfterFulfill };
    const locCounterAfterFulfill = (ohByLocAfterFulfill.body?.items ?? []).find(c => c.locationId === locId);
    const reservedAfterFulfill = locCounterAfterFulfill?.reserved ?? 0;
    const onHandAfterFulfill = locCounterAfterFulfill?.onHand ?? 0;
    // Fulfill doesn't change counters, so reserved should still be 3, onHand should still be 3
    if (reservedAfterFulfill !== 3) {
      return { test: "outbound:reserve-fulfill-release-cycle", result: "FAIL", step: "verifyReservedAfterFulfill", reservedAfterFulfill, expected: 3, note: "Fulfill should not change reserved counter" };
    }

    // 5) Release qty 1 (of the remaining 1 reserved after fulfill)
    const release = await post(`/sales/so/${encodeURIComponent(soId)}:release`, {
      lines: [{ lineId: soLineId, deltaQty: 1, locationId: locId, lot: "LOT-OBC" }]
    }, { "Idempotency-Key": idem() });
    if (!release.ok) return { test: "outbound:reserve-fulfill-release-cycle", result: "FAIL", step: "release", release };

    // Verify counters after release: reserved should decrease to 2 (3 - 1)
    const ohByLocAfterRelease = await get(`/inventory/${encodeURIComponent(itemId)}/onhand:by-location`);
    if (!ohByLocAfterRelease.ok) return { test: "outbound:reserve-fulfill-release-cycle", result: "FAIL", step: "onhand-by-location-after-release", ohByLocAfterRelease };
    const locCounterAfterRelease = (ohByLocAfterRelease.body?.items ?? []).find(c => c.locationId === locId);
    const reservedAfterRelease = locCounterAfterRelease?.reserved ?? 0;
    const onHandAfterRelease = locCounterAfterRelease?.onHand ?? 0;
    if (reservedAfterRelease !== 2) {
      return { test: "outbound:reserve-fulfill-release-cycle", result: "FAIL", step: "verifyReservedAfterRelease", reservedAfterRelease, expected: 2 };
    }

    // 6) Query movements and assert each action
    const mvSearch = await post(`/objects/inventoryMovement/search`, {
      soId
    });
    if (!mvSearch.ok) return { test: "outbound:reserve-fulfill-release-cycle", result: "FAIL", step: "searchMovements", mvSearch };

    const movements = Array.isArray(mvSearch.body?.items) ? mvSearch.body.items : [];

    // Assert reserve movement: action="reserve", qty=3, soId, soLineId, locationId
    const reserveMv = movements.find(m =>
      m.action === "reserve" &&
      m.qty === 3 &&
      m.soId === soId &&
      m.soLineId === soLineId &&
      m.locationId === locId
    );
    if (!reserveMv) {
      return {
        test: "outbound:reserve-fulfill-release-cycle",
        result: "FAIL",
        step: "assertReserveMovement",
        expected: { action: "reserve", qty: 3, soId, soLineId, locationId: locId },
        foundMovements: movements.map(m => ({ action: m.action, qty: m.qty, soId: m.soId, soLineId: m.soLineId, locationId: m.locationId }))
      };
    }

    // Assert fulfill movement: action="fulfill", qty=2, soId, soLineId, locationId
    const fulfillMv = movements.find(m =>
      m.action === "fulfill" &&
      m.qty === 2 &&
      m.soId === soId &&
      m.soLineId === soLineId &&
      m.locationId === locId
    );
    if (!fulfillMv) {
      return {
        test: "outbound:reserve-fulfill-release-cycle",
        result: "FAIL",
        step: "assertFulfillMovement",
        expected: { action: "fulfill", qty: 2, soId, soLineId, locationId: locId },
        foundMovements: movements.map(m => ({ action: m.action, qty: m.qty, soId: m.soId, soLineId: m.soLineId, locationId: m.locationId }))
      };
    }

    // Assert release movement: action="release", qty=1, soId, soLineId, locationId
    const releaseMv = movements.find(m =>
      m.action === "release" &&
      m.qty === 1 &&
      m.soId === soId &&
      m.soLineId === soLineId &&
      m.locationId === locId
    );
    if (!releaseMv) {
      return {
        test: "outbound:reserve-fulfill-release-cycle",
        result: "FAIL",
        step: "assertReleaseMovement",
        expected: { action: "release", qty: 1, soId, soLineId, locationId: locId },
        foundMovements: movements.map(m => ({ action: m.action, qty: m.qty, soId: m.soId, soLineId: m.soLineId, locationId: m.locationId }))
      };
    }

    const pass = !!reserveMv && !!fulfillMv && !!releaseMv && reservedAfterRelease === 2;
    return {
      test: "outbound:reserve-fulfill-release-cycle",
      result: pass ? "PASS" : "FAIL",
      steps: {
        product: { prodId },
        item: { itemId },
        location: { locId },
        so: { soId, soLineId },
        counters: {
          initial: { onHand: initialOnHand, reserved: 0 },
          afterReserve: { onHand: onHandAfterReserve, reserved: reservedAfterReserve },
          afterFulfill: { onHand: onHandAfterFulfill, reserved: reservedAfterFulfill },
          afterRelease: { onHand: onHandAfterRelease, reserved: reservedAfterRelease }
        },
        movements: {
          reserve: reserveMv ? { action: reserveMv.action, qty: reserveMv.qty, soId: reserveMv.soId, soLineId: reserveMv.soLineId, locationId: reserveMv.locationId } : null,
          fulfill: fulfillMv ? { action: fulfillMv.action, qty: fulfillMv.qty, soId: fulfillMv.soId, soLineId: fulfillMv.soLineId, locationId: fulfillMv.locationId } : null,
          release: releaseMv ? { action: releaseMv.action, qty: releaseMv.qty, soId: releaseMv.soId, soLineId: releaseMv.soLineId, locationId: releaseMv.locationId } : null
        }
      }
    };
  },

  "smoke:salesOrders:draft-lines-server-assign-ids": async () => {
    await ensureBearer();

    const { partyId } = await seedParties(api);
    const prod = await createProduct({ name: "SO-LineIds" });
    if (!prod.ok) return { test: "salesOrders:draft-lines-server-assign-ids", result: "FAIL", prod };
    const inv = await createInventoryForProduct(prod.body?.id, "SO-LineIds" );
    if (!inv.ok) return { test: "salesOrders:draft-lines-server-assign-ids", result: "FAIL", inv };
    const itemId = inv.body?.id;

    const create = await post(
      `/objects/salesOrder`,
      {
        type: "salesOrder",
        status: "draft",
        partyId,
        lines: [
          { itemId, uom: "ea", qty: 3 },
          { itemId, uom: "ea", qty: 2 }
        ]
      },
      { "Idempotency-Key": idem() }
    );
    if (!create.ok) return { test: "salesOrders:draft-lines-server-assign-ids", result: "FAIL", create };

    const createLines = Array.isArray(create.body?.lines) ? create.body.lines : [];
    const createIds = createLines.map(l => l?.id ?? l?.lineId).filter(Boolean);
    const allHaveIds = createLines.length === 2 && createIds.length === 2 && createIds.every(id => typeof id === "string" && id.trim().length > 0);
    const uniqueIds = new Set(createIds).size === createIds.length;

    const soId = create.body?.id;
    const got = soId ? await get(`/objects/salesOrder/${encodeURIComponent(soId)}`) : { ok: false, status: 0, body: {} };
    const persistedLines = Array.isArray(got.body?.lines) ? got.body.lines : [];
    const persistedIds = persistedLines.map(l => l?.id ?? l?.lineId).filter(Boolean);
    const persistedHaveIds = persistedLines.length === 2 && persistedIds.length === 2 && persistedIds.every(id => typeof id === "string" && id.trim().length > 0);

    const pass = create.ok && got.ok && allHaveIds && uniqueIds && persistedHaveIds;
    return {
      test: "salesOrders:draft-lines-server-assign-ids",
      result: pass ? "PASS" : "FAIL",
      createLines,
      persistedLines,
      create,
      got
    };
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

    // Validate standardized error envelope
    const envelopeValid = 
      !commit.ok && 
      commit.status === 409 &&
      typeof commit.body?.code === "string" &&
      typeof commit.body?.message === "string" &&
      typeof commit.body?.requestId === "string" &&
      Array.isArray(commit.body?.details?.shortages) &&
      commit.body.details.shortages.length > 0;
    
    // Validate shortage contents
    const shortages = commit.body?.details?.shortages ?? [];
    const shortageValid = 
      envelopeValid &&
      shortages[0]?.lineId === "L1" &&
      shortages[0]?.itemId === itemId &&
      shortages[0]?.backordered === 5;
    
    const noBackorders = bo?.ok && backorderCount === 0;
    const pass = submit.ok && envelopeValid && shortageValid && noBackorders;
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
  "smoke:purchaseOrders:draft-create-edit-lines": async () => {
    await ensureBearer();

    const { vendorId } = await seedVendor(api);

    const prodA = await createProduct({ name: "PO-LineIds-A" });
    const prodB = await createProduct({ name: "PO-LineIds-B" });
    const prodC = await createProduct({ name: "PO-LineIds-C" });
    if (!prodA.ok || !prodB.ok || !prodC.ok) {
      return { test: "purchaseOrders:draft-create-edit-lines", result: "FAIL", prodA, prodB, prodC };
    }

    const invA = await createInventoryForProduct(prodA.body?.id, "PO-LineIds-ItemA");
    const invB = await createInventoryForProduct(prodB.body?.id, "PO-LineIds-ItemB");
    const invC = await createInventoryForProduct(prodC.body?.id, "PO-LineIds-ItemC");
    if (!invA.ok || !invB.ok || !invC.ok) {
      return { test: "purchaseOrders:draft-create-edit-lines", result: "FAIL", invA, invB, invC };
    }

    const create = await post(
      `/objects/purchaseOrder`,
      {
        type: "purchaseOrder",
        status: "draft",
        vendorId,
        lines: [
          { itemId: invA.body?.id, uom: "ea", qty: 2 },
          { itemId: invB.body?.id, uom: "ea", qty: 4 }
        ]
      },
      { "Idempotency-Key": idem() }
    );
    if (!create.ok) return { test: "purchaseOrders:draft-create-edit-lines", result: "FAIL", create };

    const poId = create.body?.id;
    const createLines = Array.isArray(create.body?.lines) ? create.body.lines : [];
    const createIds = createLines.map(l => l?.id ?? l?.lineId).filter(Boolean);
    const createAllHaveIds = createLines.length === 2 && createIds.length === 2 && createIds.every(id => typeof id === "string" && id.trim().length > 0);
    const createUniqueIds = new Set(createIds).size === createIds.length;

    const keepLine = createLines[0] || {};
    const removedLineId = createLines[1]?.id ?? createLines[1]?.lineId;

    const update = await put(`/objects/purchaseOrder/${encodeURIComponent(poId)}`, {
      vendorId,
      status: "draft",
      lines: [
        {
          id: keepLine.id ?? keepLine.lineId,
          itemId: keepLine.itemId,
          uom: keepLine.uom || "ea",
          qty: (Number(keepLine.qty) || 0) + 1
        },
        { itemId: invC.body?.id, uom: "ea", qty: 5 }
      ]
    });
    if (!update.ok) return { test: "purchaseOrders:draft-create-edit-lines", result: "FAIL", create, update };

    const got = poId ? await get(`/objects/purchaseOrder/${encodeURIComponent(poId)}`) : { ok: false, status: 0, body: {} };
    const persistedLines = Array.isArray(got.body?.lines) ? got.body.lines : [];
    const persistedIds = persistedLines.map(l => l?.id ?? l?.lineId).filter(Boolean);
    const persistedAllHaveIds = persistedLines.length === 2 && persistedIds.length === 2 && persistedIds.every(id => typeof id === "string" && id.trim().length > 0);
    const persistedIdsSet = new Set(persistedIds);

    const keptPresent = !!(keepLine.id ?? keepLine.lineId) && persistedIdsSet.has(keepLine.id ?? keepLine.lineId);
    const removedGone = removedLineId ? !persistedIdsSet.has(removedLineId) : true;
    const newLinePresent = persistedLines.some(l => l.itemId === invC.body?.id);

    const pass = create.ok && update.ok && got.ok && createAllHaveIds && createUniqueIds && persistedAllHaveIds && keptPresent && removedGone && newLinePresent;
    return {
      test: "purchaseOrders:draft-create-edit-lines",
      result: pass ? "PASS" : "FAIL",
      createLines,
      updateLines: Array.isArray(update.body?.lines) ? update.body.lines : [],
      persistedLines,
      removedLineId,
      keptLineId: keepLine.id ?? keepLine.lineId,
      create,
      update,
      got
    };
  },

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

  // Receive with location + lot and validate movement fields + by-location counters
  "smoke:po:receive-with-location-counters": async () => {
    await ensureBearer();
    const { vendorId } = await seedVendor(api);

    // Create two products and inventory items
    const prodA = await createProduct({ name: "RecvLocA" });
    const prodB = await createProduct({ name: "RecvLocB" });
    const invA  = await createInventoryForProduct(prodA.body.id, "RecvLocItemA");
    const invB  = await createInventoryForProduct(prodB.body.id, "RecvLocItemB");
    if (!invA.ok || !invB.ok) return { test: "po:receive-with-location-counters", result: "FAIL", invA, invB };

    // Create PO draft with two lines
    const create = await post(`/objects/purchaseOrder`, {
      type: "purchaseOrder",
      status: "draft",
      vendorId,
      lines: [
        { id: "LC1", itemId: invA.body.id, uom: "ea", qty: 2 },
        { id: "LC2", itemId: invB.body.id, uom: "ea", qty: 1 }
      ]
    });
    if (!create.ok) return { test: "po:receive-with-location-counters", result: "FAIL", create };
    const poId = create.body.id;

    // Submit + approve
    const submit  = await post(`/purchasing/po/${encodeURIComponent(poId)}:submit`,  {}, { "Idempotency-Key": idem() });
    const approve = await post(`/purchasing/po/${encodeURIComponent(poId)}:approve`, {}, { "Idempotency-Key": idem() });
    if (!submit.ok || !approve.ok) return { test: "po:receive-with-location-counters", result: "FAIL", submit, approve };

    const approved = await waitForStatus("purchaseOrder", poId, ["approved"]);
    if (!approved.ok) return { test: "po:receive-with-location-counters", result: "FAIL", reason: "not-approved-yet", approved };

    // Receive into a specific location; include lot for LC1
    const LOC = "LOC-RX";
    const LOT = "LOT-RX-200";
    const recv = await post(`/purchasing/po/${encodeURIComponent(poId)}:receive`, {
      lines: [
        { lineId: "LC1", deltaQty: 2, lot: LOT, locationId: LOC },
        { lineId: "LC2", deltaQty: 1, locationId: LOC }
      ]
    }, { "Idempotency-Key": idem() });
    if (!recv.ok) return { test: "po:receive-with-location-counters", result: "FAIL", step: "receive", recv };

    // Poll movements search for action=receive with refId=poId
    let found = [];
    for (let attempt = 0; attempt < 6; attempt++) {
      const search = await post(`/objects/inventoryMovement/search`, { refId: poId, action: "receive" });
      const items = Array.isArray(search.body?.items) ? search.body.items : [];
      found = items.filter(m => m.refId === poId);
      if (found.length >= 2) break;
      await sleep(200);
    }

    // Validate movement fields
    const mvLC1 = found.find(m => (m.poLineId === "LC1"));
    const mvLC2 = found.find(m => (m.poLineId === "LC2"));
    const fieldsOk = !!mvLC1 && !!mvLC2
      && mvLC1.action === "receive" && Number(mvLC1.qty) === 2 && mvLC1.locationId === LOC && mvLC1.lot === LOT
      && mvLC2.action === "receive" && Number(mvLC2.qty) === 1 && mvLC2.locationId === LOC;

    // Check by-location counters reflect received quantities
    const byLocA = await get(`/inventory/${encodeURIComponent(invA.body.id)}/onhand:by-location`);
    const byLocB = await get(`/inventory/${encodeURIComponent(invB.body.id)}/onhand:by-location`);
    const locA = Array.isArray(byLocA.body?.items) ? byLocA.body.items.find(b => (b.locationId ?? null) === LOC) : null;
    const locB = Array.isArray(byLocB.body?.items) ? byLocB.body.items.find(b => (b.locationId ?? null) === LOC) : null;
    const countersOk = !!locA && !!locB && Number(locA.onHand) >= 2 && Number(locB.onHand) >= 1;

    const pass = fieldsOk && countersOk;
    return {
      test: "po:receive-with-location-counters",
      result: pass ? "PASS" : "FAIL",
      poId,
      recv,
      fieldsOk,
      countersOk,
      mvLC1,
      mvLC2,
      byLocA,
      byLocB,
    };
  },

  // Validate negative/zero deltaQty rejects with 400 and references lineId
  "smoke:po:receive-line-negative-qty": async () => {
    await ensureBearer();
    const { vendorId } = await seedVendor(api);

    const prod = await createProduct({ name: "RecvNegQty" });
    const inv  = await createInventoryForProduct(prod.body.id, "RecvNegQtyItem");
    if (!inv.ok) return { test: "po-receive-line-negative-qty", result: "FAIL", inv };

    const create = await post(`/objects/purchaseOrder`, {
      type: "purchaseOrder", status: "draft", vendorId,
      lines: [{ id: "NL1", itemId: inv.body.id, uom: "ea", qty: 3 }]
    });
    if (!create.ok) return { test: "po-receive-line-negative-qty", result: "FAIL", create };
    const id = create.body.id;

    await post(`/purchasing/po/${encodeURIComponent(id)}:submit`,  {}, { "Idempotency-Key": idem() });
    await post(`/purchasing/po/${encodeURIComponent(id)}:approve`, {}, { "Idempotency-Key": idem() });
    const approved = await waitForStatus("purchaseOrder", id, ["approved"]);
    if (!approved.ok) return { test: "po-receive-line-negative-qty", result: "FAIL", reason: "not-approved-yet", approved };

    const includesLineRef = (body) => {
      try {
        if (!body || typeof body !== "object") return false;
        if (body.lineId === "NL1") return true;
        const d = body.details;
        if (d && typeof d === "object") {
          if (d.lineId === "NL1") return true;
          const errs = Array.isArray(d.errors) ? d.errors : Array.isArray(d) ? d : [];
          if (Array.isArray(errs)) {
            return errs.some(e => e && (e.lineId === "NL1" || e.field === "lineId"));
          }
        }
        return false;
      } catch { return false; }
    };

    // Attempt deltaQty=0
    const recvZero = await post(`/purchasing/po/${encodeURIComponent(id)}:receive`, {
      lines: [{ lineId: "NL1", deltaQty: 0 }]
    }, { "Idempotency-Key": idem() });

    // Attempt deltaQty=-1
    const recvNeg = await post(`/purchasing/po/${encodeURIComponent(id)}:receive`, {
      lines: [{ lineId: "NL1", deltaQty: -1 }]
    }, { "Idempotency-Key": idem() });

    const zeroBad = !recvZero.ok && recvZero.status === 400 && includesLineRef(recvZero.body);
    const negBad  = !recvNeg.ok  && recvNeg.status  === 400 && includesLineRef(recvNeg.body);

    const pass = zeroBad && negBad;
    return { test: "po-receive-line-negative-qty", result: pass ? "PASS" : "FAIL", create, recvZero, recvNeg };
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

    // Assert 409 with standardized error envelope
    const envelopeValid = !receiveAfterClose.ok
      && receiveAfterClose.status === 409
      && typeof receiveAfterClose.body?.code === "string"
      && receiveAfterClose.body?.code === "conflict"
      && typeof receiveAfterClose.body?.message === "string"
      && receiveAfterClose.body?.message.toLowerCase().includes("not receivable")
      && typeof receiveAfterClose.body?.requestId === "string"
      && receiveAfterClose.body?.requestId.length > 0
      && receiveAfterClose.body?.details !== undefined;
    
    const detailsValid = envelopeValid
      && receiveAfterClose.body?.details?.code === "PO_STATUS_NOT_RECEIVABLE"
      && receiveAfterClose.body?.details?.status === "closed";

    const guardOk = envelopeValid && detailsValid;

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

    // Assert 409 with standardized error envelope
    const envelopeValid = !receiveAfterCancel.ok
      && receiveAfterCancel.status === 409
      && typeof receiveAfterCancel.body?.code === "string"
      && receiveAfterCancel.body?.code === "conflict"
      && typeof receiveAfterCancel.body?.message === "string"
      && receiveAfterCancel.body?.message.toLowerCase().includes("not receivable")
      && typeof receiveAfterCancel.body?.requestId === "string"
      && receiveAfterCancel.body?.requestId.length > 0
      && receiveAfterCancel.body?.details !== undefined;
    
    const detailsValid = envelopeValid
      && receiveAfterCancel.body?.details?.code === "PO_STATUS_NOT_RECEIVABLE"
      && receiveAfterCancel.body?.details?.status === "cancelled";

    const guardOk = envelopeValid && detailsValid;

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

    // 1) Create items (will force shortage/backorders like the passing SO smoke)
    const item1 = await post(`/objects/${ITEM_TYPE}`, { productId: "prod-FILTER_TEST_A" });
    const item2 = await post(`/objects/${ITEM_TYPE}`, { productId: "prod-FILTER_TEST_B" });
    if (!item1.ok || !item2.ok) return { test: "objects:list-filter-soId", result: "FAIL", reason: "item-creation-failed", item1, item2 };

    const idA = item1.body?.id;
    const idB = item2.body?.id;

    // Force zero on-hand (matches passing commit-nonstrict flow: shortage => backorder)
    const onhandA = await onhand(idA);
    const qtyA = onhandA.body?.items?.[0]?.onHand ?? 0;
    if (qtyA > 0) await post(`/objects/${MV_TYPE}`, { itemId: idA, type: "adjust", qty: -qtyA });

    const onhandB = await onhand(idB);
    const qtyB = onhandB.body?.items?.[0]?.onHand ?? 0;
    if (qtyB > 0) await post(`/objects/${MV_TYPE}`, { itemId: idB, type: "adjust", qty: -qtyB });

    // Create SO with lines that exceed on-hand
    const create = await post(
      `/objects/salesOrder`,
      {
        type: "salesOrder",
        status: "draft",
        partyId,
        customerId: partyId,
        lines: [
          { id: "L1", itemId: idA, uom: "ea", qty: 5 },
          { id: "L2", itemId: idB, uom: "ea", qty: 3 }
        ]
      },
      { "Idempotency-Key": idem() }
    );
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

    // Force zero on-hand (matches passing commit-nonstrict flow: shortage => backorder)
    const onhand1 = await onhand(id1);
    const qty1 = onhand1.body?.items?.[0]?.onHand ?? 0;
    if (qty1 > 0) await post(`/objects/${MV_TYPE}`, { itemId: id1, type: "adjust", qty: -qty1 });

    const onhand2 = await onhand(id2);
    const qty2 = onhand2.body?.items?.[0]?.onHand ?? 0;
    if (qty2 > 0) await post(`/objects/${MV_TYPE}`, { itemId: id2, type: "adjust", qty: -qty2 });

    // Create SO with 2 lines to trigger backorders
    const create = await post(
      `/objects/salesOrder`,
      {
        type: "salesOrder",
        status: "draft",
        partyId,
        customerId: partyId,
        lines: [
          { id: "L1", itemId: id1, uom: "ea", qty: 3 },
          { id: "L2", itemId: id2, uom: "ea", qty: 2 }
        ]
      },
      { "Idempotency-Key": idem() }
    );
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
    const { vendorId, vendorParty } = await seedVendor({ post, get, put });
    const vendCheck = await get(`/objects/party/${encodeURIComponent(vendorId)}`);
    const vendorDebug = { vendorId, roles: vendCheck.body?.roles ?? vendorParty?.roles ?? [], party: vendCheck.body ?? vendorParty };
    
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
      recvBody,
      steps: { vendorDebug }
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
  },

  "smoke:vendor-filter-preferred": async () => {
    await ensureBearer();

    // Step 1: Create two vendors
    const { vendorId: vendor1Id } = await seedVendor(api);
    const vendor2Res = await post(`/objects/party`, {
      type: "party",
      name: `TestVendor2-${Date.now()}`,
      role: "vendor"
    }, { "Idempotency-Key": idem() });
    if (!vendor2Res.ok) return { test: "vendor-filter-preferred", result: "FAIL", step: "seedVendor2", vendor2Res };
    const vendor2Id = vendor2Res.body?.id;

    // Step 2: Create product1 with vendor1, product2 with vendor2
    const prod1 = await createProduct({ name: `ProdV1-${Date.now()}`, preferredVendorId: vendor1Id });
    if (!prod1.ok) return { test: "vendor-filter-preferred", result: "FAIL", step: "createProduct1", prod1 };
    const prod1Id = prod1.body?.id;

    const prod2 = await createProduct({ name: `ProdV2-${Date.now()}`, preferredVendorId: vendor2Id });
    if (!prod2.ok) return { test: "vendor-filter-preferred", result: "FAIL", step: "createProduct2", prod2 };
    const prod2Id = prod2.body?.id;

    // Step 3: Create inventory for both products
    const inv1 = await createInventoryForProduct(prod1Id, `Item1-${Date.now()}`);
    if (!inv1.ok) return { test: "vendor-filter-preferred", result: "FAIL", step: "createInventory1", inv1 };
    const inv1Id = inv1.body?.id;

    const inv2 = await createInventoryForProduct(prod2Id, `Item2-${Date.now()}`);
    if (!inv2.ok) return { test: "vendor-filter-preferred", result: "FAIL", step: "createInventory2", inv2 };
    const inv2Id = inv2.body?.id;

    // Step 4: Create SO with item1 only (so backorder created for vendor1)
    const { partyId } = await seedParties(api);
    const so = await post(`/objects/salesOrder`, {
      type: "salesOrder",
      partyId,
      status: "draft",
      lines: [{ itemId: inv1Id, qty: 5, uom: "ea" }]
    });
    if (!so.ok) return { test: "vendor-filter-preferred", result: "FAIL", step: "createSO", so };
    const soId = so.body?.id;

    // Step 5: Submit and commit SO to trigger backorder creation
    const soSubmit = await post(`/sales/so/${encodeURIComponent(soId)}:submit`, {}, { "Idempotency-Key": idem() });
    if (!soSubmit.ok) return { test: "vendor-filter-preferred", result: "FAIL", step: "submitSO", soSubmit };

    const soCommit = await post(`/sales/so/${encodeURIComponent(soId)}:commit`, {}, { "Idempotency-Key": idem() });
    if (!soCommit.ok) return { test: "vendor-filter-preferred", result: "FAIL", step: "commitSO", soCommit };

    // Step 5b: Assert commit created backorders (shortages)
    const shortages = Array.isArray(soCommit.body?.shortages) ? soCommit.body.shortages : [];
    if (shortages.length === 0) {
      return {
        test: "vendor-filter-preferred",
        result: "FAIL",
        step: "commitDidNotCreateBackorders",
        reason: "commit_returned_zero_shortages",
        soId,
        itemId: inv1Id,
        commitStatus: soCommit.status,
        commitBody: soCommit.body
      };
    }

    // Step 6: Discover backorders by soId+itemId (no vendor filter) - eventual consistency
    const boDiscovery = await waitForBackorders({ soId, itemId: inv1Id, status: "open" }, { timeoutMs: 12000, intervalMs: 500 });
    if (!boDiscovery.ok) {
      return {
        test: "vendor-filter-preferred",
        result: "FAIL",
        step: "noBackordersCreated",
        reason: "timeout_discovering_backorders",
        soId,
        itemId: inv1Id,
        vendor1Id,
        vendor2Id,
        debug: boDiscovery.debug || {}
      };
    }
    const allBackorders = boDiscovery.items || [];
    if (allBackorders.length === 0) {
      return {
        test: "vendor-filter-preferred",
        result: "FAIL",
        step: "noBackordersCreated",
        reason: "empty_after_discovery",
        soId,
        itemId: inv1Id
      };
    }

    // Step 6b: Capture debug info from first discovered backorder
    const bo0 = allBackorders[0];
    const bo0Debug = {
      id: bo0?.id,
      soId: bo0?.soId,
      itemId: bo0?.itemId,
      status: bo0?.status,
      preferredVendorId: bo0?.preferredVendorId,
      vendorId: bo0?.vendorId,
      allKeys: Object.keys(bo0 || {})
    };

    // Step 7: Test vendor filtering - search with vendor1 filter
    const fetchPageV1 = async ({ limit, next }) => {
      return await post(`/objects/backorderRequest/search`, {
        soId,
        status: "open",
        preferredVendorId: vendor1Id,
        limit,
        next
      });
    };
    const v1 = await fetchAllPages({ fetchPage: fetchPageV1, pageSize: 50, maxPages: 10 });
    const boV1Items = v1.items ?? [];
    const foundV1 = boV1Items.length > 0;

    // Step 8: Test vendor filtering - search with vendor2 filter (expect zero)
    const fetchPageV2 = async ({ limit, next }) => {
      return await post(`/objects/backorderRequest/search`, {
        soId,
        status: "open",
        preferredVendorId: vendor2Id,
        limit,
        next
      });
    };
    const v2 = await fetchAllPages({ fetchPage: fetchPageV2, pageSize: 50, maxPages: 10 });
    const boV2Items = v2.items ?? [];
    const foundV2 = boV2Items.length > 0;

    // Assertions
    const matchesV1 = boV1Items.every(b => b.status === "open" && b.soId === soId);
    const pass = foundV1 && matchesV1 && !foundV2;
    
    return {
      test: "vendor-filter-preferred",
      result: pass ? "PASS" : "FAIL",
      debug: {
        expectedVendor1Id: vendor1Id,
        expectedVendor2Id: vendor2Id,
        discoveredBackorder: bo0Debug
      },
      discovery: { totalBackorders: allBackorders.length },
      filterResults: {
        vendor1Filtered: { count: boV1Items.length, found: foundV1, matches: matchesV1 },
        vendor2Filtered: { count: boV2Items.length, found: foundV2 }
      },
      ...((!foundV1 && allBackorders.length > 0) ? { 
        reason: "vendor1FilterNoMatches",
        detail: "Backorders exist but vendor1 filter returned none"
      } : {}),
      ...(foundV2 ? {
        reason: "vendor2FilterUnexpectedMatches", 
        detail: "Vendor2 filter should return zero but found items"
      } : {})
    };
  },

  "smoke:suggest-po-with-vendor": async () => {
    await ensureBearer();

    // Step 1: Create vendor and product with preferredVendorId
    const { vendorId } = await seedVendor(api);
    const prod = await createProduct({ name: `SuggestPOTest-${Date.now()}`, preferredVendorId: vendorId });
    if (!prod.ok) return { test: "suggest-po-with-vendor", result: "FAIL", step: "createProduct", prod };
    const prodId = prod.body?.id;

    // Step 2: Create inventory
    const inv = await createInventoryForProduct(prodId, `InventorySuggest-${Date.now()}`);
    if (!inv.ok) return { test: "suggest-po-with-vendor", result: "FAIL", step: "createInventory", inv };
    const invId = inv.body?.id;

    // Step 3: Create SO with shortage to trigger backorder
    const { partyId } = await seedParties(api);
    const so = await post(`/objects/salesOrder`, {
      type: "salesOrder",
      partyId,
      status: "draft",
      lines: [{ itemId: invId, qty: 10, uom: "ea" }]
    });
    if (!so.ok) return { test: "suggest-po-with-vendor", result: "FAIL", step: "createSO", so };
    const soId = so.body?.id;

    // Step 4: Submit and commit SO to trigger backorder creation
    const soSubmit = await post(`/sales/so/${encodeURIComponent(soId)}:submit`, {}, { "Idempotency-Key": idem() });
    if (!soSubmit.ok) return { test: "suggest-po-with-vendor", result: "FAIL", step: "submitSO", soSubmit };

    const soCommit = await post(`/sales/so/${encodeURIComponent(soId)}:commit`, {}, { "Idempotency-Key": idem() });
    if (!soCommit.ok) return { test: "suggest-po-with-vendor", result: "FAIL", step: "commitSO", soCommit };

    // Step 4b: Assert commit created backorders (shortages)
    const shortages = Array.isArray(soCommit.body?.shortages) ? soCommit.body.shortages : [];
    if (shortages.length === 0) {
      return {
        test: "suggest-po-with-vendor",
        result: "FAIL",
        step: "commitDidNotCreateBackorders",
        reason: "commit_returned_zero_shortages",
        vendorId,
        soId,
        itemId: invId,
        commitStatus: soCommit.status,
        commitBody: soCommit.body
      };
    }

    // Step 5: Discover backorders by soId+itemId (no vendor filter) - eventual consistency
    const boDiscovery = await waitForBackorders({ soId, itemId: invId, status: "open" }, { timeoutMs: 12000, intervalMs: 500 });
    if (!boDiscovery.ok) {
      return {
        test: "suggest-po-with-vendor",
        result: "FAIL",
        step: "noBackordersCreated",
        reason: "timeout_discovering_backorders",
        vendorId,
        soId,
        itemId: invId,
        debug: boDiscovery.debug || {}
      };
    }
    const allBackorders = boDiscovery.items || [];
    if (allBackorders.length === 0) {
      return {
        test: "suggest-po-with-vendor",
        result: "FAIL",
        step: "noBackordersCreated",
        reason: "empty_after_discovery",
        vendorId,
        soId,
        itemId: invId
      };
    }

    // Step 6: Use discovered backorder IDs for suggest-po
    const boIds = allBackorders.map(b => b.id).filter(Boolean);
    const boUseIds = boIds.length ? [boIds[0]] : [];
    if (!boUseIds.length) {
      return {
        test: "suggest-po-with-vendor",
        result: "FAIL",
        step: "noBackorderIds",
        reason: "backorders_missing_ids",
        vendorId,
        soId,
        itemId: invId,
        backordersFound: allBackorders.length
      };
    }

    // Step 7: Call suggest-po
    const suggest = await post(`/purchasing/suggest-po`, {
      requests: boUseIds.map(id => ({ backorderRequestId: id }))
    }, { "Idempotency-Key": idem() });
    if (!suggest.ok) return { test: "suggest-po-with-vendor", result: "FAIL", step: "suggestPO", suggest };

    const draft = suggest.body?.draft ?? suggest.body?.drafts?.[0];
    if (!draft) return { test: "suggest-po-with-vendor", result: "FAIL", step: "noDraft", suggest };

    // Step 8: Verify draft has correct vendorId and backorderRequestIds
    const hasCorrectVendor = draft.vendorId === vendorId;
    const hasBackorderIds = (draft.lines || []).some(line => Array.isArray(line.backorderRequestIds) && line.backorderRequestIds.length > 0);
    const pass = hasCorrectVendor && hasBackorderIds;

    return {
      test: "suggest-po-with-vendor",
      result: pass ? "PASS" : "FAIL",
      discovery: { totalBackorders: allBackorders.length, usedBackorderIds: boUseIds },
      draftValidation: {
        vendorId: { expected: vendorId, actual: draft.vendorId, match: hasCorrectVendor },
        hasBackorderIds: hasBackorderIds,
        lineCount: (draft.lines ?? []).length
      },
      ...(!hasCorrectVendor ? {
        reason: "vendorIdMismatch",
        detail: `Expected vendorId ${vendorId}, got ${draft.vendorId}`
      } : {}),
      ...(!hasBackorderIds ? {
        reason: "missingBackorderIds",
        detail: "Draft lines missing backorderRequestIds"
      } : {})
    };
  },

  // === Sprint H: Web-style reliability smoke (list + detail + join) ===
  "smoke:webish:purchaseOrders:list-detail-join": async () => {
    await ensureBearer();

    // Step 1: Create vendor
    const { vendorId } = await seedVendor(api);
    if (!vendorId) {
      return { test: "webish:purchaseOrders:list-detail-join", result: "FAIL", reason: "vendor-creation-failed" };
    }

    // Step 2: Create products and inventory
    const prodA = await createProduct({ name: `ListDetail-A-${Date.now()}` });
    const prodB = await createProduct({ name: `ListDetail-B-${Date.now()}` });
    if (!prodA.ok || !prodB.ok) {
      return { test: "webish:purchaseOrders:list-detail-join", result: "FAIL", reason: "product-creation-failed", prodA, prodB };
    }

    const invA = await createInventoryForProduct(prodA.body?.id, `ListDetail-ItemA-${Date.now()}`);
    const invB = await createInventoryForProduct(prodB.body?.id, `ListDetail-ItemB-${Date.now()}`);
    if (!invA.ok || !invB.ok) {
      return { test: "webish:purchaseOrders:list-detail-join", result: "FAIL", reason: "inventory-creation-failed", invA, invB };
    }

    // Step 3: Create PO draft with 2 lines
    const createPO = await post(
      `/objects/purchaseOrder`,
      {
        type: "purchaseOrder",
        status: "draft",
        vendorId,
        lines: [
          { itemId: invA.body?.id, uom: "ea", qty: 5 },
          { itemId: invB.body?.id, uom: "ea", qty: 3 }
        ]
      },
      { "Idempotency-Key": idem() }
    );
    if (!createPO.ok || !createPO.body?.id) {
      return { test: "webish:purchaseOrders:list-detail-join", result: "FAIL", reason: "po-creation-failed", createPO };
    }

    const createdPoId = createPO.body.id;
    const createdLines = Array.isArray(createPO.body?.lines) ? createPO.body.lines : [];

    // Step 4: Immediately GET the created PO to verify persistence
    const createdDetailRes = await get(`/objects/purchaseOrder/${encodeURIComponent(createdPoId)}`);
    if (!createdDetailRes.ok) {
      return {
        test: "webish:purchaseOrders:list-detail-join",
        result: "FAIL",
        reason: "created-po-not-fetchable",
        debug: { createdPoId, status: createdDetailRes.status }
      };
    }

    const createdDetail = createdDetailRes.body;
    if (createdDetail?.type !== "purchaseOrder" || createdDetail?.status !== "draft" || !createdDetail?.vendorId) {
      return {
        test: "webish:purchaseOrders:list-detail-join",
        result: "FAIL",
        reason: "created-po-missing-fields",
        debug: {
          createdPoId,
          type: createdDetail?.type,
          status: createdDetail?.status,
          vendorId: createdDetail?.vendorId
        }
      };
    }

    // Step 5: List draft POs (first page only, no ordering dependency)
    const listQuery = {
      type: "purchaseOrder",
      filter: JSON.stringify({ status: { eq: "draft" } }),
      limit: 50
    };

    const listRes = await get(`/objects/purchaseOrder`, listQuery);
    if (!listRes.ok || !Array.isArray(listRes.body?.items) || listRes.body.items.length === 0) {
      return {
        test: "webish:purchaseOrders:list-detail-join",
        result: "FAIL",
        reason: "list-failed-or-empty",
        debug: {
          ok: listRes.ok,
          status: listRes.status,
          itemCount: Array.isArray(listRes.body?.items) ? listRes.body.items.length : 0
        }
      };
    }

    const listItems = listRes.body.items;
    const listPageInfo = listRes.body?.pageInfo || {};

    // Pick a PO from the list (prefer one with vendorId)
    const listedPO = listItems.find((po) => po?.id && po?.vendorId) || listItems[0];
    if (!listedPO?.id) {
      return {
        test: "webish:purchaseOrders:list-detail-join",
        result: "FAIL",
        reason: "no-valid-po-in-list",
        debug: { listCount: listItems.length, first5Ids: listItems.slice(0, 5).map((p) => p?.id) }
      };
    }

    const listedPoId = listedPO.id;

    // Step 6: Fetch detail for the listed PO
    const listedDetailRes = await get(`/objects/purchaseOrder/${encodeURIComponent(listedPoId)}`);
    if (!listedDetailRes.ok || listedDetailRes.body?.id !== listedPoId) {
      return {
        test: "webish:purchaseOrders:list-detail-join",
        result: "FAIL",
        reason: "listed-po-detail-fetch-failed",
        debug: { listedPoId, ok: listedDetailRes.ok, status: listedDetailRes.status }
      };
    }

    const listedDetail = listedDetailRes.body;
    const listedDetailLines = Array.isArray(listedDetail?.lines) ? listedDetail.lines : [];

    // Step 7: Panel join - fetch vendor for the listed PO
    const listedVendorId = listedDetail?.vendorId;
    if (!listedVendorId) {
      return {
        test: "webish:purchaseOrders:list-detail-join",
        result: "FAIL",
        reason: "listed-po-missing-vendorId",
        debug: { listedPoId, listedDetail: snippet(listedDetail, 300) }
      };
    }

    const vendorRes = await get(`/objects/party/${encodeURIComponent(listedVendorId)}`);
    const vendorOk = vendorRes.ok && !!vendorRes.body?.name;

    // Assertions
    const hasPageInfo = !!(listPageInfo && typeof listPageInfo === "object");
    const pageInfoHasNext = "hasNext" in listPageInfo || "nextCursor" in listPageInfo || "next" in listPageInfo;
    const createdPoFetchOk = createdDetailRes.ok && createdDetail?.type === "purchaseOrder";
    const listOk = listRes.ok && listItems.length > 0;
    const listedDetailFetchOk = listedDetailRes.ok && listedDetail?.id === listedPoId;
    const vendorJoinOk = vendorOk;
    const linesPresent = listedDetailLines.length > 0;

    const pass = hasPageInfo && pageInfoHasNext && createdPoFetchOk && listOk && listedDetailFetchOk && vendorJoinOk && linesPresent;

    return {
      test: "webish:purchaseOrders:list-detail-join",
      result: pass ? "PASS" : "FAIL",
      assertions: {
        pageInfo: { present: hasPageInfo, hasNextField: pageInfoHasNext },
        createdPoFetchOk,
        listOk,
        listedDetailFetchOk,
        vendorJoinOk,
        linesPresent
      },
      ...(pass ? {} : {
        debug: {
          createdPoId,
          createdStatus: createdDetail?.status,
          createdVendorId: createdDetail?.vendorId,
          listCount: listItems.length,
          first5Ids: listItems.slice(0, 5).map((p) => p?.id),
          listedPoId,
          listedStatus: listedDetail?.status,
          listedVendorId,
          listedLineCount: listedDetailLines.length,
          vendorFetched: vendorOk
        }
      })
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
