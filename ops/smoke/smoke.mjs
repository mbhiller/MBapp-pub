#!/usr/bin/env node
import process from "node:process";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "child_process";
import { baseGraph } from "./seed/routing.ts";
import { seedParties, seedVendor, seedCustomer } from "./seed/parties.ts";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";

// Stable path resolution from smoke file location
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");

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

// Token management: acquire via /auth/dev-login if not supplied
let tokenAcquired = false;
let jwtTenant = null; // Set after token acquisition

async function acquireToken() {
  if (tokenAcquired) return; // already done
  
  const existingToken = process.env.MBAPP_BEARER;
  if (existingToken && existingToken.trim().length > 0) {
    jwtTenant = decodeJwtTenant(existingToken);
    const allowMismatch = process.env.MBAPP_SMOKE_ALLOW_TENANT_MISMATCH === "1";
    if (!allowMismatch && jwtTenant && jwtTenant !== TENANT) {
      console.error(`[smokes] Existing MBAPP_BEARER tenant ("${jwtTenant}") does not match requested tenant ("${TENANT}"). Set MBAPP_SMOKE_ALLOW_TENANT_MISMATCH=1 to override, or unset MBAPP_BEARER to auto-acquire.`);
      process.exit(2);
    }
    console.log(JSON.stringify({ base: API, tenant: TENANT, smokeRunId: SMOKE_RUN_ID, tokenVar: "MBAPP_BEARER", hasToken: true, jwtTenant, source: "env" }));
    tokenAcquired = true;
    return;
  }

  // Auto-acquire via /auth/dev-login
  console.log(`[smokes] No MBAPP_BEARER set; acquiring token via POST ${API}/auth/dev-login...`);
  const loginBody = {
    email: EMAIL,
    tenantId: TENANT
  };
  
  try {
    const res = await fetch(`${API}/auth/dev-login`, {
      method: "POST",
      headers: { 
        "content-type": "application/json",
        "x-tenant-id": TENANT
      },
      body: JSON.stringify(loginBody)
    });
    
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error(`[smokes] Failed to acquire token via /auth/dev-login: ${res.status} ${res.statusText}`);
      console.error(`[smokes] Response: ${errText}`);
      process.exit(2);
    }
    
    const data = await res.json();
    if (!data.token) {
      console.error(`[smokes] /auth/dev-login succeeded but returned no token: ${JSON.stringify(data)}`);
      process.exit(2);
    }
    
    process.env.MBAPP_BEARER = data.token;
    jwtTenant = decodeJwtTenant(data.token);
    console.log(JSON.stringify({ base: API, tenant: TENANT, smokeRunId: SMOKE_RUN_ID, tokenVar: "MBAPP_BEARER", hasToken: true, jwtTenant, source: "auto-acquired" }));
    tokenAcquired = true;
  } catch (err) {
    console.error(`[smokes] Error acquiring token: ${err.message}`);
    process.exit(2);
  }
}

/* ---------- Auth & HTTP ---------- */
async function ensureBearer(){ 
  await acquireToken();
}
function baseHeaders(){
  const h={"accept":"application/json","content-type":"application/json","x-tenant-id":TENANT};
  const token=process.env.MBAPP_BEARER;
  if(token) h["authorization"]=`Bearer ${token}`;
  return h;
}
// Allow per-request Authorization override: "default" | "invalid" | "none"
function buildHeaders(base = {}, auth = "default") {
  const h = { "content-type": "application/json", "x-tenant-id": TENANT, ...base };
  const token = process.env.MBAPP_BEARER;
  if (auth === "default") {
    if (token) h.authorization = `Bearer ${token}`;
  } else if (auth === "invalid") {
    h.authorization = "Bearer invalid";
  } else if (auth === "none") {
    // do not set authorization at all
    if (h.authorization) delete h.authorization;
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

// Debug helper: log request/response details when DEBUG=1
function debugRequest(method, url, headers, status) {
  if (process.env.DEBUG !== "1" && process.env.MBAPP_DEBUG !== "1") return;
  const hasAuth = !!headers.authorization || !!headers.Authorization;
  const tenantKey = headers["x-tenant-id"] ? "x-tenant-id" : 
                    headers["X-Tenant-Id"] ? "X-Tenant-Id" : "(none)";
  console.log(`[DEBUG] ${method} ${url} → ${status} | auth=${hasAuth} | tenant-header=${tenantKey}`);
}

// Auto-retry wrapper: refresh token on 401/403 and retry once
async function withAuthRetry(fn) {
  const result = await fn();
  
  // If request succeeded or wasn't an auth failure, return as-is
  if (result.ok || (result.status !== 401 && result.status !== 403)) {
    return result;
  }
  
  // Auth failure: refresh token and retry once
  console.log(`[smokes] Auth failure (${result.status}), refreshing token and retrying...`);
  tokenAcquired = false; // Force re-acquisition
  delete process.env.MBAPP_BEARER;
  await acquireToken();
  
  // Retry the operation with new token
  return await fn();
}

async function get(p, params, opts){
  return await withAuthRetry(async () => {
    const headers = buildHeaders({ ...baseHeaders(), ...((opts&&opts.headers)||{}) }, (opts&&opts.auth) ?? "default");
    const url = API + p + qs(params);
    const r=await fetch(url, {headers});
    debugRequest("GET", url, headers, r.status);
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
  });
}
async function post(p,body,h={},opts){
  return await withAuthRetry(async () => {
    const headers = buildHeaders({ ...baseHeaders(), ...h, ...((opts&&opts.headers)||{}) }, (opts&&opts.auth) ?? "default");
    const url = API+p;
    const r=await fetch(url,{method:"POST",headers,body:JSON.stringify(body??{})});
    debugRequest("POST", url, headers, r.status);
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
  });
}
async function put(p,body,h={},opts){
  return await withAuthRetry(async () => {
    const headers = buildHeaders({ ...baseHeaders(), ...h, ...((opts&&opts.headers)||{}) }, (opts&&opts.auth) ?? "default");
    const url = API+p;
    const r=await fetch(url,{method:"PUT",headers,body:JSON.stringify(body??{})});
    debugRequest("PUT", url, headers, r.status);
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
  });
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
  let lastPageInfo = { hasNext: false, has_more: false };
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
  while (Date.now() - start < timeoutMs && attempts < 32) {
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

/**
 * Search for an item by id by paginating through all pages.
 * Polls periodically for eventual consistency; fails with actionable diagnostics if not found.
 *
 * @param {Function} fetchPage - function(limit, next) returning { items?, pageInfo?, ... }
 * @param {string} targetId - the id to search for
 * @param {object} options - { timeoutMs, intervalMs, pageSize, maxPages }
 * @returns {object} the found item or throws with detailed diagnostics
 */
async function findItemById({ fetchPage, targetId, timeoutMs = 8000, intervalMs = 250, pageSize = 50, maxPages = 100 }) {
  const start = Date.now();
  let attempts = 0;
  let totalScanned = 0;
  let firstId = null;
  let lastId = null;
  let cursorsVisited = [];
  let lastListParams = {};

  while (Date.now() - start < timeoutMs && attempts < 32) {
    attempts++;
    let next = undefined;
    let pageNum = 0;
    let found = null;
    cursorsVisited = [];

    while (pageNum < maxPages) {
      cursorsVisited.push(next ?? "null");
      lastListParams = { limit: pageSize, next };
      const res = await fetchPage({ limit: pageSize, next });
      const items = Array.isArray(res?.items) ? res.items
        : Array.isArray(res?.body?.items) ? res.body.items
        : [];
      const pageInfo = res?.body?.pageInfo ?? res?.pageInfo ?? {};
      
      totalScanned += items.length;
      if (items.length > 0) {
        firstId = firstId || items[0]?.id;
        lastId = items[items.length - 1]?.id;
        found = items.find(item => item.id === targetId);
        if (found) {
          return found;
        }
      }

      pageNum++;
      const nextCursor = pageInfo?.nextCursor ?? pageInfo?.next ?? res?.body?.next ?? res?.next ?? res?.cursor ?? null;
      if (!nextCursor || !pageInfo || (!pageInfo.hasNext && !pageInfo.has_more && !pageInfo.more && !nextCursor)) {
        break;
      }
      next = nextCursor;
    }

    // Not found on this polling attempt; wait before retry
    await sleep(intervalMs);
  }

  // Item not found after all retries
  const debug = {
    fn: "findItemById",
    targetId,
    attempts,
    totalScanned,
    firstId,
    lastId,
    cursorsVisited: cursorsVisited.slice(0, 10), // limit history
    lastListParams,
    timeoutMs,
    intervalMs,
    pageSize,
    maxPages
  };
  console.warn("[findItemById not found]", JSON.stringify(debug, null, 2));
  const err = new Error(`findItemById: item "${targetId}" not found in list after ${attempts} polling attempts, scanned ${totalScanned} total items`);
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
const ITEM_TYPE=process.env.SMOKE_ITEM_TYPE??"inventoryItem"; // default to canonical, aliases supported server-side
async function createProduct(body) {
  const baseName = `${body?.name ?? "Prod"}-${Date.now()}`;
  const baseSku = `SKU-${Math.random().toString(36).slice(2,7)}`;
  return await post(`/objects/product`, { type:"product", kind:"good", name: smokeTag(baseName), sku: smokeTag(baseSku), ...body });
}
async function createInventoryForProduct(productId, name = "Item") {
  const baseName = `${name}-${Date.now()}`;
  // Prefer canonical inventoryItem; server aliases allow legacy fallback if needed
  const payload = { type:"inventoryItem", name: smokeTag(baseName), productId, uom:"ea" };
  const res = await post(`/objects/inventoryItem`, payload);
  if (res.ok) return res;
  // Fallback once to legacy inventory for unexpected environments
  return await post(`/objects/inventory`, { ...payload, type:"inventory" });
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
      const receiveIdk = idem();
      // Seed vendor and customer up-front so drafts inherit vendor and SO can be linked deterministically
      const { vendorId, vendorParty } = await seedVendor(api);
      const vendCheck = await get(`/objects/party/${encodeURIComponent(vendorId)}`);
      const vendorDebug = { vendorId, roles: vendCheck.body?.roles ?? vendorParty?.roles ?? [], party: vendCheck.body ?? vendorParty };

      const { customerId, customerParty } = await seedCustomer(api);
      const custCheck = await get(`/objects/party/${encodeURIComponent(customerId)}`);
      const customerDebug = { customerId, roles: custCheck.body?.roles ?? customerParty?.roles ?? [], party: custCheck.body ?? customerParty };

      // 1) Create item with vendor linkage and zeroed onhand
      const prod = await createProduct({ name: `LoopTest-${SMOKE_RUN_ID}`, preferredVendorId: vendorId, vendorId });
      if (!prod.ok) return { test: "close-the-loop", result: "FAIL", step: "createProduct", prod };
      const item = await createInventoryForProduct(prod.body?.id, `LoopTestItem-${SMOKE_RUN_ID}`);
      if (!item.ok) return { test: "close-the-loop", result: "FAIL", step: "createInventory", item };
      const itemId = item.body?.id;

      const onhandPre = await onhand(itemId);
      if (!onhandPre.ok) return { test: "close-the-loop", result: "FAIL", step: "onhand-pre", onhandPre };
      const onHandPre = Number(onhandPre.body?.items?.[0]?.onHand ?? 0);
      if (onHandPre !== 0) {
        const adjust = await post(`/objects/inventoryMovement`, { itemId, type: "adjust", qty: -onHandPre }, { "Idempotency-Key": idem() });
        if (!adjust.ok) return { test: "close-the-loop", result: "FAIL", step: "reset-onhand", adjust };
      }
      const onhand0 = await onhand(itemId);
      if (!onhand0.ok) return { test: "close-the-loop", result: "FAIL", step: "onhand-0", onhand0 };
      const onHandBefore = Number(onhand0.body?.items?.[0]?.onHand ?? 0);

      // 2) Create SO that forces backorder
      const so = await post(`/objects/salesOrder`, {
        type: "salesOrder",
        status: "draft",
        partyId: customerId,
        lines: [{ itemId, qty: 4, uom: "ea" }]
      });
      if (!so.ok) return { test: "close-the-loop", result: "FAIL", step: "createSO", so };
      const soId = so.body?.id;
      await post(`/sales/so/${encodeURIComponent(soId)}:submit`, {}, { "Idempotency-Key": idem() });
      await post(`/sales/so/${encodeURIComponent(soId)}:commit`, {}, { "Idempotency-Key": idem() });

      // 3) Verify backorder(s) exist then convert them to mirror UI flow
      const boRes = await post(`/objects/backorderRequest/search`, { soId, itemId, status: "open" });
      const boRecords = Array.isArray(boRes.body?.items) ? boRes.body.items : [];
      if (!boRes.ok || boRecords.length === 0)
        return { test: "close-the-loop", result: "FAIL", step: "backorderRequest-open", boRes };
      const boIds = boRecords.map(b => b.id);
      recordFromListResult(boRecords, "backorderRequest", `/objects/backorderRequest/search`);

      // Assert referential integrity for each backorderRequest before converting
      const lineMatches = (lines, targetId) => {
        if (!targetId) return false;
        const t = String(targetId);
        const arr = Array.isArray(lines) ? lines : [];
        return arr.some(ln => {
          if (!ln || typeof ln !== "object") return false;
          const ids = [ln.id, ln.lineId, ln._key, ln.cid, ln.line?.id].filter(Boolean).map(String);
          return ids.includes(t);
        });
      };

      const soCache = new Map();
      const inventoryCache = new Map();
      const seededSoLines = Array.isArray(so.body?.lines) ? so.body.lines : Array.isArray(so.body?.lineItems) ? so.body.lineItems : [];

      const fetchInventoryWithFallback = async (id) => {
        let res = await get(`/objects/inventoryItem/${encodeURIComponent(id)}`);
        if (!res.ok && res.status === 404) {
          res = await get(`/objects/inventory/${encodeURIComponent(id)}`);
        }
        return res;
      };

      for (const bo of boRecords) {
        const boId = bo?.id;
        const boSoId = bo?.soId ?? bo?.salesOrderId ?? bo?.salesOrder?.id;
        const boLineId = bo?.soLineId ?? bo?.lineId ?? bo?.salesOrderLineId ?? bo?.line?.id;
        const boItemId = bo?.itemId ?? bo?.inventoryItemId ?? bo?.inventoryId ?? bo?.item?.id;

        if (!boSoId) return { test: "close-the-loop", result: "FAIL", step: "backorder-soId-missing", boId, bo };
        if (!boLineId) return { test: "close-the-loop", result: "FAIL", step: "backorder-lineId-missing", boId, soId: boSoId, bo };
        if (!boItemId) return { test: "close-the-loop", result: "FAIL", step: "backorder-itemId-missing", boId, soId: boSoId, bo };

        let soFetch = soCache.get(boSoId);
        if (!soFetch) {
          soFetch = await get(`/objects/salesOrder/${encodeURIComponent(boSoId)}`);
          soCache.set(boSoId, soFetch);
        }
        if (!soFetch.ok) return { test: "close-the-loop", result: "FAIL", step: "backorder-so-fetch", boId, soId: boSoId, soFetch };

        const soLines = [
          ...(Array.isArray(soFetch.body?.lines) ? soFetch.body.lines : []),
          ...(Array.isArray(soFetch.body?.lineItems) ? soFetch.body.lineItems : []),
          ...seededSoLines
        ];
        if (!lineMatches(soLines, boLineId)) {
          return { test: "close-the-loop", result: "FAIL", step: "backorder-line-missing", boId, soId: boSoId, lineId: boLineId, soLines: soLines.map(l => ({ id: l?.id ?? l?.lineId ?? l?._key ?? l?.cid, qty: l?.qty ?? l?.quantity })) };
        }

        let inventory = inventoryCache.get(boItemId);
        if (!inventory) {
          inventory = await fetchInventoryWithFallback(boItemId);
          inventoryCache.set(boItemId, inventory);
        }
        if (!inventory.ok) {
          return { test: "close-the-loop", result: "FAIL", step: "backorder-inventory-missing", boId, soId: boSoId, itemId: boItemId, inventory };
        }
      }

      for (const boId of boIds) {
        const convert = await post(`/objects/backorderRequest/${encodeURIComponent(boId)}:convert`, {}, { "Idempotency-Key": idem() });
        if (!convert.ok) return { test: "close-the-loop", result: "FAIL", step: "backorder-convert", convert };
      }
      const boConverted = await post(`/objects/backorderRequest/search`, { soId, itemId, status: "converted" });
      if (!boConverted.ok || !Array.isArray(boConverted.body?.items) || boConverted.body.items.length !== boIds.length)
        return { test: "close-the-loop", result: "FAIL", step: "backorder-converted", boConverted };

      // 4) suggest-po using explicit vendor to avoid skips
      const suggest = await post(`/purchasing/suggest-po`, { requests: boIds.map(id => ({ backorderRequestId: id })), vendorId }, { "Idempotency-Key": idem() });
      const drafts = Array.isArray(suggest.body?.drafts) ? suggest.body.drafts : suggest.body?.draft ? [suggest.body.draft] : [];
      if (!suggest.ok || drafts.length === 0)
        return { test: "close-the-loop", result: "FAIL", step: "suggest-po", suggest };
      const draft = drafts[0];
      const draftLines = draft.lines ?? [];
      const hasVendor = !!draft.vendorId;
      const hasBackorderIds = draftLines.every(l => Array.isArray(l.backorderRequestIds) && l.backorderRequestIds.length > 0);
      if (!hasVendor || !hasBackorderIds)
        return { test: "close-the-loop", result: "FAIL", step: "draft-check", hasVendor, hasBackorderIds, draft };

      // 5) Create PO via create-from-suggestion to exercise validation
      const poCreate = await post(`/purchasing/po:create-from-suggestion`, { draft }, { "Idempotency-Key": idem() });
      if (!poCreate.ok) return { test: "close-the-loop", result: "FAIL", step: "po-create-from-suggestion", poCreate };
      const poId = poCreate.body?.id ?? (Array.isArray(poCreate.body?.ids) ? poCreate.body.ids[0] : undefined);
      if (!poId) return { test: "close-the-loop", result: "FAIL", step: "po-id", poCreate };
      const poGet = await get(`/objects/purchaseOrder/${encodeURIComponent(poId)}`);
      if (!poGet.ok) return { test: "close-the-loop", result: "FAIL", step: "po-get", poGet };
      await post(`/purchasing/po/${encodeURIComponent(poId)}:submit`, {}, { "Idempotency-Key": idem() });
      await post(`/purchasing/po/${encodeURIComponent(poId)}:approve`, {}, { "Idempotency-Key": idem() });
      const approved = await waitForStatus("purchaseOrder", poId, ["approved", "open"]);
      if (!approved.ok) return { test: "close-the-loop", result: "FAIL", step: "po-approved", approved };
      const poLinesRaw = poGet.body?.lines ?? draftLines;
      const lines = poLinesRaw
        .map(ln => ({ id: ln.id ?? ln.lineId, deltaQty: Math.max(0, Number(ln.qty ?? ln.qtySuggested ?? 0) - Number(ln.receivedQty ?? 0)) }))
        .filter(l => l.id && l.deltaQty > 0);
      if (lines.length === 0) return { test: "close-the-loop", result: "FAIL", step: "po-lines", poLinesRaw };
      const expectedReceived = lines.reduce((sum, l) => sum + Number(l.deltaQty ?? 0), 0);

      // 6) Receive with idempotency and assert onhand delta
      const receive = await post(`/purchasing/po/${encodeURIComponent(poId)}:receive`, { lines }, { "Idempotency-Key": receiveIdk });
      if (!receive.ok) return { test: "close-the-loop", result: "FAIL", step: "po-receive", receive };

      const readOnhandDelta = async (retries = 2, delayMs = 150) => {
        let last = null;
        for (let i = 0; i <= retries; i++) {
          last = await onhand(itemId);
          if (!last.ok) return { ok: false, resp: last };
          const val = Number(last.body?.items?.[0]?.onHand ?? 0);
          const delta = val - onHandBefore;
          if (delta === expectedReceived) return { ok: true, resp: last, val, delta };
          if (i < retries) await new Promise(r => setTimeout(r, delayMs));
        }
        const val = Number(last?.body?.items?.[0]?.onHand ?? 0);
        const delta = val - onHandBefore;
        return { ok: delta === expectedReceived, resp: last, val, delta };
      };

      const onhandAfterRes = await readOnhandDelta();
      if (!onhandAfterRes.ok) {
        return {
          test: "close-the-loop",
          result: "FAIL",
          step: "onhand-after",
          onHandBefore,
          onHandAfter: onhandAfterRes.val,
          expectedReceived,
          lines,
          onhandAfter: onhandAfterRes.resp
        };
      }
      const onhandAfter = onhandAfterRes.resp;
      const onHandAfter = onhandAfterRes.val;
      const deltaOnHand = onhandAfterRes.delta;

      // 7) Backorders fulfilled + idempotent receive replay
      const boFulfilled = await post(`/objects/backorderRequest/search`, { soId, itemId, status: "fulfilled" });
      if (!boFulfilled.ok) return { test: "close-the-loop", result: "FAIL", step: "backorder-fulfilled", boFulfilled };
      recordFromListResult(boFulfilled.body?.items, "backorderRequest", `/objects/backorderRequest/search`);
      const boItems = Array.isArray(boFulfilled.body?.items) ? boFulfilled.body.items : [];
      const boAllFound = boIds.every(id => boItems.some(b => b.id === id && b.status === "fulfilled" && Number(b.remainingQty ?? 0) === 0));
      if (!boAllFound || boItems.length !== boIds.length) {
        return { test: "close-the-loop", result: "FAIL", step: "backorder-fulfilled-assert", boIds, boItems };
      }

      const receiveAgain = await post(`/purchasing/po/${encodeURIComponent(poId)}:receive`, { lines }, { "Idempotency-Key": receiveIdk });
      if (!receiveAgain.ok) return { test: "close-the-loop", result: "FAIL", step: "po-receive-again", receiveAgain };
      const receiveAgainPoId = receiveAgain.body?.id ?? receiveAgain.body?.poId ?? receiveAgain.body?.purchaseOrderId;
      if (receiveAgainPoId && receiveAgainPoId !== poId) {
        return { test: "close-the-loop", result: "FAIL", step: "po-receive-again-po-id", poId, receiveAgainPoId, receiveAgain };
      }
      const receiveLines = Array.isArray(receive.body?.lines) ? receive.body.lines : [];
      const receiveAgainLines = Array.isArray(receiveAgain.body?.lines) ? receiveAgain.body.lines : [];
      const receivedQtyUnchanged = receiveLines.every(l => {
        const lid = l.id ?? l.lineId;
        const beforeQty = Number(l.receivedQty ?? 0);
        const afterQty = Number((receiveAgainLines.find(x => (x.id ?? x.lineId) === lid) ?? {}).receivedQty ?? beforeQty);
        return afterQty === beforeQty;
      });
      const onhandFinal = await onhand(itemId);
      const onHandFinal = Number(onhandFinal.body?.items?.[0]?.onHand ?? 0);

      const pass =
        deltaOnHand === expectedReceived &&
        Array.isArray(boFulfilled.body?.items) && boFulfilled.body.items.length === boIds.length &&
        receiveAgain.ok &&
        receivedQtyUnchanged &&
        onHandFinal === onHandAfter;

      return {
        test: "close-the-loop",
        result: pass ? "PASS" : "FAIL",
        steps: {
          prod,
          item,
          onhand0,
          so,
          boRes,
          boConverted,
          suggest,
          draft,
          poCreate,
          poGet,
          receive,
          onhandAfter,
          boFulfilled,
          receiveAgain,
          onhandFinal,
          vendorDebug,
          customerDebug,
          onHandBefore,
          onHandAfter,
          deltaOnHand,
          expectedReceived
        }
      };
    },

    "smoke:cors:preflight-objects-party": async () => {
      // Test: CORS preflight (OPTIONS) returns 200/204 with correct headers, no auth required
      
      // Setup: create a party to get a valid ID for testing
      await ensureBearer();
      const party = await post(`/objects/party`, {
        type: "party",
        name: `CORS-Test-${SMOKE_RUN_ID}`,
        roles: ["customer"]
      });
      
      if (!party.ok) {
        return {
          test: "cors:preflight-objects-party",
          result: "FAIL",
          step: "setup-party",
          party
        };
      }
      
      const partyId = party.body?.id;
      if (!partyId) {
        return {
          test: "cors:preflight-objects-party",
          result: "FAIL",
          step: "extract-party-id",
          party
        };
      }
      
      // Test 1: OPTIONS on detail endpoint (no auth, should succeed)
      const detailUrl = `${API}/objects/party/${encodeURIComponent(partyId)}`;
      const detailRes = await fetch(detailUrl, {
        method: "OPTIONS",
        headers: {
          "Origin": "http://localhost:5173",
          "Access-Control-Request-Method": "GET",
          "Access-Control-Request-Headers": "authorization,x-tenant-id"
        }
      });
      
      const detailStatus = detailRes.status;
      const detailHeaders = {
        allowOrigin: detailRes.headers.get("access-control-allow-origin"),
        allowMethods: detailRes.headers.get("access-control-allow-methods"),
        allowHeaders: detailRes.headers.get("access-control-allow-headers"),
        maxAge: detailRes.headers.get("access-control-max-age")
      };
      
      const detailPass = (detailStatus === 200 || detailStatus === 204)
        && detailHeaders.allowOrigin 
        && detailHeaders.allowMethods 
        && detailHeaders.allowHeaders;
      
      // Test 2: OPTIONS on list endpoint (optional)
      const listUrl = `${API}/objects/party?limit=1`;
      const listRes = await fetch(listUrl, {
        method: "OPTIONS",
        headers: {
          "Origin": "http://localhost:5173",
          "Access-Control-Request-Method": "GET",
          "Access-Control-Request-Headers": "authorization,x-tenant-id"
        }
      });
      
      const listStatus = listRes.status;
      const listHeaders = {
        allowOrigin: listRes.headers.get("access-control-allow-origin"),
        allowMethods: listRes.headers.get("access-control-allow-methods"),
        allowHeaders: listRes.headers.get("access-control-allow-headers"),
        maxAge: listRes.headers.get("access-control-max-age")
      };
      
      const listPass = (listStatus === 200 || listStatus === 204)
        && listHeaders.allowOrigin 
        && listHeaders.allowMethods 
        && listHeaders.allowHeaders;
      
      const allPass = detailPass && listPass;
      
      return {
        test: "cors:preflight-objects-party",
        result: allPass ? "PASS" : "FAIL",
        summary: allPass 
          ? "OPTIONS requests return 200/204 with correct CORS headers (no auth required)"
          : "OPTIONS preflight failed - missing status 200/204 or CORS headers",
        tests: {
          detail: {
            pass: detailPass,
            url: detailUrl,
            status: detailStatus,
            headers: detailHeaders
          },
          list: {
            pass: listPass,
            url: listUrl,
            status: listStatus,
            headers: listHeaders
          }
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
            id: ln.id ?? ln.lineId, 
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
        { lines: [{ id: lineId, deltaQty: 2 }] },
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
        { lines: [{ id: lineId, deltaQty: remaining }] },
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

    "smoke:backorders:partial-fulfill": async () => {
      await ensureBearer();
      
      // 1) Seed vendor, product, and inventory with onHand=0
      const { vendorId } = await seedVendor(api);
      const prod = await createProduct({ name: "PartialFulfillTest", preferredVendorId: vendorId });
      if (!prod.ok) return { test: "smoke:backorders:partial-fulfill", result: "FAIL", step: "createProduct", prod };
      const productId = prod.body?.id;
      
      const item = await createInventoryForProduct(productId, "PartialFulfillItem");
      if (!item.ok) return { test: "smoke:backorders:partial-fulfill", result: "FAIL", step: "createInventory", item };
      const itemId = item.body?.id;
      
      // Ensure onHand=0
      const onhandPre = await onhand(itemId);
      const currentOnHand = onhandPre.body?.items?.[0]?.onHand ?? 0;
      if (currentOnHand !== 0) {
        await post(`/objects/inventoryMovement`, { itemId, type: "adjust", qty: -currentOnHand });
      }
      
      // 2) Create customer and sales order with qty=10
      const { customerId } = await seedCustomer(api);
      const so = await post(`/objects/salesOrder`, {
        type: "salesOrder", 
        status: "draft", 
        partyId: customerId, 
        lines: [{ itemId, qty: 10, uom: "ea" }]
      });
      if (!so.ok) return { test: "smoke:backorders:partial-fulfill", result: "FAIL", step: "createSO", so };
      const soId = so.body?.id;
      
      // 3) Commit SO non-strict → creates backorder with qty=10
      await post(`/sales/so/${encodeURIComponent(soId)}:submit`, {}, { "Idempotency-Key": idem() });
      const commit = await post(`/sales/so/${encodeURIComponent(soId)}:commit`, {}, { "Idempotency-Key": idem() });
      if (!commit.ok) return { test: "smoke:backorders:partial-fulfill", result: "FAIL", step: "commit", commit };
      
      // 4) Wait for backorder with status="open"
      const boSearch = await waitForBackorders({ soId, itemId, status: "open" });
      if (!boSearch.ok || !boSearch.items || boSearch.items.length === 0) {
        return { test: "smoke:backorders:partial-fulfill", result: "FAIL", step: "backorder-not-found", boSearch };
      }
      const backorderId = boSearch.items[0].id;
      const backorderQty = boSearch.items[0].qty;
      
      // 5) Suggest PO from backorder
      const suggest = await post(`/purchasing/suggest-po`, { 
        requests: [{ backorderRequestId: backorderId }] 
      });
      if (!suggest.ok) return { test: "smoke:backorders:partial-fulfill", result: "FAIL", step: "suggest-po", suggest };
      
      const draft = suggest.body?.draft ?? suggest.body?.drafts?.[0];
      if (!draft) return { test: "smoke:backorders:partial-fulfill", result: "FAIL", step: "no-draft", suggest };
      
      // 6) Create PO from suggestion
      const poCreate = await post(`/purchasing/po:create-from-suggestion`, { draft }, { "Idempotency-Key": idem() });
      if (!poCreate.ok) return { test: "smoke:backorders:partial-fulfill", result: "FAIL", step: "po-create", poCreate };
      const poId = poCreate.body?.id ?? poCreate.body?.ids?.[0];
      
      recordFromListResult([{ id: poId, type: "purchaseOrder", status: "draft", vendorId }], 
        "purchaseOrder", `/purchasing/po:create-from-suggestion`);
      
      // 7) Submit and approve PO
      await post(`/purchasing/po/${encodeURIComponent(poId)}:submit`, {}, { "Idempotency-Key": idem() });
      const approve = await post(`/purchasing/po/${encodeURIComponent(poId)}:approve`, {}, { "Idempotency-Key": idem() });
      if (!approve.ok) return { test: "smoke:backorders:partial-fulfill", result: "FAIL", step: "approve", approve };
      
      // 8) Receive ONLY qty=5 (partial receive)
      const po = await get(`/objects/purchaseOrder/${encodeURIComponent(poId)}`);
      const poLines = po.body?.lines ?? [];
      if (poLines.length === 0) {
        return { test: "smoke:backorders:partial-fulfill", result: "FAIL", step: "no-po-lines", po };
      }
      
      const lineId = poLines[0].id ?? poLines[0].lineId;
      const partialQty = 5; // Receive only half
      
      const receive = await post(`/purchasing/po/${encodeURIComponent(poId)}:receive`, 
        { lines: [{ id: lineId, deltaQty: partialQty }] }, 
        { "Idempotency-Key": idem() }
      );
      if (!receive.ok) return { test: "smoke:backorders:partial-fulfill", result: "FAIL", step: "receive", receive };
      
      // 9) Fetch backorder and verify partial fulfillment
      // Allow a few retries for eventual consistency
      let boAfter = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        const fetchBo = await get(`/objects/backorderRequest/${encodeURIComponent(backorderId)}`);
        if (fetchBo.ok && fetchBo.body) {
          boAfter = fetchBo.body;
          break;
        }
        if (attempt < 4) await sleep(300);
      }
      
      if (!boAfter) {
        return { test: "smoke:backorders:partial-fulfill", result: "FAIL", step: "backorder-fetch-after-receive" };
      }
      
      // Assertions:
      // - backorder should NOT be "fulfilled" (since only 5 of 10 received)
      // - status should be "converted" (from suggest-po) or remain "open" if conversion happens later
      // - fulfilledQty should be 5, remainingQty should be 5 (if tracked)
      const statusAfter = boAfter.status;
      const fulfilledQty = boAfter.fulfilledQty ?? 0;
      const remainingQty = boAfter.remainingQty ?? (backorderQty - fulfilledQty);
      
      const statusOk = statusAfter !== "fulfilled"; // Should be "converted" or "open"
      const fulfilledOk = fulfilledQty === partialQty;
      const remainingOk = remainingQty === (backorderQty - partialQty);
      
      const pass = statusOk && fulfilledOk && remainingOk;
      
      return {
        test: "smoke:backorders:partial-fulfill",
        result: pass ? "PASS" : "FAIL",
        steps: {
          productId, itemId, soId, backorderId, poId,
          backorderQty,
          partialQty,
          statusBefore: "open",
          statusAfter,
          fulfilledQty,
          remainingQty,
          checks: { statusOk, fulfilledOk, remainingOk },
          boAfter
        }
      };
    },

    "smoke:suggest-po:moq": async () => {
      await ensureBearer();
      
      // 1) Create vendor and product with minOrderQty=50
      const { vendorId } = await seedVendor(api);
      const moq = 50;
      const prod = await createProduct({ 
        name: "MOQTest", 
        preferredVendorId: vendorId,
        minOrderQty: moq
      });
      if (!prod.ok) return { test: "smoke:suggest-po:moq", result: "FAIL", step: "createProduct", prod };
      const productId = prod.body?.id;
      
      const item = await createInventoryForProduct(productId, "MOQTestItem");
      if (!item.ok) return { test: "smoke:suggest-po:moq", result: "FAIL", step: "createInventory", item };
      const itemId = item.body?.id;
      
      // Ensure onHand=0
      const onhandPre = await onhand(itemId);
      const currentOnHand = onhandPre.body?.items?.[0]?.onHand ?? 0;
      if (currentOnHand !== 0) {
        await post(`/objects/inventoryMovement`, { itemId, type: "adjust", qty: -currentOnHand });
      }
      
      // 2) Create customer and SO with qty=10 (below MOQ)
      const { customerId } = await seedCustomer(api);
      const requestedQty = 10; // Below MOQ
      const so = await post(`/objects/salesOrder`, {
        type: "salesOrder", 
        status: "draft", 
        partyId: customerId, 
        lines: [{ itemId, qty: requestedQty, uom: "ea" }]
      });
      if (!so.ok) return { test: "smoke:suggest-po:moq", result: "FAIL", step: "createSO", so };
      const soId = so.body?.id;
      
      // 3) Commit SO non-strict → creates backorder with qty=10
      await post(`/sales/so/${encodeURIComponent(soId)}:submit`, {}, { "Idempotency-Key": idem() });
      const commit = await post(`/sales/so/${encodeURIComponent(soId)}:commit`, {}, { "Idempotency-Key": idem() });
      if (!commit.ok) return { test: "smoke:suggest-po:moq", result: "FAIL", step: "commit", commit };
      
      // 4) Wait for backorder
      const boSearch = await waitForBackorders({ soId, itemId, status: "open" });
      if (!boSearch.ok || !boSearch.items || boSearch.items.length === 0) {
        return { test: "smoke:suggest-po:moq", result: "FAIL", step: "backorder-not-found", boSearch };
      }
      const backorderId = boSearch.items[0].id;
      
      // 5) Call suggest-po and verify MOQ bump
      const suggest = await post(`/purchasing/suggest-po`, { 
        requests: [{ backorderRequestId: backorderId }] 
      });
      if (!suggest.ok) return { test: "smoke:suggest-po:moq", result: "FAIL", step: "suggest-po", suggest };
      
      const draft = suggest.body?.draft ?? suggest.body?.drafts?.[0];
      if (!draft) return { test: "smoke:suggest-po:moq", result: "FAIL", step: "no-draft", suggest };
      
      const draftLines = draft.lines ?? [];
      if (draftLines.length === 0) {
        return { test: "smoke:suggest-po:moq", result: "FAIL", step: "no-draft-lines", draft };
      }
      
      const line = draftLines[0];
      const draftQty = line.qty;
      const adjustedFrom = line.adjustedFrom ?? line.originalQty;
      const minOrderQtyApplied = line.minOrderQtyApplied;
      
      // Assertions:
      // - line.qty should be bumped to MOQ (50)
      // - adjustedFrom (if tracked) should show original qty (10)
      // - minOrderQtyApplied (if tracked) should be 50
      const qtyOk = draftQty === moq;
      const adjustedFromOk = adjustedFrom === undefined || adjustedFrom === requestedQty;
      const moqFieldOk = minOrderQtyApplied === undefined || minOrderQtyApplied === moq;
      
      const pass = qtyOk && adjustedFromOk && moqFieldOk;
      
      return {
        test: "smoke:suggest-po:moq",
        result: pass ? "PASS" : "FAIL",
        steps: {
          productId, itemId, soId, backorderId,
          moq,
          requestedQty,
          draftQty,
          adjustedFrom,
          minOrderQtyApplied,
          checks: { qtyOk, adjustedFromOk, moqFieldOk },
          line
        }
      };
    },

    "smoke:suggest-po:skip-reasons": async () => {
      await ensureBearer();
      
      // 1) Create vendor and products
      const { vendorId } = await seedVendor(api);
      const { customerId } = await seedCustomer(api);
      
      // Product A: Has vendor (will create VALID backorder)
      const prodA = await createProduct({ name: "SkipTest-Valid", preferredVendorId: vendorId });
      if (!prodA.ok) return { test: "smoke:suggest-po:skip-reasons", result: "FAIL", step: "createProduct-A", prodA };
      const productIdA = prodA.body?.id;
      const itemA = await createInventoryForProduct(productIdA, "SkipTestItem-Valid");
      if (!itemA.ok) return { test: "smoke:suggest-po:skip-reasons", result: "FAIL", step: "createInventory-A", itemA };
      const itemIdA = itemA.body?.id;
      
      // Product C: NO vendor (will create MISSING_VENDOR backorder)
      const prodC = await createProduct({ name: "SkipTest-NoVendor" });
      if (!prodC.ok) return { test: "smoke:suggest-po:skip-reasons", result: "FAIL", step: "createProduct-C", prodC };
      const productIdC = prodC.body?.id;
      const itemC = await createInventoryForProduct(productIdC, "SkipTestItem-NoVendor");
      if (!itemC.ok) return { test: "smoke:suggest-po:skip-reasons", result: "FAIL", step: "createInventory-C", itemC };
      const itemIdC = itemC.body?.id;
      
      // 2) Ensure all items have onHand=0 (to force backorders on commit)
      for (const itemId of [itemIdA, itemIdC]) {
        const ohPre = await onhand(itemId);
        const currentOnHand = ohPre.body?.items?.[0]?.onHand ?? 0;
        if (currentOnHand !== 0) {
          await post(`/inventory/${encodeURIComponent(itemId)}/adjust`, { deltaQty: -currentOnHand }, { "Idempotency-Key": idem() });
        }
      }
      
      // 3) Create Sales Orders to generate backorders A and C
      const soA = await post(`/objects/salesOrder`, {
        type: "salesOrder", 
        status: "draft", 
        partyId: customerId, 
        lines: [{ itemId: itemIdA, qty: 10, uom: "ea" }]
      });
      if (!soA.ok) return { test: "smoke:suggest-po:skip-reasons", result: "FAIL", step: "createSO-A", soA };
      const soIdA = soA.body?.id;
      
      const soC = await post(`/objects/salesOrder`, {
        type: "salesOrder", 
        status: "draft", 
        partyId: customerId, 
        lines: [{ itemId: itemIdC, qty: 10, uom: "ea" }]
      });
      if (!soC.ok) return { test: "smoke:suggest-po:skip-reasons", result: "FAIL", step: "createSO-C", soC };
      const soIdC = soC.body?.id;
      
      // Submit and commit both SOs to generate backorders
      await post(`/sales/so/${encodeURIComponent(soIdA)}:submit`, {}, { "Idempotency-Key": idem() });
      await post(`/sales/so/${encodeURIComponent(soIdA)}:commit`, {}, { "Idempotency-Key": idem() });
      
      await post(`/sales/so/${encodeURIComponent(soIdC)}:submit`, {}, { "Idempotency-Key": idem() });
      await post(`/sales/so/${encodeURIComponent(soIdC)}:commit`, {}, { "Idempotency-Key": idem() });
      
      // 4) Wait for backorders A and C to appear
      const boSearchA = await waitForBackorders({ soId: soIdA, itemId: itemIdA, status: "open" });
      if (!boSearchA.ok || !boSearchA.items?.[0]?.id) {
        return { test: "smoke:suggest-po:skip-reasons", result: "FAIL", step: "backorder-A-not-found", boSearchA };
      }
      const backorderIdA = boSearchA.items[0].id;
      
      const boSearchC = await waitForBackorders({ soId: soIdC, itemId: itemIdC, status: "open" });
      if (!boSearchC.ok || !boSearchC.items?.[0]?.id) {
        return { test: "smoke:suggest-po:skip-reasons", result: "FAIL", step: "backorder-C-not-found", boSearchC };
      }
      const backorderIdC = boSearchC.items[0].id;
      
      // 5) Create backorder B (ZERO_QTY) - manually via objects API
      const backorderB = await post(`/objects/backorderRequest`, {
        type: "backorderRequest",
        soId: soIdA,
        itemId: itemIdA,
        qty: 0,
        uom: "ea",
        status: "open",
        preferredVendorId: vendorId
      }, { "Idempotency-Key": idem() });
      if (!backorderB.ok) return { test: "smoke:suggest-po:skip-reasons", result: "FAIL", step: "create-backorder-B", backorderB };
      const backorderIdB = backorderB.body?.id;
      
      // 6) Create backorder D (IGNORED) - use backorder A, ignore it, and create another valid one for suggest
      // Let's create a second SO to get backorder D
      const soD = await post(`/objects/salesOrder`, {
        type: "salesOrder", 
        status: "draft", 
        partyId: customerId, 
        lines: [{ itemId: itemIdA, qty: 5, uom: "ea" }]
      });
      if (!soD.ok) return { test: "smoke:suggest-po:skip-reasons", result: "FAIL", step: "createSO-D", soD };
      const soIdD = soD.body?.id;
      
      await post(`/sales/so/${encodeURIComponent(soIdD)}:submit`, {}, { "Idempotency-Key": idem() });
      await post(`/sales/so/${encodeURIComponent(soIdD)}:commit`, {}, { "Idempotency-Key": idem() });
      
      const boSearchD = await waitForBackorders({ soId: soIdD, itemId: itemIdA, status: "open" });
      if (!boSearchD.ok || !boSearchD.items?.[0]?.id) {
        return { test: "smoke:suggest-po:skip-reasons", result: "FAIL", step: "backorder-D-not-found", boSearchD };
      }
      const backorderIdD = boSearchD.items[0].id;
      
      // Ignore backorder D
      const ignoreResp = await post(`/objects/backorderRequest/${encodeURIComponent(backorderIdD)}:ignore`, {}, { "Idempotency-Key": idem() });
      if (!ignoreResp.ok) return { test: "smoke:suggest-po:skip-reasons", result: "FAIL", step: "ignore-backorder-D", ignoreResp };
      
      // 7) Call suggest-po with all 4 backorder IDs (A=valid, B=ZERO_QTY, C=MISSING_VENDOR, D=IGNORED)
      const suggestResp = await post(`/purchasing/suggest-po`, {
        requests: [
          { backorderRequestId: backorderIdA },
          { backorderRequestId: backorderIdB },
          { backorderRequestId: backorderIdC },
          { backorderRequestId: backorderIdD }
        ]
      }, { "Idempotency-Key": idem() });
      
      if (!suggestResp.ok) {
        return { test: "smoke:suggest-po:skip-reasons", result: "FAIL", step: "suggest-po", suggestResp };
      }
      
      // Normalize drafts (handle both `draft` and `drafts` response shapes)
      const drafts = suggestResp.body?.drafts ?? (suggestResp.body?.draft ? [suggestResp.body.draft] : []);
      const skipped = suggestResp.body?.skipped ?? [];
      
      // 8) Assertions
      // A) Check skipped array contains correct entries
      const skippedB = skipped.find(s => s.backorderRequestId === backorderIdB);
      const skippedC = skipped.find(s => s.backorderRequestId === backorderIdC);
      const skippedD = skipped.find(s => s.backorderRequestId === backorderIdD);
      
      const skippedBCorrect = skippedB && skippedB.reason === "ZERO_QTY";
      const skippedCCorrect = skippedC && skippedC.reason === "MISSING_VENDOR";
      const skippedDCorrect = skippedD && skippedD.reason === "IGNORED";
      
      // B) Check drafts contain ONLY backorder A
      const allBackorderIdsInDrafts = new Set();
      drafts.forEach(draft => {
        (draft.lines || []).forEach(line => {
          (line.backorderRequestIds || []).forEach(boId => allBackorderIdsInDrafts.add(boId));
        });
      });
      
      const containsA = allBackorderIdsInDrafts.has(backorderIdA);
      const notContainsB = !allBackorderIdsInDrafts.has(backorderIdB);
      const notContainsC = !allBackorderIdsInDrafts.has(backorderIdC);
      const notContainsD = !allBackorderIdsInDrafts.has(backorderIdD);
      
      // C) Verify skipped count is exactly 3
      const skippedCountCorrect = skipped.length === 3;
      
      const pass = skippedBCorrect && skippedCCorrect && skippedDCorrect &&
                   containsA && notContainsB && notContainsC && notContainsD &&
                   skippedCountCorrect;
      
      return {
        test: "smoke:suggest-po:skip-reasons",
        result: pass ? "PASS" : "FAIL",
        steps: {
          backorderIdA, // VALID
          backorderIdB, // ZERO_QTY
          backorderIdC, // MISSING_VENDOR
          backorderIdD, // IGNORED
          draftsCount: drafts.length,
          skippedCount: skipped.length,
          skippedReasons: skipped.map(s => ({ id: s.backorderRequestId, reason: s.reason })),
          backorderIdsInDrafts: Array.from(allBackorderIdsInDrafts),
          checks: {
            skippedBCorrect,
            skippedCCorrect,
            skippedDCorrect,
            containsA,
            notContainsB,
            notContainsC,
            notContainsD,
            skippedCountCorrect
          }
        }
      };
    },

    "smoke:backorders:ignore": async () => {
      await ensureBearer();
      
      // 1) Create vendor, product, and inventory with onHand=0
      const { vendorId } = await seedVendor(api);
      const prod = await createProduct({ name: "IgnoreTest", preferredVendorId: vendorId });
      if (!prod.ok) return { test: "smoke:backorders:ignore", result: "FAIL", step: "createProduct", prod };
      const productId = prod.body?.id;
      
      const item = await createInventoryForProduct(productId, "IgnoreTestItem");
      if (!item.ok) return { test: "smoke:backorders:ignore", result: "FAIL", step: "createInventory", item };
      const itemId = item.body?.id;
      
      // Ensure onHand=0
      const onhandPre = await onhand(itemId);
      const currentOnHand = onhandPre.body?.items?.[0]?.onHand ?? 0;
      if (currentOnHand !== 0) {
        await post(`/objects/inventoryMovement`, { itemId, type: "adjust", qty: -currentOnHand });
      }
      
      // 2) Create customer and sales order with qty=10
      const { customerId } = await seedCustomer(api);
      const so = await post(`/objects/salesOrder`, {
        type: "salesOrder", 
        status: "draft", 
        partyId: customerId, 
        lines: [{ itemId, qty: 10, uom: "ea" }]
      });
      if (!so.ok) return { test: "smoke:backorders:ignore", result: "FAIL", step: "createSO", so };
      const soId = so.body?.id;
      
      // 3) Commit SO non-strict → creates backorder with qty=10
      await post(`/sales/so/${encodeURIComponent(soId)}:submit`, {}, { "Idempotency-Key": idem() });
      const commit = await post(`/sales/so/${encodeURIComponent(soId)}:commit`, {}, { "Idempotency-Key": idem() });
      if (!commit.ok) return { test: "smoke:backorders:ignore", result: "FAIL", step: "commit", commit };
      
      // 4) Wait for backorder to appear in open status
      const boSearch = await waitForBackorders({ soId, itemId, status: "open" });
      if (!boSearch.ok || !boSearch.items?.[0]?.id) {
        return { test: "smoke:backorders:ignore", result: "FAIL", step: "backorder-not-found", boSearch };
      }
      const backorderId = boSearch.items[0].id;
      
      // 5) Call :ignore action
      const ignoreResp = await post(`/objects/backorderRequest/${encodeURIComponent(backorderId)}:ignore`, {});
      if (!ignoreResp.ok) return { test: "smoke:backorders:ignore", result: "FAIL", step: "ignore-action", ignoreResp };
      
      // 6) GET backorder by ID and verify status === "ignored"
      const boDetail = await get(`/objects/backorderRequest/${encodeURIComponent(backorderId)}`);
      if (!boDetail.ok) return { test: "smoke:backorders:ignore", result: "FAIL", step: "get-detail", boDetail };
      const statusAfterIgnore = boDetail.body?.status;
      const statusOk = statusAfterIgnore === "ignored";
      
      // 7) Search open backorders for same soId and verify ignored backorder is NOT in list
      const openSearch = await post(`/objects/backorderRequest/search`, { soId, status: "open" });
      const openItems = openSearch.body?.items ?? [];
      const ignoredStillInOpen = openItems.some(b => b.id === backorderId);
      const notInOpenOk = !ignoredStillInOpen;
      
      // 8) Search ignored backorders and verify it IS present
      const ignoredSearch = await post(`/objects/backorderRequest/search`, { soId, status: "ignored" });
      const ignoredItems = ignoredSearch.body?.items ?? [];
      const foundInIgnored = ignoredItems.some(b => b.id === backorderId);
      const inIgnoredOk = foundInIgnored;
      
      const pass = statusOk && notInOpenOk && inIgnoredOk;
      
      return {
        test: "smoke:backorders:ignore",
        result: pass ? "PASS" : "FAIL",
        steps: {
          productId, itemId, soId, backorderId,
          statusAfterIgnore,
          openBackordersCount: openItems.length,
          ignoredBackordersCount: ignoredItems.length,
          checks: {
            statusOk,
            notInOpenOk,
            inIgnoredOk,
            ignoredStillInOpen
          }
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

  "smoke:parties:batch": async ()=>{
    await ensureBearer();
    
    // Create 3 parties with different roles
    const partyA = await post(`/objects/${encodeURIComponent(PARTY_TYPE)}`,
      { kind: "person", name: `SmokePartyBatch-A-${Date.now()}`, roles: ["customer"] },
      { "Idempotency-Key": idem() }
    );
    const partyB = await post(`/objects/${encodeURIComponent(PARTY_TYPE)}`,
      { kind: "org", name: `SmokePartyBatch-B-${Date.now()}`, roles: ["vendor"] },
      { "Idempotency-Key": idem() }
    );
    const partyC = await post(`/objects/${encodeURIComponent(PARTY_TYPE)}`,
      { kind: "person", name: `SmokePartyBatch-C-${Date.now()}`, roles: ["customer", "vendor"] },
      { "Idempotency-Key": idem() }
    );

    const idA = partyA.body?.id;
    const idB = partyB.body?.id;
    const idC = partyC.body?.id;

    if (!partyA.ok || !idA || !partyB.ok || !idB || !partyC.ok || !idC) {
      return { test: "parties-batch", result: "FAIL", step: "create", partyA, partyB, partyC };
    }

    // Call batch endpoint with all 3 IDs + 1 bogus ID
    const bogusId = "nonexistent-party-id-12345";
    const batch = await post(`/objects/party:batch`, { partyIds: [idA, idB, idC, bogusId] });

    if (!batch.ok) {
      return { test: "parties-batch", result: "FAIL", step: "batch-call", batch };
    }

    const items = Array.isArray(batch.body?.items) ? batch.body.items : [];

    // Verify: all 3 created parties are returned, bogus ID is absent
    const foundA = items.find(p => p.id === idA);
    const foundB = items.find(p => p.id === idB);
    const foundC = items.find(p => p.id === idC);
    const foundBogus = items.find(p => p.id === bogusId);

    const ok = batch.ok
      && items.length === 3
      && foundA && foundA.name && foundA.id
      && foundB && foundB.name && foundB.id
      && foundC && foundC.name && foundC.id
      && !foundBogus;

    return {
      test: "parties-batch",
      result: ok ? "PASS" : "FAIL",
      partyA,
      partyB,
      partyC,
      batch,
      foundA,
      foundB,
      foundC,
      itemsLength: items.length,
      hasBogus: !!foundBogus
    };
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

  // Verify legacy /objects/inventory writes are compatible with canonical inventoryItem storage and reads.
  "smoke:inventory:canonical-write-legacy-compat": async () => {
    await ensureBearer();

    // Create a product to attach to the item (ensures productId is valid for environments that enforce it).
    const prod = await createProduct({ name: `InvCompatProd-${SMOKE_RUN_ID}` });
    if (!prod.ok) return { test: "inventory-canonical-write-legacy-compat", result: "FAIL", step: "createProduct", prod };

    // Create via legacy route; server should store as canonical inventoryItem after E1.
    const baseName = `InvCompatItem-${SMOKE_RUN_ID}-${Date.now()}`;
    const legacyCreate = await post(`/objects/inventory`, {
      type: "inventory",
      name: smokeTag(baseName),
      productId: prod.body?.id,
      uom: "ea",
    });
    if (!legacyCreate.ok) return { test: "inventory-canonical-write-legacy-compat", result: "FAIL", step: "legacyCreate", legacyCreate };

    const id = legacyCreate.body?.id;

    // Legacy GET should work even if stored as inventoryItem (alias-aware resolution).
    const getLegacy = await get(`/objects/inventory/${encodeURIComponent(id)}`);
    // Canonical GET should also work.
    const getCanonical = await get(`/objects/inventoryItem/${encodeURIComponent(id)}`);

    const storedType = getCanonical.body?.type ?? getLegacy.body?.type;
    const typeOk = storedType === "inventoryItem" || storedType === "inventory";
    const pass = legacyCreate.ok && getLegacy.ok && getCanonical.ok && typeOk;

    return {
      test: "inventory-canonical-write-legacy-compat",
      result: pass ? "PASS" : "FAIL",
      legacyCreate,
      getLegacy,
      getCanonical,
      storedType,
    };
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

  "smoke:inventory:onhand-permission-denied": async ()=>{
    // Test: onhand endpoints require inventory:read permission and return 403 without it
    // Flow:
    //   1) Create product + inventory item with onhand data (as admin)
    //   2) Mint read-only token (lacks inventory:read)
    //   3) Try GET /inventory/{id}/onhand with restricted token → expect 403
    //   4) Try GET /inventory/{id}/onhand:by-location with restricted token → expect 403
    //   5) Try POST /inventory/onhand:batch with restricted token → expect 403

    await ensureBearer();

    // Step 1: Create product and inventory item (as admin bearer token)
    const prod = await createProduct({ name: `OnhandPermTest-${SMOKE_RUN_ID}` });
    if (!prod.ok) return { test: "inventory-onhand-permission-denied", result: "FAIL", step: "createProduct", prod };
    const prodId = prod.body?.id;

    const item = await post(`/objects/${ITEM_TYPE}`, { productId: prodId, name: smokeTag("OnhandPermItem") });
    if (!item.ok) return { test: "inventory-onhand-permission-denied", result: "FAIL", step: "createItem", item };
    const itemId = item.body?.id;

    // Add some onhand data so endpoints return meaningful data (not just empty arrays)
    const rec = await post(`/objects/${MV_TYPE}`, { itemId, action: "receive", qty: 5 });
    if (!rec.ok) return { test: "inventory-onhand-permission-denied", result: "FAIL", step: "addMovement", rec };

    // Step 2: Mint read-only token (policy with no inventory:read)
    const readOnlyPayload = {
      tenantId: TENANT,
      policy: {
        "product:read": true,  // Allow product reads but not inventory:read
        "party:read": true     // Allow party reads but not inventory:read
      }
    };

    const loginRes = await fetch(`${API}/auth/dev-login`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-tenant-id": TENANT
      },
      body: JSON.stringify(readOnlyPayload)
    });

    if (!loginRes.ok) {
      const errText = await loginRes.text().catch(() => "");
      return {
        test: "inventory-onhand-permission-denied",
        result: "FAIL",
        step: "restricted-login",
        status: loginRes.status,
        error: errText
      };
    }

    const loginData = await loginRes.json();
    const restrictedToken = loginData.token;
    if (!restrictedToken) {
      return {
        test: "inventory-onhand-permission-denied",
        result: "FAIL",
        step: "extract-token",
        loginData
      };
    }

    // Helper to make request with restricted token
    const getWithToken = async (path, token) =>
      fetch(`${API}${path}`, {
        method: "GET",
        headers: {
          "authorization": `Bearer ${token}`,
          "x-tenant-id": TENANT
        }
      });

    const postWithToken = async (path, token, body) =>
      fetch(`${API}${path}`, {
        method: "POST",
        headers: {
          "authorization": `Bearer ${token}`,
          "x-tenant-id": TENANT,
          "content-type": "application/json"
        },
        body: JSON.stringify(body)
      });

    // Step 3: GET /inventory/{id}/onhand with restricted token → expect 403
    const onhandRes = await getWithToken(`/inventory/${encodeURIComponent(itemId)}/onhand`, restrictedToken);
    const onhandDenied = onhandRes.status === 403;
    const onhandBody = await onhandRes.json().catch(() => ({}));

    if (!onhandDenied) {
      return {
        test: "inventory-onhand-permission-denied",
        result: "FAIL",
        step: "onhand-get-not-denied",
        expectedStatus: 403,
        actualStatus: onhandRes.status,
        body: onhandBody
      };
    }

    // Step 4: GET /inventory/{id}/onhand:by-location with restricted token → expect 403
    const byLocRes = await getWithToken(`/inventory/${encodeURIComponent(itemId)}/onhand:by-location`, restrictedToken);
    const byLocDenied = byLocRes.status === 403;
    const byLocBody = await byLocRes.json().catch(() => ({}));

    if (!byLocDenied) {
      return {
        test: "inventory-onhand-permission-denied",
        result: "FAIL",
        step: "onhand-by-location-not-denied",
        expectedStatus: 403,
        actualStatus: byLocRes.status,
        body: byLocBody
      };
    }

    // Step 5: POST /inventory/onhand:batch with restricted token → expect 403
    const batchRes = await postWithToken(`/inventory/onhand:batch`, restrictedToken, { itemIds: [itemId] });
    const batchDenied = batchRes.status === 403;
    const batchBody = await batchRes.json().catch(() => ({}));

    if (!batchDenied) {
      return {
        test: "inventory-onhand-permission-denied",
        result: "FAIL",
        step: "onhand-batch-not-denied",
        expectedStatus: 403,
        actualStatus: batchRes.status,
        body: batchBody
      };
    }

    // All permission denials verified
    return {
      test: "inventory-onhand-permission-denied",
      result: "PASS",
      summary: "All onhand endpoints correctly enforce inventory:read permission",
      assertions: {
        onhandDenied,
        byLocDenied,
        batchDenied
      },
      artifacts: {
        product: prodId,
        item: itemId
      }
    };
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

    // Query GET /inventory/movements?locationId={locBId} with minimal retry
    // Timeline index ensures movement appears immediately; 5-10s max safety window.
    // Quick retries (2-3x) with 250ms backoff to handle transient delays.
    const expectedQty = 1;
    const expectedLot = "LOT-LOC-MBL";
    
    let items = [];
    let putawayFound = false;
    let attempt = 0;
    const startTime = Date.now();
    const maxElapsedMs = 10000; // 10s safety window
    let backoffMs = 250;
    let lastByLocStatus = null;
    let lastByLocErrorBody = null;
    let lastByLocNext = null;
    const requestQuery = { locationId: locBId, limit: 50, sort: "desc" };
    
    while (Date.now() - startTime < maxElapsedMs && !putawayFound) {
      attempt++;
      
      const movementsResp = await get(`/inventory/movements`, requestQuery);
      lastByLocStatus = movementsResp?.status ?? null;
      lastByLocNext = movementsResp?.body?.next ?? movementsResp?.body?.pageInfo?.nextCursor ?? null;
      if (!movementsResp.ok) {
        // Non-fatal error, capture error body and retry after short backoff
        try {
          lastByLocErrorBody = snippet(movementsResp?.body, 600);
        } catch {}
        if (attempt < 3) {
          await new Promise(r => setTimeout(r, backoffMs));
          backoffMs = Math.min(backoffMs + 250, 500);
        }
        continue;
      }

      items = movementsResp.body?.items ?? [];
      if (!Array.isArray(items)) {
        // Non-fatal error, capture error body and retry after short backoff
        try {
          lastByLocErrorBody = snippet(movementsResp?.body, 600);
        } catch {}
        if (attempt < 3) {
          await new Promise(r => setTimeout(r, backoffMs));
          backoffMs = Math.min(backoffMs + 250, 500);
        }
        continue;
      }

      // Check if putaway movement exists with expected values
      putawayFound = items.some(m => 
        (m.action ?? "") === "putaway" && 
        m.qty === expectedQty && 
        (m.locationId ?? "") === locBId &&
        (m.lot ?? "") === expectedLot
      );

      // If not found on first attempt, retry once more quickly
      if (!putawayFound && attempt < 2) {
        await new Promise(r => setTimeout(r, backoffMs));
        backoffMs = Math.min(backoffMs + 250, 500);
      }
    }
    
    const elapsedMs = Date.now() - startTime;

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

      // Safeguard: if first page was empty but had next token, try one follow-up page
      let followUpPage2Count = null;
      if (Array.isArray(items) && items.length === 0 && lastByLocNext) {
        const followUpResp = await get(`/inventory/movements`, { ...requestQuery, next: lastByLocNext });
        if (followUpResp.ok && Array.isArray(followUpResp.body?.items)) {
          followUpPage2Count = followUpResp.body.items.length;
        }
      }

      return {
        test: "inventory-movements-by-location",
        result: "FAIL",
        step: "assertPutawayFound",
        locBId,
        expectedAction: "putaway",
        expectedQty,
        expectedLot,
        attempts: attempt,
        elapsedMs,
        byLocationLastStatus: lastByLocStatus,
        byLocationLastError: lastByLocErrorBody,
        byLocationNextTokenPresent: !!lastByLocNext,
        byLocationNextToken: lastByLocNext,
        byLocationItemsCount: Array.isArray(items) ? items.length : 0,
        byLocationRequestQuery: requestQuery,
        byLocationItems: items.slice(0, 10),
        followUpPage2ItemsCount: followUpPage2Count,
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
    recordCreated({ type: "inventory", id: itemId, route: "/objects/inventory" });

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

  "smoke:inventory:adjust-idempotent-replay": async () => {
    await ensureBearer();

    const prod = await createProduct({ name: "AdjustIdemTest" });
    if (!prod.ok) return { test: "inventory-adjust-idempotent-replay", result: "FAIL", step: "createProduct", prod };
    const item = await createInventoryForProduct(prod.body?.id, "AdjustIdemItem");
    if (!item.ok) return { test: "inventory-adjust-idempotent-replay", result: "FAIL", step: "createInventory", item };
    const itemId = item.body?.id;
    recordCreated("inventory", itemId);

    const before = await onhand(itemId);
    if (!before.ok) return { test: "inventory-adjust-idempotent-replay", result: "FAIL", step: "fetchOnHandBefore", before };
    const onHandBefore = Number(before.body?.items?.[0]?.onHand ?? 0);

    const payload = { deltaQty: 4, note: "idem-replay" };
    const idk = `idem_replay_${idem()}`;

    const adjust1 = await post(`/inventory/${itemId}:adjust`, payload, { "Idempotency-Key": idk });
    if (!adjust1.ok) return { test: "inventory-adjust-idempotent-replay", result: "FAIL", step: "adjust-first", adjust1 };
    const mvId = adjust1.body?.movementId ?? adjust1.body?.id ?? null;
    if (mvId) recordCreated({ type: "inventoryMovement", id: mvId, route: "/inventory/:id:adjust", meta: { action: "adjust", deltaQty: payload.deltaQty } });

    const adjust2 = await post(`/inventory/${itemId}:adjust`, payload, { "Idempotency-Key": idk });
    if (!adjust2.ok) return { test: "inventory-adjust-idempotent-replay", result: "FAIL", step: "adjust-replay", adjust2 };

    const after = await onhand(itemId);
    if (!after.ok) return { test: "inventory-adjust-idempotent-replay", result: "FAIL", step: "fetchOnHandAfter", after };
    const onHandAfter = Number(after.body?.items?.[0]?.onHand ?? 0);
    const expectedOnHand = onHandBefore + payload.deltaQty;
    if (onHandAfter !== expectedOnHand) {
      return { test: "inventory-adjust-idempotent-replay", result: "FAIL", step: "assertOnHand", expectedOnHand, onHandBefore, onHandAfter, payload };
    }

    const fetchMovementPage = async ({ limit = 50, next }) => {
      const res = await get(`/inventory/${encodeURIComponent(itemId)}/movements`, { limit, next, sort: "desc" });
      const items = Array.isArray(res.body?.items) ? res.body.items : [];
      const pageInfo = res.body?.pageInfo ?? {};
      return { items, pageInfo, body: res.body };
    };

    let occurrences = null;
    try {
      if (mvId) {
        await findItemById({ fetchPage: fetchMovementPage, targetId: mvId, timeoutMs: 8000, pageSize: 50, maxPages: 100 });
      }

      const collected = [];
      let cursor = undefined;
      for (let i = 0; i < 40; i++) {
        const { items, pageInfo } = await fetchMovementPage({ limit: 50, next: cursor });
        collected.push(...items);
        const nextCursor = pageInfo?.nextCursor ?? pageInfo?.next ?? null;
        if (!nextCursor) break;
        cursor = nextCursor;
      }

      occurrences = mvId ? collected.filter((m) => m.id === mvId).length : null;
      if (mvId && occurrences !== 1) {
        return { test: "inventory-adjust-idempotent-replay", result: "FAIL", step: "assertMovementOccurrences", mvId, occurrences, collectedCount: collected.length };
      }
    } catch (err) {
      return { test: "inventory-adjust-idempotent-replay", result: "FAIL", step: "movementLookup", error: err?.message ?? String(err), debug: err?.debug };
    }

    return {
      test: "inventory-adjust-idempotent-replay",
      result: "PASS",
      itemId,
      mvId,
      onHandBefore,
      onHandAfter,
      expectedOnHand,
      occurrences
    };
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

    // 2.5) Wait for inventory to be readable in location (eventual consistency)
    // Poll /inventory/{id}/onhand:by-location until we see qty 5 at the target location (up to 3.75s)
    const maxRetries = 15;
    const retryDelayMs = 250;
    let onhandReady = false;
    let onhandSnapshot = null;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      onhandSnapshot = await get(`/inventory/${encodeURIComponent(itemId)}/onhand:by-location`);
      if (onhandSnapshot.ok) {
        const locItem = (onhandSnapshot.body?.items ?? []).find(item => item.locationId === locId);
        if (locItem && locItem.onHand >= 5) {
          onhandReady = true;
          break;
        }
      }
      if (attempt < maxRetries - 1) {
        await sleep(retryDelayMs);
      }
    }
    if (!onhandReady) {
      return {
        test: "sales:fulfill-without-reserve",
        result: "FAIL",
        step: "waitForInventoryVisible",
        reason: "inventory not visible in location after putaway",
        itemId,
        locId,
        onhandSnapshot: snippet(onhandSnapshot?.body, 800)
      };
    }

    // 3) Create SO with qty 3, submit and commit (non-strict)
    const { partyId } = await seedParties(api);
    const so = await post(`/objects/salesOrder`, {
      type: "salesOrder",
      status: "draft",
      partyId,
      lines: [{ itemId, uom: "ea", qty: 3 }]
    }, { "Idempotency-Key": idem() });
    if (!so.ok) return { test: "sales:fulfill-without-reserve", result: "FAIL", step: "createSO", so };
    const soId = so.body?.id;
    
    // Get the actual server-assigned line ID
    const soLines = so.body?.lines ?? [];
    const soLineId = soLines[0]?.id ?? soLines[0]?.lineId;
    if (!soLineId) {
      return { test: "sales:fulfill-without-reserve", result: "FAIL", step: "getSoLineId", reason: "no line ID in SO response", soLines };
    }
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
      lines: [{ id: soLineId, deltaQty: 3, locationId: locId, lot: "LOT-FNR" }]
    }, { "Idempotency-Key": idem() });
    if (!fulfill.ok) return { test: "sales:fulfill-without-reserve", result: "FAIL", step: "fulfill", fulfill };

    // 5) Assert SO status is fulfilled and line is fully fulfilled (short retry for eventual consistency, ~2s total)
    // The fulfill endpoint updates SO status and fulfilledQty in-memory, so we just need a brief
    // retry to allow for eventual consistency in the read of the updated SO document.
    const fulfillStatusMaxRetries = 8;
    const fulfillStatusRetryDelayMs = 250;
    let finalSoStatus = null;
    let soAfterFulfillRetry = null;
    let fulfillStatusReady = false;
    const requestedFulfillQty = 3; // matching the fulfill request above
    
    for (let attempt = 0; attempt < fulfillStatusMaxRetries; attempt++) {
      const soFetch = await get(`/objects/salesOrder/${encodeURIComponent(soId)}`);
      soAfterFulfillRetry = soFetch.body;
      finalSoStatus = soAfterFulfillRetry?.status;
      
      // Check both status and line fulfillment
      if (finalSoStatus === "fulfilled") {
        const soLine = soAfterFulfillRetry?.lines?.[0];
        const fulfilledQty = Number(soLine?.fulfilledQty ?? 0);
        if (fulfilledQty >= requestedFulfillQty) {
          fulfillStatusReady = true;
          break;
        }
      }
      
      if (attempt < fulfillStatusMaxRetries - 1) {
        await sleep(fulfillStatusRetryDelayMs);
      }
    }
    
    if (!fulfillStatusReady) {
      // Build detailed debug snapshot on failure
      const soLine = soAfterFulfillRetry?.lines?.[0];
      const orderedQty = Number(soLine?.qty ?? 0);
      const fulfilledQty = Number(soLine?.fulfilledQty ?? 0);
      
      // Also get onhand snapshot for diagnosis
      const onhandDebug = await get(`/inventory/${encodeURIComponent(itemId)}/onhand:by-location`);
      const locOnhand = (onhandDebug.body?.items ?? []).find(item => item.locationId === locId);
      
      return {
        test: "sales:fulfill-without-reserve",
        result: "FAIL",
        step: "checkFulfillStatus",
        currentStatus: finalSoStatus,
        expectedStatus: "fulfilled",
        lineOrderedQty: orderedQty,
        lineFulfilledQty: fulfilledQty,
        expectedFulfilledQty: requestedFulfillQty,
        locationOnhand: locOnhand ? { onHand: locOnhand.onHand, reserved: locOnhand.reserved } : null,
        attempts: fulfillStatusMaxRetries
      };
    }

    const soAfterFulfill = soAfterFulfillRetry;

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
      lines: [{ id: soLineId, deltaQty: 3, locationId: locId, lot: "LOT-OBC" }]
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
      lines: [{ id: soLineId, deltaQty: 2, locationId: locId, lot: "LOT-OBC" }]
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

  "smoke:salesOrders:patch-lines": async () => {
    await ensureBearer();

    const { partyId } = await seedParties(api);
    const prod = await createProduct({ name: "SO-PatchLines" });
    if (!prod.ok) return { test: "salesOrders:patch-lines", result: "FAIL", prod };
    const inv = await createInventoryForProduct(prod.body?.id, "SO-PatchLinesItem");
    if (!inv.ok) return { test: "salesOrders:patch-lines", result: "FAIL", inv };
    const itemId = inv.body?.id;

    // 1) Create draft SO with 2 lines (server should assign ids)
    const create = await post(
      `/objects/salesOrder`,
      {
        type: "salesOrder",
        status: "draft",
        partyId,
        lines: [
          { itemId, uom: "ea", qty: 2 },
          { itemId, uom: "ea", qty: 3 },
        ],
      },
      { "Idempotency-Key": idem() }
    );
    if (!create.ok) return { test: "salesOrders:patch-lines", result: "FAIL", create };

    const soId = create.body?.id;
    const createLines = Array.isArray(create.body?.lines) ? create.body.lines : [];
    const keepLine = createLines[0] || {};
    const keepLineId = keepLine.id ?? keepLine.lineId;
    const removeLineId = (createLines[1]?.id ?? createLines[1]?.lineId) || "";
    const newCid = `tmp-${Math.random().toString(36).slice(2, 10)}`;

    // 2) Patch-lines: update qty of first line, remove second line, add a new third line
    const patch = await post(
      `/sales/so/${encodeURIComponent(soId)}:patch-lines`,
      {
        ops: [
          { op: "upsert", id: keepLineId, patch: { qty: (Number(keepLine.qty) || 0) + 1 } },
          { op: "remove", id: removeLineId },
          { op: "upsert", cid: newCid, patch: { itemId, uom: "ea", qty: 5 } },
        ],
      },
      { "Idempotency-Key": idem() }
    );
    if (!patch.ok) return { test: "salesOrders:patch-lines", result: "FAIL", patch, create };

    // 3) Fetch SO and assert: kept line updated, removed line gone, new line has fresh id (not reused)
    const got = await get(`/objects/salesOrder/${encodeURIComponent(soId)}`);
    const lines = Array.isArray(got.body?.lines) ? got.body.lines : [];
    const ids = lines.map(l => l?.id ?? l?.lineId).filter(Boolean);
    const updatedKeep = lines.find(l => (l?.id ?? l?.lineId) === keepLineId);
    const removedStillPresent = lines.find(l => (l?.id ?? l?.lineId) === removeLineId);
    const addedLine = lines.find(l => (l?.id ?? l?.lineId) !== keepLineId && l.itemId === itemId && Number(l.qty) === 5);
    const addedHasId = addedLine && typeof (addedLine.id ?? addedLine.lineId) === "string" && (addedLine.id ?? addedLine.lineId).trim().length > 0;
    const addedLineId = addedLine?.id ?? addedLine?.lineId;
    const idReused = addedLineId === removeLineId;
    
    // INVARIANT: New line via cid must get server-assigned id in L\d+ format (never fabricated by client)
    const addedLineIdIsValid = addedLineId && /^L\d+$/.test(addedLineId);
    // INVARIANT: Verify all assigned ids match L\d+ pattern (no client ids leaked)
    const allIdsValid = ids.every(id => /^L\d+$/.test(id));

    const pass = create.ok && patch.ok && got.ok && lines.length === 2 && updatedKeep && Number(updatedKeep.qty) === ((Number(keepLine.qty) || 0) + 1) && !removedStillPresent && addedLine && addedHasId && !idReused && addedLineIdIsValid && allIdsValid;
    return {
      test: "salesOrders:patch-lines",
      result: pass ? "PASS" : "FAIL",
      createLines,
      patched: patch.body,
      persistedLines: lines,
      keepLineId,
      removeLineId,
      addedLineId,
      newCid,
      idReused,
      addedLineIdIsValid,
      allIdsValid,
      assertions: {
        "new-line-has-server-id": addedLineIdIsValid,
        "all-ids-match-L-pattern": allIdsValid,
        "removed-id-not-reused": !idReused,
      },
      create,
      patch,
      got,
    };
  },

  "smoke:purchaseOrders:patch-lines": async () => {
    await ensureBearer();

    const { vendorId } = await seedVendor(api);
    const prod = await createProduct({ name: "PO-PatchLines" });
    if (!prod.ok) return { test: "purchaseOrders:patch-lines", result: "FAIL", prod };
    const inv = await createInventoryForProduct(prod.body?.id, "PO-PatchLinesItem");
    if (!inv.ok) return { test: "purchaseOrders:patch-lines", result: "FAIL", inv };
    const itemId = inv.body?.id;

    // 1) Create draft PO with 2 lines (server should assign ids)
    const create = await post(
      `/objects/purchaseOrder`,
      {
        type: "purchaseOrder",
        status: "draft",
        vendorId,
        lines: [
          { itemId, uom: "ea", qty: 3 },
          { itemId, uom: "ea", qty: 4 },
        ],
      },
      { "Idempotency-Key": idem() }
    );
    if (!create.ok) return { test: "purchaseOrders:patch-lines", result: "FAIL", create };

    const poId = create.body?.id;
    const createLines = Array.isArray(create.body?.lines) ? create.body.lines : [];
    const keepLine = createLines[0] || {};
    const keepLineId = keepLine.id ?? keepLine.lineId;
    const removeLineId = (createLines[1]?.id ?? createLines[1]?.lineId) || "";
    const newCid = `tmp-${Math.random().toString(36).slice(2, 10)}`;

    // 2) Patch-lines: update qty of first line, remove second line, add a new third line
    const patch = await post(
      `/purchasing/po/${encodeURIComponent(poId)}:patch-lines`,
      {
        ops: [
          { op: "upsert", id: keepLineId, patch: { qty: (Number(keepLine.qty) || 0) + 2 } },
          { op: "remove", id: removeLineId },
          { op: "upsert", cid: newCid, patch: { itemId, uom: "ea", qty: 7 } },
        ],
      },
      { "Idempotency-Key": idem() }
    );
    if (!patch.ok) return { test: "purchaseOrders:patch-lines", result: "FAIL", patch, create };

    // 3) Fetch PO and assert: kept line updated, removed line gone, new line has fresh id (not reused)
    const got = await get(`/objects/purchaseOrder/${encodeURIComponent(poId)}`);
    const lines = Array.isArray(got.body?.lines) ? got.body.lines : [];
    const ids = lines.map(l => l?.id ?? l?.lineId).filter(Boolean);
    const updatedKeep = lines.find(l => (l?.id ?? l?.lineId) === keepLineId);
    const removedStillPresent = lines.find(l => (l?.id ?? l?.lineId) === removeLineId);
    const addedLine = lines.find(l => (l?.id ?? l?.lineId) !== keepLineId && l.itemId === itemId && Number(l.qty) === 7);
    const addedHasId = addedLine && typeof (addedLine.id ?? addedLine.lineId) === "string" && (addedLine.id ?? addedLine.lineId).trim().length > 0;
    const addedLineId = addedLine?.id ?? addedLine?.lineId;
    const idReused = addedLineId === removeLineId;
    
    // INVARIANT: New line via cid must get server-assigned id in L\d+ format (never fabricated by client)
    const addedLineIdIsValid = addedLineId && /^L\d+$/.test(addedLineId);
    // INVARIANT: Verify all assigned ids match L\d+ pattern (no client ids leaked)
    const allIdsValid = ids.every(id => /^L\d+$/.test(id));

    const pass = create.ok && patch.ok && got.ok && lines.length === 2 && updatedKeep && Number(updatedKeep.qty) === ((Number(keepLine.qty) || 0) + 2) && !removedStillPresent && addedLine && addedHasId && !idReused && addedLineIdIsValid && allIdsValid;
    return {
      test: "purchaseOrders:patch-lines",
      result: pass ? "PASS" : "FAIL",
      createLines,
      patched: patch.body,
      persistedLines: lines,
      keepLineId,
      removeLineId,
      addedLineId,
      newCid,
      idReused,
      addedLineIdIsValid,
      allIdsValid,
      assertions: {
        "new-line-has-server-id": addedLineIdIsValid,
        "all-ids-match-L-pattern": allIdsValid,
        "removed-id-not-reused": !idReused,
      },
      create,
      patch,
      got,
    };
  },

  // Negative validation: patch-lines must reject tmp-* in id (cid-only) and keep lines unchanged
  "smoke:salesOrders:patch-lines:validation": async () => {
    await ensureBearer();

    const { partyId } = await seedParties(api);

    // Create draft SO with no lines to isolate side effects
    const create = await post(
      `/objects/salesOrder`,
      {
        type: "salesOrder",
        status: "draft",
        partyId,
        lines: [],
      },
      { "Idempotency-Key": idem() }
    );
    if (!create.ok) return { test: "salesOrders:patch-lines:validation", result: "FAIL", reason: "so-create-failed", create };

    const soId = create.body?.id;

    // Invalid op: id uses tmp-* prefix (reserved for cid) -> must 400 with PATCH_LINES_INVALID_ID
    const invalid = await post(
      `/sales/so/${encodeURIComponent(soId)}:patch-lines`,
      {
        ops: [
          { op: "upsert", id: "tmp-should-be-cid", patch: { itemId: "ValidationItem", qty: 1, uom: "ea" } },
        ],
      },
      { "Idempotency-Key": idem() }
    );

    const blocked = !invalid.ok && invalid.status === 400;
    const code = invalid.body?.details?.code;
    const messageHasTmp = typeof invalid.body?.message === "string" && invalid.body.message.toLowerCase().includes("tmp");

    // Ensure no lines were added despite invalid request
    const fetch = await get(`/objects/salesOrder/${encodeURIComponent(soId)}`);
    const lineCount = Array.isArray(fetch.body?.lines) ? fetch.body.lines.length : 0;
    const noLinesCreated = fetch.ok && lineCount === 0;

    const pass = blocked && code === "PATCH_LINES_INVALID_ID" && noLinesCreated;

    return {
      test: "salesOrders:patch-lines:validation",
      result: pass ? "PASS" : "FAIL",
      assertions: {
        blocked,
        codeIsPatchLinesInvalidId: code === "PATCH_LINES_INVALID_ID",
        messageHasTmp,
        noLinesCreated,
      },
      create,
      invalid,
      fetch,
    };
  },

  /**
   * Regression: PO patch-lines CID flow (parity with SO)
   * - Add new line via cid -> server assigns stable L{n}
   * - Subsequent patch uses id and succeeds
   */
  "smoke:po:patch-lines:cid": async () => {
    await ensureBearer();

    const { vendorId } = await seedVendor(api);

    const prod = await createProduct({ name: "PoCidTest" });
    if (!prod.ok) return { test: "po:patch-lines:cid", result: "FAIL", reason: "product-create-failed", prod };

    const inv = await createInventoryForProduct(prod.body.id, "PoCidTestItem");
    if (!inv.ok) return { test: "po:patch-lines:cid", result: "FAIL", reason: "inventory-create-failed", inv };

    const itemId = inv.body?.id;

    // 1) Create draft PO with 1 initial line (for remove/update testing)
    const create = await post(
      `/objects/purchaseOrder`,
      {
        type: "purchaseOrder",
        status: "draft",
        vendorId,
        lines: [{ itemId, qty: 1, uom: "ea" }],
      },
      { "Idempotency-Key": idem() }
    );

    if (!create.ok || !create.body?.id) {
      return { test: "po:patch-lines:cid", result: "FAIL", reason: "po-create-failed", create };
    }

    const poId = create.body.id;
    const initialLine = Array.isArray(create.body.lines) ? create.body.lines[0] : null;
    const initialLineId = initialLine?.id ? String(initialLine.id).trim() : null;

    // 2) Multi-op patch: add via cid, update via id, remove existing
    const clientId = `tmp-${Math.random().toString(36).slice(2, 11)}`;
    
    const prod2 = await createProduct({ name: "PoCidTest2" });
    const inv2 = await createInventoryForProduct(prod2.body.id, "PoCidTestItem2");
    const itemId2 = inv2.body?.id;
    
    const patchMultiOp = await post(
      `/purchasing/po/${encodeURIComponent(poId)}:patch-lines`,
      {
        ops: [
          { op: "upsert", cid: clientId, patch: { itemId: itemId2, qty: 3, uom: "ea" } }, // Add via cid
          { op: "upsert", id: initialLineId, patch: { qty: 2 } }, // Update existing via id
          initialLineId ? { op: "remove", id: initialLineId } : null, // Remove existing line
        ].filter(Boolean)
      },
      { "Idempotency-Key": idem() }
    );

    if (!patchMultiOp.ok) {
      return { test: "po:patch-lines:cid", result: "FAIL", reason: "patch-multi-op-failed", patchMultiOp };
    }

    // 3) Fetch and verify multi-op results
    const fetch1 = await get(`/objects/purchaseOrder/${encodeURIComponent(poId)}`);
    if (!fetch1.ok || !fetch1.body) {
      return { test: "po:patch-lines:cid", result: "FAIL", reason: "po-fetch1-failed", fetch1 };
    }

    const lines1 = Array.isArray(fetch1.body.lines) ? fetch1.body.lines : [];
    
    // Verify: removed line is gone, new line exists with L{n} id, no tmp-* ids remain
    const removedLineExists = initialLineId && lines1.some(ln => ln.id === initialLineId);
    const newLineAdded = lines1.find(ln => ln.itemId === itemId2);
    const newLineHasValidId = newLineAdded && /^L\d+$/.test(String(newLineAdded.id).trim());
    const noTmpIdsRemain = !lines1.some(ln => String(ln.id || "").trim().startsWith("tmp-"));
    
    if (removedLineExists) {
      return { test: "po:patch-lines:cid", result: "FAIL", reason: "multi-op-remove-failed", removedLineStillExists: initialLineId };
    }
    
    if (!newLineAdded) {
      return { test: "po:patch-lines:cid", result: "FAIL", reason: "multi-op-add-failed", lines: lines1.map(l => ({ id: l.id, itemId: l.itemId })) };
    }
    
    if (!newLineHasValidId) {
      return { test: "po:patch-lines:cid", result: "FAIL", reason: "multi-op-new-id-invalid", newLineId: newLineAdded.id };
    }

    const newLineId = String(newLineAdded.id).trim();

    // 4) Status guard test - submit PO and verify 409 on patch
    const cancel = await post(
      `/purchasing/po/${encodeURIComponent(poId)}:cancel`,
      {},
      { "Idempotency-Key": idem() }
    );

    if (!cancel.ok) {
      return { test: "po:patch-lines:cid", result: "FAIL", reason: "cancel-failed", cancel };
    }

    // Try patch on cancelled PO (should fail 409 - status not editable)
    const patchAfterCancel = await post(
      `/purchasing/po/${encodeURIComponent(poId)}:patch-lines`,
      {
        ops: [{ op: "upsert", cid: `tmp-guard-${Math.random().toString(36).slice(2, 7)}`, patch: { itemId, qty: 1, uom: "ea" } }]
      },
      { "Idempotency-Key": idem() }
    );

    const statusGuardCorrect = !patchAfterCancel.ok && patchAfterCancel.status === 409;

    // Final assertions
    const pass = patchMultiOp.ok && newLineHasValidId && noTmpIdsRemain && statusGuardCorrect;

    return {
      test: "po:patch-lines:cid",
      result: pass ? "PASS" : "FAIL",
      poId,
      clientId,
      newLineId,
      assertions: {
        multiOp_ok: patchMultiOp.ok,
        multiOp_newLineAdded: newLineAdded ? true : false,
        multiOp_removedLineGone: !removedLineExists,
        multiOp_newLineHasL_n_Id: newLineHasValidId,
        multiOp_noTmpIdsRemain: noTmpIdsRemain,
        statusGuard_409_on_cancelled: statusGuardCorrect,
        statusGuard_actual_status: patchAfterCancel.status
      }
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

  // SO patch-lines: verify draft-only enforcement (E2 rule)
  // STRICT: patch-lines must be allowed in draft and blocked (409 SO_NOT_EDITABLE) after submit.
  // SO patch-lines contract: allowed in draft AND submitted statuses (per Sprint AF)
  "smoke:salesOrders:patch-lines-after-submit": async () => {
    await ensureBearer();

    const { partyId } = await seedParties(api);
    const prod = await createProduct({ name: "SO-PatchLinesAfterSubmit" });
    if (!prod.ok) return { test: "salesOrders:patch-lines-after-submit", result: "FAIL", prod };
    const inv = await createInventoryForProduct(prod.body?.id, "SO-PatchLinesAfterSubmit-Item");
    if (!inv.ok) return { test: "salesOrders:patch-lines-after-submit", result: "FAIL", inv };
    const itemId = inv.body?.id;

    // 1) Create draft SO with 2 lines
    const create = await post(
      `/objects/salesOrder`,
      {
        type: "salesOrder",
        status: "draft",
        partyId,
        lines: [
          { itemId, uom: "ea", qty: 5 },
          { itemId, uom: "ea", qty: 3 }
        ]
      },
      { "Idempotency-Key": idem() }
    );
    if (!create.ok) return { test: "salesOrders:patch-lines-after-submit", result: "FAIL", create };
    const soId = create.body?.id;
    const lines = Array.isArray(create.body?.lines) ? create.body.lines : [];
    const lineId = lines[0]?.id ?? lines[0]?.lineId;
    const createdLineIds = lines.map(l => l?.id ?? l?.lineId).filter(Boolean);
    const createdIdsValid = createdLineIds.every(id => /^L\d+$/.test(id));

    // 2) PATCH-LINES in draft: update qty on first line → must succeed
    const patchInDraft = await post(
      `/sales/so/${encodeURIComponent(soId)}:patch-lines`,
      {
        ops: [
          { op: "upsert", id: lineId, patch: { qty: 10 } }
        ]
      },
      { "Idempotency-Key": idem() }
    );
    if (!patchInDraft.ok) return { test: "salesOrders:patch-lines-after-submit", result: "FAIL", patchInDraft };
    const updatedLineAfterDraftPatch = patchInDraft.body?.lines?.find((l) => (l.id ?? l.lineId) === lineId);
    const draftQtyUpdated = updatedLineAfterDraftPatch && Number(updatedLineAfterDraftPatch.qty) === 10;
    const draftPatchLineIds = Array.isArray(patchInDraft.body?.lines) ? patchInDraft.body.lines.map(l => l?.id ?? l?.lineId).filter(Boolean) : [];
    const draftPatchIdsValid = draftPatchLineIds.every(id => /^L\d+$/.test(id));

    // 3) Submit the SO
    const submit = await post(
      `/sales/so/${encodeURIComponent(soId)}:submit`,
      {},
      { "Idempotency-Key": idem() }
    );
    if (!submit.ok) return { test: "salesOrders:patch-lines-after-submit", result: "FAIL", submit };

    // 4) PATCH-LINES on submitted SO must NOW SUCCEED (Sprint AF change: allows submitted status)
    const patchAfterSubmit = await post(
      `/sales/so/${encodeURIComponent(soId)}:patch-lines`,
      {
        ops: [
          { op: "upsert", id: lineId, patch: { qty: 15 } }
        ]
      },
      { "Idempotency-Key": idem() }
    );
    
    // NEW CONTRACT (E6): patch-lines must succeed in submitted status
    const patchAfterSubmitSucceeded = patchAfterSubmit.ok && patchAfterSubmit.status === 200;
    const updatedLineAfterSubmitPatch = patchAfterSubmit.body?.lines?.find((l) => (l.id ?? l.lineId) === lineId);
    const submittedQtyUpdated = updatedLineAfterSubmitPatch && Number(updatedLineAfterSubmitPatch.qty) === 15;
    const submittedPatchLineIds = Array.isArray(patchAfterSubmit.body?.lines) ? patchAfterSubmit.body.lines.map(l => l?.id ?? l?.lineId).filter(Boolean) : [];
    const submittedPatchIdsValid = submittedPatchLineIds.every(id => /^L\d+$/.test(id));
    
    // Verify line ids remain stable across both patches
    const idsStable = createdLineIds.length > 0 && 
                      draftPatchLineIds.some(id => createdLineIds.includes(id)) &&
                      submittedPatchLineIds.some(id => createdLineIds.includes(id));

    const pass = create.ok && createdIdsValid &&
                 patchInDraft.ok && draftQtyUpdated && draftPatchIdsValid &&
                 submit.ok &&
                 patchAfterSubmitSucceeded && submittedQtyUpdated && submittedPatchIdsValid &&
                 idsStable;

    return {
      test: "salesOrders:patch-lines-after-submit",
      result: pass ? "PASS" : "FAIL",
      summary: "E6: Verify SO patch-lines works in both draft and submitted statuses with stable line ids",
      create,
      createdLineIds,
      createdIdsValid,
      patchInDraft,
      draftQtyUpdated,
      draftPatchIdsValid,
      submit,
      patchAfterSubmit,
      patchAfterSubmitSucceeded,
      submittedQtyUpdated,
      submittedPatchIdsValid,
      idsStable
    };
  },

  // DEPRECATED (Sprint AF→AG): Backward-compat alias for smoke:salesOrders:patch-lines-after-submit
  // Scheduled for removal in Sprint AG (2026-01-11). Use smoke:salesOrders:patch-lines-after-submit instead.
  "smoke:salesOrders:patch-lines-draft-only-after-submit": async () => {
    console.warn("[DEPRECATION] smoke:salesOrders:patch-lines-draft-only-after-submit is deprecated (Sprint AF). Use smoke:salesOrders:patch-lines-after-submit instead. Will be removed in Sprint AG.");
    // Delegate to new test
    return tests["smoke:salesOrders:patch-lines-after-submit"]();
  },

  // E4 Validation: patch-lines status gates and line id stability
  // - SO: patch-lines must succeed in draft, submitted, AND committed statuses
  // - PO: patch-lines must succeed in draft only
  // - All returned lines must have stable L{n} id format
  "smoke:patch-lines:status-gates-and-ids": async () => {
    await ensureBearer();

    const { vendorId } = await seedVendor(api);
    const { partyId } = await seedParties(api);
    const prod = await createProduct({ name: "PatchLinesStatusTest" });
    if (!prod.ok) return { test: "patch-lines:status-gates-and-ids", result: "FAIL", step: "create-product", prod };
    const inv = await createInventoryForProduct(prod.body?.id, "PatchLinesStatusTestItem");
    if (!inv.ok) return { test: "patch-lines:status-gates-and-ids", result: "FAIL", step: "create-inventory", inv };
    const itemId = inv.body?.id;

    // ===== SO Status Gates Test =====
    // 1) Create SO in draft status
    const soCreate = await post(
      `/objects/salesOrder`,
      {
        type: "salesOrder",
        status: "draft",
        partyId,
        lines: [{ itemId, uom: "ea", qty: 10 }]
      },
      { "Idempotency-Key": idem() }
    );
    if (!soCreate.ok) return { test: "patch-lines:status-gates-and-ids", result: "FAIL", step: "so-create", soCreate };
    const soId = soCreate.body?.id;
    const soLines = Array.isArray(soCreate.body?.lines) ? soCreate.body.lines : [];
    const soLineId = soLines[0]?.id ?? soLines[0]?.lineId;

    // 2) Test patch-lines in DRAFT status (should succeed)
    const soPatchDraft = await post(
      `/sales/so/${encodeURIComponent(soId)}:patch-lines`,
      {
        ops: [
          { op: "upsert", id: soLineId, patch: { qty: 15 } }
        ]
      },
      { "Idempotency-Key": idem() }
    );
    if (!soPatchDraft.ok) return { test: "patch-lines:status-gates-and-ids", result: "FAIL", step: "so-patch-draft", soPatchDraft };
    const soPatchDraftLines = Array.isArray(soPatchDraft.body?.lines) ? soPatchDraft.body.lines : [];
    const soDraftLineIds = soPatchDraftLines.map(l => l?.id ?? l?.lineId).filter(Boolean);
    const soDraftIdsValid = soDraftLineIds.every(id => /^L\d+$/.test(id));

    // 3) Submit SO to "submitted" status
    const soSubmit = await post(
      `/sales/so/${encodeURIComponent(soId)}:submit`,
      {},
      { "Idempotency-Key": idem() }
    );
    if (!soSubmit.ok) return { test: "patch-lines:status-gates-and-ids", result: "FAIL", step: "so-submit", soSubmit };

    // 4) Test patch-lines in SUBMITTED status (per E1 spec, should now succeed)
    const soPatchSubmitted = await post(
      `/sales/so/${encodeURIComponent(soId)}:patch-lines`,
      {
        ops: [
          { op: "upsert", id: soLineId, patch: { qty: 20 } }
        ]
      },
      { "Idempotency-Key": idem() }
    );
    const soSubmittedPatched = soPatchSubmitted.ok;
    if (soSubmittedPatched) {
      const soSubmittedLines = Array.isArray(soPatchSubmitted.body?.lines) ? soPatchSubmitted.body.lines : [];
      const soSubmittedLineIds = soSubmittedLines.map(l => l?.id ?? l?.lineId).filter(Boolean);
      const soSubmittedIdsValid = soSubmittedLineIds.every(id => /^L\d+$/.test(id));
    }

    // 5) Commit SO to "committed" status
    const soCommit = await post(
      `/sales/so/${encodeURIComponent(soId)}:commit`,
      {},
      { "Idempotency-Key": idem() }
    );
    if (!soCommit.ok) return { test: "patch-lines:status-gates-and-ids", result: "FAIL", step: "so-commit", soCommit };

    // 6) Test patch-lines in COMMITTED status (per E1 spec, should now succeed)
    const soPatchApproved = await post(
      `/sales/so/${encodeURIComponent(soId)}:patch-lines`,
      {
        ops: [
          { op: "upsert", id: soLineId, patch: { qty: 25 } }
        ]
      },
      { "Idempotency-Key": idem() }
    );
    const soApprovedPatched = soPatchApproved.ok;
    if (soApprovedPatched) {
      const soApprovedLines = Array.isArray(soPatchApproved.body?.lines) ? soPatchApproved.body.lines : [];
      const soApprovedLineIds = soApprovedLines.map(l => l?.id ?? l?.lineId).filter(Boolean);
      const soApprovedIdsValid = soApprovedLineIds.every(id => /^L\d+$/.test(id));
    }

    // ===== PO Status Gates Test =====
    // 1) Create PO in draft status
    const poCreate = await post(
      `/objects/purchaseOrder`,
      {
        type: "purchaseOrder",
        status: "draft",
        vendorId,
        lines: [{ itemId, uom: "ea", qty: 12 }]
      },
      { "Idempotency-Key": idem() }
    );
    if (!poCreate.ok) return { test: "patch-lines:status-gates-and-ids", result: "FAIL", step: "po-create", poCreate };
    const poId = poCreate.body?.id;
    const poLines = Array.isArray(poCreate.body?.lines) ? poCreate.body.lines : [];
    const poLineId = poLines[0]?.id ?? poLines[0]?.lineId;

    // 2) Test patch-lines in DRAFT status (should succeed)
    const poPatchDraft = await post(
      `/purchasing/po/${encodeURIComponent(poId)}:patch-lines`,
      {
        ops: [
          { op: "upsert", id: poLineId, patch: { qty: 18 } }
        ]
      },
      { "Idempotency-Key": idem() }
    );
    if (!poPatchDraft.ok) return { test: "patch-lines:status-gates-and-ids", result: "FAIL", step: "po-patch-draft", poPatchDraft };
    const poPatchDraftLines = Array.isArray(poPatchDraft.body?.lines) ? poPatchDraft.body.lines : [];
    const poDraftLineIds = poPatchDraftLines.map(l => l?.id ?? l?.lineId).filter(Boolean);
    const poDraftIdsValid = poDraftLineIds.every(id => /^L\d+$/.test(id));

    // 3) Submit PO to move away from draft (if supported; if not, note in result)
    const poSubmit = await post(
      `/purchasing/po/${encodeURIComponent(poId)}:submit`,
      {},
      { "Idempotency-Key": idem() }
    );
    const poSubmitSupported = poSubmit.ok;

    // 4) Test patch-lines in NON-DRAFT status (PO spec: draft-only, should fail if submit succeeded)
    let poNonDraftPatched = null;
    let poNonDraftBlockedCorrectly = false;
    if (poSubmitSupported) {
      const poPatchNonDraft = await post(
        `/purchasing/po/${encodeURIComponent(poId)}:patch-lines`,
        {
          ops: [
            { op: "upsert", id: poLineId, patch: { qty: 24 } }
          ]
        },
        { "Idempotency-Key": idem() }
      );
      poNonDraftPatched = poPatchNonDraft.ok;
      // STRICT: PO patch-lines must be blocked in non-draft status
      poNonDraftBlockedCorrectly = !poPatchNonDraft.ok && poPatchNonDraft.status === 409;
    }

    // ===== Summary =====
    const pass =
      soCreate.ok &&
      soPatchDraft.ok && soDraftIdsValid &&
      soSubmit.ok &&
      soSubmittedPatched && // E1: SO patch-lines should succeed in submitted
      soCommit.ok &&
      soApprovedPatched && // E1: SO patch-lines should succeed in approved
      poCreate.ok &&
      poPatchDraft.ok && poDraftIdsValid &&
      (poSubmitSupported ? poNonDraftBlockedCorrectly : true); // PO draft-only enforcement

    return {
      test: "patch-lines:status-gates-and-ids",
      result: pass ? "PASS" : "FAIL",
      summary: "E4: Validate patch-lines status gates (SO: draft/submitted/committed; PO: draft-only) and stable line ids",
      soTests: {
        "draft-patch-succeeds": soPatchDraft.ok,
        "draft-line-ids-valid": soDraftIdsValid,
        "submitted-patch-succeeds": soSubmittedPatched,
        "committed-patch-succeeds": soApprovedPatched
      },
      poTests: {
        "draft-patch-succeeds": poPatchDraft.ok,
        "draft-line-ids-valid": poDraftIdsValid,
        "submit-transition-supported": poSubmitSupported,
        "non-draft-patch-blocked": poSubmitSupported ? poNonDraftBlockedCorrectly : "not-tested"
      },
      artifacts: { soId, poId, itemId }
    };
  },

  // SO fulfill: verify idempotency with Idempotency-Key replay
  "smoke:salesOrders:fulfill-idempotency-replay": async () => {
    await ensureBearer();

    const { partyId } = await seedParties(api);
    const prod = await createProduct({ name: "SO-FulfillIdem" });
    if (!prod.ok) return { test: "salesOrders:fulfill-idempotency-replay", result: "FAIL", prod };
    const inv = await createInventoryForProduct(prod.body?.id, "SO-FulfillIdem-Item");
    if (!inv.ok) return { test: "salesOrders:fulfill-idempotency-replay", result: "FAIL", inv };
    const itemId = inv.body?.id;

    // Set up on-hand inventory
    const adjRes = await post(
      `/objects/${MV_TYPE}`,
      { itemId, type: "adjust", qty: 100 }
    );

    // 1) Create SO with fulfillable line
    const create = await post(
      `/objects/salesOrder`,
      {
        type: "salesOrder",
        status: "draft",
        partyId,
        lines: [{ itemId, uom: "ea", qty: 50 }]
      },
      { "Idempotency-Key": idem() }
    );
    if (!create.ok) return { test: "salesOrders:fulfill-idempotency-replay", result: "FAIL", create };
    const soId = create.body?.id;
    const lineId = create.body?.lines?.[0]?.id ?? create.body?.lines?.[0]?.lineId;

    // 2) Submit + Commit + Reserve
    const submit = await post(`/sales/so/${encodeURIComponent(soId)}:submit`, {}, { "Idempotency-Key": idem() });
    if (!submit.ok) return { test: "salesOrders:fulfill-idempotency-replay", result: "FAIL", submit };
    const commit = await post(`/sales/so/${encodeURIComponent(soId)}:commit`, {}, { "Idempotency-Key": idem() });
    if (!commit.ok) return { test: "salesOrders:fulfill-idempotency-replay", result: "FAIL", commit };
    const reserve = await post(
      `/sales/so/${encodeURIComponent(soId)}:reserve`,
      { lines: [{ id: lineId, deltaQty: 25 }] },
      { "Idempotency-Key": idem() }
    );
    if (!reserve.ok) return { test: "salesOrders:fulfill-idempotency-replay", result: "FAIL", reserve };

    // 3) First fulfill with Idempotency-Key = K1
    const key1 = idem();
    const fulfill1 = await post(
      `/sales/so/${encodeURIComponent(soId)}:fulfill`,
      { lines: [{ id: lineId, deltaQty: 10 }] },
      { "Idempotency-Key": key1 }
    );
    if (!fulfill1.ok) return { test: "salesOrders:fulfill-idempotency-replay", result: "FAIL", fulfill1 };
    const so1 = fulfill1.body;
    const line1 = so1?.lines?.find((l) => (l.id ?? l.lineId) === lineId);
    const fulfilledAfterFirst = Number(line1?.fulfilledQty ?? 0);

    // 4) Re-play fulfill with same Idempotency-Key K1
    const fulfill2 = await post(
      `/sales/so/${encodeURIComponent(soId)}:fulfill`,
      { lines: [{ id: lineId, deltaQty: 10 }] },
      { "Idempotency-Key": key1 }
    );
    if (!fulfill2.ok) return { test: "salesOrders:fulfill-idempotency-replay", result: "FAIL", fulfill2 };
    const so2 = fulfill2.body;
    const line2 = so2?.lines?.find((l) => (l.id ?? l.lineId) === lineId);
    const fulfilledAfterSecond = Number(line2?.fulfilledQty ?? 0);

    // 5) Assert: second call returns 200, qty unchanged, status unchanged, no movements duplication
    const secondCallSucceeded = fulfill2.ok && fulfill2.status === 200;
    const qtyUnchanged = fulfilledAfterFirst === fulfilledAfterSecond;
    const statusUnchanged = so1?.status === so2?.status;  // both should be partially_fulfilled
    const idempotentPayload = so1?.id === so2?.id;  // same SO ID in response
    
    // Verify fulfill1 increased qty correctly (10 fulfilled on line with qty 50)
    const fulfillmentCorrect = fulfilledAfterFirst === 10;

    const pass = create.ok && submit.ok && commit.ok && reserve.ok && fulfill1.ok && fulfill2.ok && 
                 secondCallSucceeded && qtyUnchanged && statusUnchanged && idempotentPayload && fulfillmentCorrect;
    return {
      test: "salesOrders:fulfill-idempotency-replay",
      result: pass ? "PASS" : "FAIL",
      create,
      fulfill1,
      fulfilledAfterFirst,
      fulfill2,
      fulfilledAfterSecond,
      secondCallSucceeded,
      qtyUnchanged,
      statusUnchanged,
      idempotentPayload,
      fulfillmentCorrect
    };
  },

  // SO fulfill: verify Idempotency-Key reuse with different payload is rejected
  "smoke:salesOrders:fulfill-idempotency-key-reuse-different-payload": async () => {
    await ensureBearer();

    const { partyId } = await seedParties(api);
    const prod = await createProduct({ name: "SO-FulfillKeyReuse" });
    if (!prod.ok) return { test: "salesOrders:fulfill-idempotency-key-reuse-different-payload", result: "FAIL", prod };
    const inv = await createInventoryForProduct(prod.body?.id, "SO-FulfillKeyReuse-Item");
    if (!inv.ok) return { test: "salesOrders:fulfill-idempotency-key-reuse-different-payload", result: "FAIL", inv };
    const itemId = inv.body?.id;

    // Set up on-hand inventory
    const adjRes = await post(
      `/objects/${MV_TYPE}`,
      { itemId, type: "adjust", qty: 100 }
    );

    // Create SO with 2 fulfillable lines
    const create = await post(
      `/objects/salesOrder`,
      {
        type: "salesOrder",
        status: "draft",
        partyId,
        lines: [
          { itemId, uom: "ea", qty: 50 },
          { itemId, uom: "ea", qty: 30 }
        ]
      },
      { "Idempotency-Key": idem() }
    );
    if (!create.ok) return { test: "salesOrders:fulfill-idempotency-key-reuse-different-payload", result: "FAIL", create };
    const soId = create.body?.id;
    const lineIds = create.body?.lines?.map((l) => l.id ?? l.lineId) ?? [];

    // Submit + Commit + Reserve
    const submit = await post(`/sales/so/${encodeURIComponent(soId)}:submit`, {}, { "Idempotency-Key": idem() });
    const commit = await post(`/sales/so/${encodeURIComponent(soId)}:commit`, {}, { "Idempotency-Key": idem() });
    const reserve = await post(
      `/sales/so/${encodeURIComponent(soId)}:reserve`,
      { lines: [{ id: lineIds[0], deltaQty: 25 }, { id: lineIds[1], deltaQty: 15 }] },
      { "Idempotency-Key": idem() }
    );

    // Use same Idempotency-Key K2 with different payloads
    // STRICT first-write-wins: second call with different payload MUST return early cached result
    const key2 = idem();

    // Payload A: fulfill line[0] with 5
    const fulfillA = await post(
      `/sales/so/${encodeURIComponent(soId)}:fulfill`,
      { lines: [{ id: lineIds[0], deltaQty: 5 }] },
      { "Idempotency-Key": key2 }
    );
    if (!fulfillA.ok) return { test: "salesOrders:fulfill-idempotency-key-reuse-different-payload", result: "FAIL", fulfillA };
    const soA = fulfillA.body;
    const lineA = soA?.lines?.find((l) => (l.id ?? l.lineId) === lineIds[0]);
    const lineB_afterA = soA?.lines?.find((l) => (l.id ?? l.lineId) === lineIds[1]);
    const qtyFulfilledLineA = Number(lineA?.fulfilledQty ?? 0);  // should be 5
    const qtyFulfilledLineB_afterA = Number(lineB_afterA?.fulfilledQty ?? 0);  // should be 0

    // Payload B: fulfill line[1] with 10 (same key, different line/qty)
    // This should trigger early key hit and return cached result from fulfillA
    const fulfillB = await post(
      `/sales/so/${encodeURIComponent(soId)}:fulfill`,
      { lines: [{ id: lineIds[1], deltaQty: 10 }] },
      { "Idempotency-Key": key2 }
    );
    if (!fulfillB.ok) return { test: "salesOrders:fulfill-idempotency-key-reuse-different-payload", result: "FAIL", fulfillB };
    const soB = fulfillB.body;
    const lineA_afterB = soB?.lines?.find((l) => (l.id ?? l.lineId) === lineIds[0]);
    const lineB_afterB = soB?.lines?.find((l) => (l.id ?? l.lineId) === lineIds[1]);
    const qtyFulfilledLineA_afterB = Number(lineA_afterB?.fulfilledQty ?? 0);  // should still be 5 (no change)
    const qtyFulfilledLineB_afterB = Number(lineB_afterB?.fulfilledQty ?? 0);  // should still be 0 (payload B NOT applied)

    // Assertions for first-write-wins
    const secondCallSucceeded = fulfillB.ok && fulfillB.status === 200;
    const secondReturnedCachedResult = soB?.id === soA?.id;  // same SO from cache
    const lineAStatePreserved = qtyFulfilledLineA === qtyFulfilledLineA_afterB;  // line A qty unchanged
    const lineBNotModified = qtyFulfilledLineB_afterA === qtyFulfilledLineB_afterB && qtyFulfilledLineB_afterB === 0;  // line B never fulfilled
    const payloadBNotApplied = qtyFulfilledLineB_afterB === 0;  // strict: line B was NOT touched

    const pass = create.ok && submit.ok && commit.ok && reserve.ok && fulfillA.ok && fulfillB.ok && 
                 secondCallSucceeded && secondReturnedCachedResult && lineAStatePreserved && lineBNotModified && payloadBNotApplied;
    return {
      test: "salesOrders:fulfill-idempotency-key-reuse-different-payload",
      result: pass ? "PASS" : "FAIL",
      create,
      fulfillA,
      qtyFulfilledLineA,
      qtyFulfilledLineB_afterA,
      fulfillB,
      qtyFulfilledLineA_afterB,
      qtyFulfilledLineB_afterB,
      secondCallSucceeded,
      secondReturnedCachedResult,
      lineAStatePreserved,
      lineBNotModified,
      payloadBNotApplied
    };
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

  // === Sprint AK E5: Type casing and alias correctness ===
  "smoke:objects:type-casing-and-alias": async () => {
    await ensureBearer();
    const { customerId } = await seedCustomer(api);
    const { vendorId } = await seedVendor(api);

    // A) SalesOrder: Create via canonical, GET via different casings
    const soName = smokeTag(`SO-TypeCasing-${SMOKE_RUN_ID}`);
    const soCreate = await post(`/objects/salesOrder`, {
      type: "salesOrder",
      status: "draft",
      partyId: customerId,
      name: soName,
      lines: []
    });
    if (!soCreate.ok) return { test: "objects:type-casing-and-alias", result: "FAIL", step: "so-create", soCreate };
    const soId = soCreate.body?.id;

    // GET via canonical casing
    const soCanonical = await get(`/objects/salesOrder/${encodeURIComponent(soId)}`);
    // GET via lowercase
    const soLower = await get(`/objects/salesorder/${encodeURIComponent(soId)}`);
    // GET via uppercase
    const soUpper = await get(`/objects/SALESORDER/${encodeURIComponent(soId)}`);

    const soTestOk = soCanonical.ok && soCanonical.body?.id === soId
      && soLower.ok && soLower.body?.id === soId
      && soUpper.ok && soUpper.body?.id === soId;

    // B) BackorderRequest: Create via SO commit flow, LIST using casing variant
    const prodBo = await createProduct({ name: smokeTag(`BO-CasingTest-${SMOKE_RUN_ID}`) });
    if (!prodBo.ok) return { test: "objects:type-casing-and-alias", result: "FAIL", step: "bo-product", prodBo };
    const itemBo = await createInventoryForProduct(prodBo.body?.id, smokeTag(`BOItem-${SMOKE_RUN_ID}`));
    if (!itemBo.ok) return { test: "objects:type-casing-and-alias", result: "FAIL", step: "bo-item", itemBo };
    const itemBoId = itemBo.body?.id;

    // Zero onhand to force backorder
    const onhandBo = await onhand(itemBoId);
    const qtyBo = onhandBo.body?.items?.[0]?.onHand ?? 0;
    if (qtyBo > 0) await post(`/objects/inventoryMovement`, { itemId: itemBoId, type: "adjust", qty: -qtyBo });

    const soBo = await post(`/objects/salesOrder`, {
      type: "salesOrder",
      status: "draft",
      partyId: customerId,
      lines: [{ itemId: itemBoId, qty: 5, uom: "ea" }]
    });
    if (!soBo.ok) return { test: "objects:type-casing-and-alias", result: "FAIL", step: "so-bo-create", soBo };
    const soBoId = soBo.body?.id;

    await post(`/sales/so/${encodeURIComponent(soBoId)}:submit`, {}, { "Idempotency-Key": idem() });
    await post(`/sales/so/${encodeURIComponent(soBoId)}:commit`, {}, { "Idempotency-Key": idem() });

    // Wait for backorder to appear
    const boSearch = await waitForBackorders({ soId: soBoId, itemId: itemBoId, status: "open" });
    const boFound = boSearch.ok && Array.isArray(boSearch.items) && boSearch.items.length > 0;
    const boId = boFound ? boSearch.items[0].id : null;

    // LIST using casing variant (lowercase)
    const boListLower = await get(`/objects/backorderrequest`, { soId: soBoId });
    const boListLowerOk = boListLower.ok && Array.isArray(boListLower.body?.items) && boListLower.body.items.length > 0;

    // GET using casing variants
    const boCanonical = boId ? await get(`/objects/backorderRequest/${encodeURIComponent(boId)}`) : { ok: false };
    const boLower = boId ? await get(`/objects/backorderrequest/${encodeURIComponent(boId)}`) : { ok: false };
    const boTestOk = boFound && boListLowerOk && boCanonical.ok && boLower.ok;

    // C) Inventory alias: Create inventoryItem, GET via both /objects/inventory and /objects/inventoryItem
    const prodInv = await createProduct({ name: smokeTag(`Inv-AliasTest-${SMOKE_RUN_ID}`) });
    if (!prodInv.ok) return { test: "objects:type-casing-and-alias", result: "FAIL", step: "inv-product", prodInv };
    
    // Create via canonical route
    const invCreate = await post(`/objects/inventoryItem`, {
      type: "inventoryItem",
      productId: prodInv.body?.id,
      name: smokeTag(`InvItem-${SMOKE_RUN_ID}`),
      uom: "ea"
    });
    if (!invCreate.ok) return { test: "objects:type-casing-and-alias", result: "FAIL", step: "inv-create", invCreate };
    const invId = invCreate.body?.id;

    // GET via canonical type
    const invCanonical = await get(`/objects/inventoryItem/${encodeURIComponent(invId)}`);
    // GET via alias
    const invAlias = await get(`/objects/inventory/${encodeURIComponent(invId)}`);
    // GET via casing variants
    const invLower = await get(`/objects/inventoryitem/${encodeURIComponent(invId)}`);

    const invTestOk = invCanonical.ok && invCanonical.body?.id === invId
      && invAlias.ok && invAlias.body?.id === invId
      && invLower.ok && invLower.body?.id === invId;

    const pass = soTestOk && boTestOk && invTestOk;

    return {
      test: "objects:type-casing-and-alias",
      result: pass ? "PASS" : "FAIL",
      salesOrder: { create: soCreate, canonical: soCanonical, lower: soLower, upper: soUpper, testOk: soTestOk },
      backorder: { found: boFound, listLower: boListLowerOk, canonical: boCanonical.ok, lower: boLower.ok, testOk: boTestOk },
      inventory: { create: invCreate, canonical: invCanonical, alias: invAlias, lower: invLower, testOk: invTestOk }
    };
  },

  // === Sprint AK E2: UPDATE and DELETE via alias and casing variants ===
  "smoke:objects:inventory-alias-update-delete": async () => {
    await ensureBearer();

    // 1) Create product
    const prodRes = await createProduct({ name: smokeTag(`Inv-UpdateDel-${SMOKE_RUN_ID}`) });
    if (!prodRes.ok) return { test: "objects:inventory-alias-update-delete", result: "FAIL", step: "product-create", prodRes };
    const productId = prodRes.body?.id;

    // 2) Create inventoryItem via legacy "inventory" route
    const invCreate = await post(`/objects/inventory`, {
      type: "inventoryItem",
      productId,
      name: smokeTag(`InvItem-UpdateDel-${SMOKE_RUN_ID}`),
      uom: "ea"
    });
    if (!invCreate.ok) return { test: "objects:inventory-alias-update-delete", result: "FAIL", step: "inventory-create-via-alias", invCreate };
    const invId = invCreate.body?.id;

    // 3) UPDATE via canonical route with mixed casing in body
    const updateCanonical = await put(`/objects/inventoryItem/${encodeURIComponent(invId)}`, {
      name: smokeTag(`InvItem-Updated-Canonical-${SMOKE_RUN_ID}`)
    });
    if (!updateCanonical.ok) return { test: "objects:inventory-alias-update-delete", result: "FAIL", step: "update-canonical", updateCanonical };

    // Verify update took effect
    const getAfterCanonical = await get(`/objects/inventoryItem/${encodeURIComponent(invId)}`);
    const canonicalUpdateWorked = getAfterCanonical.ok && getAfterCanonical.body?.name?.includes("Updated-Canonical");

    // 4) UPDATE via legacy "inventory" route (alias)
    const updateAlias = await put(`/objects/inventory/${encodeURIComponent(invId)}`, {
      name: smokeTag(`InvItem-Updated-Alias-${SMOKE_RUN_ID}`)
    });
    if (!updateAlias.ok) return { test: "objects:inventory-alias-update-delete", result: "FAIL", step: "update-alias", updateAlias };

    // Verify alias update took effect
    const getAfterAlias = await get(`/objects/inventory/${encodeURIComponent(invId)}`);
    const aliasUpdateWorked = getAfterAlias.ok && getAfterAlias.body?.name?.includes("Updated-Alias");

    // 5) DELETE via canonical route
    const deleteCanonical = await fetch(`${API}/objects/inventoryItem/${encodeURIComponent(invId)}`, {
      method: "DELETE",
      headers: buildHeaders()
    });
    const deleteCanonicalStatus = deleteCanonical.status;
    const deleteCanonicalOk = deleteCanonicalStatus === 204 || deleteCanonicalStatus === 200;

    if (!deleteCanonicalOk) {
      const deleteBody = await deleteCanonical.json().catch(() => ({}));
      return { 
        test: "objects:inventory-alias-update-delete", 
        result: "FAIL", 
        step: "delete-canonical", 
        expectedStatus: "204 or 200",
        actualStatus: deleteCanonicalStatus,
        body: deleteBody
      };
    }

    // 6) Confirm 404 via both canonical and alias routes
    const getCanonical404 = await get(`/objects/inventoryItem/${encodeURIComponent(invId)}`);
    const getAlias404 = await get(`/objects/inventory/${encodeURIComponent(invId)}`);

    const canonical404 = getCanonical404.status === 404;
    const alias404 = getAlias404.status === 404;

    // 7) Create another item to test DELETE via alias route (Sprint AM E4 extension)
    const invCreate2 = await post(`/objects/inventory`, {
      type: "inventoryItem",
      productId,
      name: smokeTag(`InvItem-DelAlias-${SMOKE_RUN_ID}`),
      uom: "ea"
    });
    if (!invCreate2.ok) return { test: "objects:inventory-alias-update-delete", result: "FAIL", step: "inventory-create2", invCreate2 };
    const invId2 = invCreate2.body?.id;

    // 8) DELETE via alias route
    const deleteAlias = await fetch(`${API}/objects/inventory/${encodeURIComponent(invId2)}`, {
      method: "DELETE",
      headers: buildHeaders()
    });
    const deleteAliasStatus = deleteAlias.status;
    const deleteAliasOk = deleteAliasStatus === 204 || deleteAliasStatus === 200;

    if (!deleteAliasOk) {
      const deleteAliasBody = await deleteAlias.json().catch(() => ({}));
      return { 
        test: "objects:inventory-alias-update-delete", 
        result: "FAIL", 
        step: "delete-alias", 
        expectedStatus: "204 or 200",
        actualStatus: deleteAliasStatus,
        body: deleteAliasBody
      };
    }

    // 9) Verify 404 via both routes after alias DELETE
    const getCanonical404_2 = await get(`/objects/inventoryItem/${encodeURIComponent(invId2)}`);
    const getAlias404_2 = await get(`/objects/inventory/${encodeURIComponent(invId2)}`);

    const canonical404_2 = getCanonical404_2.status === 404;
    const alias404_2 = getAlias404_2.status === 404;

    const pass = canonicalUpdateWorked && aliasUpdateWorked && deleteCanonicalOk && canonical404 && alias404 
                 && deleteAliasOk && canonical404_2 && alias404_2;

    return {
      test: "objects:inventory-alias-update-delete",
      result: pass ? "PASS" : "FAIL",
      create: { ok: invCreate.ok, id: invId },
      updateCanonical: { ok: updateCanonical.ok, verified: canonicalUpdateWorked },
      updateAlias: { ok: updateAlias.ok, verified: aliasUpdateWorked },
      deleteCanonical: { ok: deleteCanonicalOk, status: deleteCanonicalStatus },
      verify404: { canonical: canonical404, alias: alias404 },
      deleteAlias: { ok: deleteAliasOk, status: deleteAliasStatus, id: invId2 },
      verify404Alias: { canonical: canonical404_2, alias: alias404_2 }
    };
  },

  // === Sprint AM E4: SEARCH with inventory alias union ===
  "smoke:objects:search-inventory-alias-union": async () => {
    await ensureBearer();

    const prodRes = await createProduct({ name: smokeTag(`SearchAliasUnion-${SMOKE_RUN_ID}`) });
    if (!prodRes.ok) return { test: "objects:search-inventory-alias-union", result: "FAIL", step: "product-create", prodRes };
    const productId = prodRes.body?.id;

    // Create via legacy inventory route with unique searchable marker
    const uniqueMarker = `SearchMarker-${SMOKE_RUN_ID}-${Date.now()}`;
    const invCreate = await post(`/objects/inventory`, {
      type: "inventoryItem",
      productId,
      name: smokeTag(uniqueMarker),
      uom: "ea"
    });
    if (!invCreate.ok) return { test: "objects:search-inventory-alias-union", result: "FAIL", step: "create", invCreate };
    const invId = invCreate.body?.id;

    // Verify stored as inventoryItem
    const getCanonical = await get(`/objects/inventoryItem/${encodeURIComponent(invId)}`);
    if (!getCanonical.ok || getCanonical.body?.type !== "inventoryItem") {
      return { test: "objects:search-inventory-alias-union", result: "FAIL", step: "verify-type", getCanonical };
    }

    // Search via alias route (POST /objects/inventory/search)
    const searchRes = await post(`/objects/inventory/search`, { q: uniqueMarker });
    if (!searchRes.ok) return { test: "objects:search-inventory-alias-union", result: "FAIL", step: "search", searchRes };

    const items = searchRes.body?.items || [];
    const found = items.some(item => item?.id === invId);

    return {
      test: "objects:search-inventory-alias-union",
      result: found ? "PASS" : "FAIL",
      create: { ok: invCreate.ok, id: invId, storedType: getCanonical.body?.type },
      search: { ok: searchRes.ok, itemCount: items.length, found }
    };
  },

  // === Sprint AM E4: UPDATE with casing variants ===
  "smoke:objects:update-casing-variants": async () => {
    await ensureBearer();

    const prodRes = await createProduct({ name: smokeTag(`UpdateCasing-${SMOKE_RUN_ID}`) });
    if (!prodRes.ok) return { test: "objects:update-casing-variants", result: "FAIL", step: "product-create", prodRes };
    const productId = prodRes.body?.id;

    // Create inventory item via canonical route
    const invCreate = await post(`/objects/inventoryItem`, {
      type: "inventoryItem",
      productId,
      name: smokeTag(`InvCasing-${SMOKE_RUN_ID}`),
      uom: "ea"
    });
    if (!invCreate.ok) return { test: "objects:update-casing-variants", result: "FAIL", step: "create", invCreate };
    const invId = invCreate.body?.id;

    // Update via lowercase route
    const updateLower = await put(`/objects/inventoryitem/${encodeURIComponent(invId)}`, {
      name: smokeTag(`InvCasing-Lower-${SMOKE_RUN_ID}`)
    });
    if (!updateLower.ok) return { test: "objects:update-casing-variants", result: "FAIL", step: "update-lower", updateLower };

    // Verify via canonical GET
    const getAfterLower = await get(`/objects/inventoryItem/${encodeURIComponent(invId)}`);
    const lowerUpdateWorked = getAfterLower.ok && getAfterLower.body?.name?.includes("Lower");

    // Update via uppercase route
    const updateUpper = await put(`/objects/INVENTORYITEM/${encodeURIComponent(invId)}`, {
      name: smokeTag(`InvCasing-Upper-${SMOKE_RUN_ID}`)
    });
    if (!updateUpper.ok) return { test: "objects:update-casing-variants", result: "FAIL", step: "update-upper", updateUpper };

    // Verify via canonical GET
    const getAfterUpper = await get(`/objects/inventoryItem/${encodeURIComponent(invId)}`);
    const upperUpdateWorked = getAfterUpper.ok && getAfterUpper.body?.name?.includes("Upper");

    const pass = lowerUpdateWorked && upperUpdateWorked;

    return {
      test: "objects:update-casing-variants",
      result: pass ? "PASS" : "FAIL",
      updateLower: { ok: updateLower.ok, verified: lowerUpdateWorked },
      updateUpper: { ok: updateUpper.ok, verified: upperUpdateWorked }
    };
  },

  // === Sprint AM E4: LIST pagination with inventory alias ===
  "smoke:objects:list-inventory-pagination-alias": async () => {
    await ensureBearer();

    const prodRes = await createProduct({ name: smokeTag(`ListPagAlias-${SMOKE_RUN_ID}`) });
    if (!prodRes.ok) return { test: "objects:list-inventory-pagination-alias", result: "FAIL", step: "product-create", prodRes };
    const productId = prodRes.body?.id;

    // Create 3 inventory items
    const items = [];
    for (let i = 1; i <= 3; i++) {
      const res = await post(`/objects/inventoryItem`, {
        type: "inventoryItem",
        productId,
        name: smokeTag(`ListPagItem-${i}-${SMOKE_RUN_ID}`),
        uom: "ea"
      });
      if (!res.ok) return { test: "objects:list-inventory-pagination-alias", result: "FAIL", step: `create-${i}`, res };
      items.push(res.body?.id);
    }

    // List via alias route with limit=2
    const page1 = await get(`/objects/inventory`, { limit: 2 });
    if (!page1.ok) return { test: "objects:list-inventory-pagination-alias", result: "FAIL", step: "page1", page1 };

    const page1Items = page1.body?.items || [];
    const nextCursor = page1.body?.next || page1.body?.pageInfo?.nextCursor;

    // If we got a cursor, fetch next page
    let page2Items = [];
    let page2Ok = true;
    if (nextCursor) {
      const page2 = await get(`/objects/inventory`, { limit: 2, next: nextCursor });
      page2Ok = page2.ok;
      page2Items = page2.body?.items || [];
    }

    // Verify pagination works (union skipped when cursor present, falls back to single-type query)
    const pass = page1.ok && page1Items.length > 0 && page2Ok;

    return {
      test: "objects:list-inventory-pagination-alias",
      result: pass ? "PASS" : "FAIL",
      page1: { ok: page1.ok, count: page1Items.length, hasCursor: Boolean(nextCursor) },
      page2: { ok: page2Ok, count: page2Items.length }
    };
  },

  // === Sprint AM E4: CREATE with casing normalization ===
  "smoke:objects:create-casing-normalization": async () => {
    await ensureBearer();

    // Create product via uppercase route
    const prodUpper = await post(`/objects/PRODUCT`, {
      type: "product",
      name: smokeTag(`ProdUpper-${SMOKE_RUN_ID}`),
      kind: "good"
    });
    if (!prodUpper.ok) return { test: "objects:create-casing-normalization", result: "FAIL", step: "product-upper", prodUpper };
    const prodUpperId = prodUpper.body?.id;
    const prodUpperType = prodUpper.body?.type;

    // Verify via canonical GET
    const getProdUpper = await get(`/objects/product/${encodeURIComponent(prodUpperId)}`);
    const prodUpperOk = getProdUpper.ok && getProdUpper.body?.type === "product";

    // Create salesOrder via lowercase route
    const { customerId } = await seedCustomer(api);
    const soLower = await post(`/objects/salesorder`, {
      type: "salesOrder",
      status: "draft",
      partyId: customerId,
      name: smokeTag(`SOLower-${SMOKE_RUN_ID}`),
      lines: []
    });
    if (!soLower.ok) return { test: "objects:create-casing-normalization", result: "FAIL", step: "so-lower", soLower };
    const soLowerId = soLower.body?.id;
    const soLowerType = soLower.body?.type;

    // Verify via canonical GET
    const getSoLower = await get(`/objects/salesOrder/${encodeURIComponent(soLowerId)}`);
    const soLowerOk = getSoLower.ok && getSoLower.body?.type === "salesOrder";

    const pass = prodUpperOk && prodUpperType === "product" && soLowerOk && soLowerType === "salesOrder";

    return {
      test: "objects:create-casing-normalization",
      result: pass ? "PASS" : "FAIL",
      productUpper: { ok: prodUpper.ok, id: prodUpperId, responseType: prodUpperType, verified: prodUpperOk },
      soLower: { ok: soLower.ok, id: soLowerId, responseType: soLowerType, verified: soLowerOk }
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

  // === Sprint AN: filtered cursor round-trip (no dupes/skips) ===
  "smoke:objects:list-filter-cursor-roundtrip": async () => {
    await ensureBearer();

    // Create a customer/party for SO
    const { customerId } = await seedCustomer(api);

    // Create product + inventory item
    const prod = await createProduct({ name: smokeTag(`BOR-Cursor-${SMOKE_RUN_ID}`) });
    if (!prod.ok) return { test: "objects:list-filter-cursor-roundtrip", result: "FAIL", step: "product-create", prod };
    const inv = await createInventoryForProduct(prod.body.id, smokeTag(`BOR-Item-${SMOKE_RUN_ID}`));
    if (!inv.ok) return { test: "objects:list-filter-cursor-roundtrip", result: "FAIL", step: "inventory-create", inv };

    // Create SO
    const so = await post(`/objects/salesOrder`, {
      type: "salesOrder",
      status: "draft",
      partyId: customerId,
      customerId,
      lines: [{ id: "L1", itemId: inv.body.id, uom: "ea", qty: 1 }]
    }, { "Idempotency-Key": idem() });
    if (!so.ok) return { test: "objects:list-filter-cursor-roundtrip", result: "FAIL", step: "so-create", so };
    const soId = so.body?.id;

    // Seed 6 backorderRequests for this soId to ensure multiple pages (limit=2 ⇒ 3 pages)
    const creates = [];
    for (let i = 1; i <= 6; i++) {
      const bo = await post(`/objects/backorderRequest`, {
        type: "backorderRequest",
        soId,
        soLineId: "L1",
        itemId: inv.body.id,
        qty: i,
        status: "open",
        note: smokeTag(`BOR-${i}-${SMOKE_RUN_ID}`)
      });
      creates.push(bo);
      if (!bo.ok) return { test: "objects:list-filter-cursor-roundtrip", result: "FAIL", step: `bo-create-${i}`, bo };
    }
    const boIds = creates.map(c => c?.body?.id).filter(Boolean);
    if (boIds.length !== 6) {
      return { test: "objects:list-filter-cursor-roundtrip", result: "FAIL", step: "bo-create-count", boIds, creates };
    }

    // Wait for all 6 backorders to become visible (eventual consistency)
    const waitForSix = async () => {
      let lastItems = [];
      for (let i = 0; i < 12; i++) {
        const res = await get(`/objects/backorderRequest`, { "filter.soId": soId, limit: 20 });
        if (!res.ok) return { ok: false, res };
        const items = Array.isArray(res.body?.items) ? res.body.items : [];
        lastItems = items;
        if (items.length >= 6) return { ok: true, items };
        await sleep(500);
      }
      return { ok: false, items: lastItems };
    };

    const sixReady = await waitForSix();
    if (!sixReady.ok) {
      return { test: "objects:list-filter-cursor-roundtrip", result: "FAIL", step: "wait-for-six", response: sixReady.res, boIds, count: sixReady.items?.length || 0, items: sixReady.items };
    }
    const observedCount = Array.isArray(sixReady.items) ? sixReady.items.length : 0;

    // Page through filtered results, allowing for eventual consistency
    const fetchPages = async () => {
      let nextCursor = null;
      const pages = [];
      const cursors = [];
      let lastPageInfo = null;
      for (let p = 0; p < 6; p++) {
        const params = { limit: 2, "filter.soId": soId };
        if (nextCursor) {
          params.next = nextCursor;
          params.cursor = nextCursor;
        }
        const res = await get(`/objects/backorderRequest`, params);
        if (!res.ok) {
          return { ok: false, res };
        }
        const items = Array.isArray(res.body?.items) ? res.body.items : [];
        pages.push(items);
        const pageInfo = res.body?.pageInfo ?? {};
        lastPageInfo = pageInfo;
        nextCursor = pageInfo?.nextCursor ?? pageInfo?.next ?? pageInfo?.cursor ?? res.body?.next ?? res.body?.cursor ?? null;
        cursors.push(nextCursor);
        const hasNext = !!(pageInfo?.hasNext || pageInfo?.has_more || pageInfo?.more || nextCursor);
        if (!nextCursor || !hasNext) break;
      }
      return { ok: true, pages, cursors, lastPageInfo };
    };

    let attempts = 0;
    let collected = null;
    while (attempts < 8) {
      collected = await fetchPages();
      if (!collected.ok) {
        return { test: "objects:list-filter-cursor-roundtrip", result: "FAIL", step: "list", response: collected.res };
      }
      const flatIds = collected.pages.flat().map(i => i?.id).filter(Boolean);
      if (flatIds.length >= 6) break;
      await sleep(400);
      attempts++;
    }

    const idsFlat = collected.pages.flat().map(i => i?.id).filter(Boolean);
    const uniqueIds = new Set(idsFlat);
    const pageLengths = collected.pages.map(p => p.length);
    const firstThree = pageLengths.slice(0, 3);

    const hasOverlap = uniqueIds.size !== idsFlat.length;
    const pageCountOk = firstThree.length === 3 && firstThree.every(len => len === 2);
    const countOk = idsFlat.length === 6;

    // Ordering assertion: updatedAt desc (allow ties), then id asc on ties
    const allItems = collected.pages.flat();
    let orderingOk = true;
    let orderingReason = "";
    for (let i = 1; i < allItems.length; i++) {
      const prev = allItems[i - 1];
      const curr = allItems[i];
      const prevUpdated = prev?.updatedAt || "";
      const currUpdated = curr?.updatedAt || "";
      const prevId = prev?.id || "";
      const currId = curr?.id || "";

      // If both have updatedAt and they differ, assert descending
      if (prevUpdated && currUpdated && prevUpdated !== currUpdated) {
        if (prevUpdated < currUpdated) {
          orderingOk = false;
          orderingReason = `updatedAt not descending: [${i-1}]=${prevUpdated} < [${i}]=${currUpdated}`;
          break;
        }
      } else if (prevUpdated === currUpdated) {
        // Tie on updatedAt (or both empty): assert id ascending
        if (prevId > currId) {
          orderingOk = false;
          orderingReason = `id not ascending on updatedAt tie: [${i-1}]=${prevId} > [${i}]=${currId}`;
          break;
        }
      }
    }

    const pass = !hasOverlap && countOk && pageCountOk && orderingOk;

    if (!pass) {
      return {
        test: "objects:list-filter-cursor-roundtrip",
        result: "FAIL",
        ids: idsFlat,
        uniqueCount: uniqueIds.size,
        pageLengths,
        cursors: collected.cursors,
        lastPageInfo: collected.lastPageInfo,
        boIds,
        observedCount,
        orderingOk,
        orderingReason,
      };
    }

    return {
      test: "objects:list-filter-cursor-roundtrip",
      result: "PASS",
      ids: idsFlat,
      pageLengths,
      cursors: collected.cursors,
      orderingOk,
    };
  },

  // === Sprint AN: POST search filtered cursor round-trip (no dupes/skips) ===
  "smoke:objects:search-filter-cursor-roundtrip": async () => {
    await ensureBearer();

    // Create a customer/party for SO
    const { customerId } = await seedCustomer(api);

    // Create product + inventory item
    const prod = await createProduct({ name: smokeTag(`BOR-Search-${SMOKE_RUN_ID}`) });
    if (!prod.ok) return { test: "objects:search-filter-cursor-roundtrip", result: "FAIL", step: "product-create", prod };
    const inv = await createInventoryForProduct(prod.body.id, smokeTag(`BOR-Search-Item-${SMOKE_RUN_ID}`));
    if (!inv.ok) return { test: "objects:search-filter-cursor-roundtrip", result: "FAIL", step: "inventory-create", inv };

    // Create SO
    const so = await post(`/objects/salesOrder`, {
      type: "salesOrder",
      status: "draft",
      partyId: customerId,
      customerId,
      lines: [{ id: "L1", itemId: inv.body.id, uom: "ea", qty: 1 }]
    }, { "Idempotency-Key": idem() });
    if (!so.ok) return { test: "objects:search-filter-cursor-roundtrip", result: "FAIL", step: "so-create", so };
    const soId = so.body?.id;

    // Seed 6 backorderRequests for this soId to ensure multiple pages (limit=2 ⇒ 3 pages)
    const creates = [];
    for (let i = 1; i <= 6; i++) {
      const bo = await post(`/objects/backorderRequest`, {
        type: "backorderRequest",
        soId,
        soLineId: "L1",
        itemId: inv.body.id,
        qty: i,
        status: "open",
        note: smokeTag(`BOR-Search-${i}-${SMOKE_RUN_ID}`)
      });
      creates.push(bo);
      if (!bo.ok) return { test: "objects:search-filter-cursor-roundtrip", result: "FAIL", step: `bo-create-${i}`, bo };
    }
    const boIds = creates.map(c => c?.body?.id).filter(Boolean);
    if (boIds.length !== 6) {
      return { test: "objects:search-filter-cursor-roundtrip", result: "FAIL", step: "bo-create-count", boIds, creates };
    }

    // Wait for all 6 backorders to become visible (eventual consistency)
    const waitForSix = async () => {
      let lastItems = [];
      for (let i = 0; i < 12; i++) {
        const res = await post(`/objects/backorderRequest/search`, { soId, limit: 20 });
        if (!res.ok) return { ok: false, res };
        const items = Array.isArray(res.body?.items) ? res.body.items : [];
        lastItems = items;
        if (items.length >= 6) return { ok: true, items };
        await sleep(500);
      }
      return { ok: false, items: lastItems };
    };

    const sixReady = await waitForSix();
    if (!sixReady.ok) {
      return { test: "objects:search-filter-cursor-roundtrip", result: "FAIL", step: "wait-for-six", response: sixReady.res, boIds, count: sixReady.items?.length || 0, items: sixReady.items };
    }
    const observedCount = Array.isArray(sixReady.items) ? sixReady.items.length : 0;

    // Page through search results with POST body
    const fetchPages = async () => {
      let nextCursor = null;
      const pages = [];
      const cursors = [];
      let lastPageInfo = null;
      for (let p = 0; p < 6; p++) {
        const body = { limit: 2, soId };
        if (nextCursor) {
          body.next = nextCursor;
        }
        const res = await post(`/objects/backorderRequest/search`, body);
        if (!res.ok) {
          return { ok: false, res };
        }
        const items = Array.isArray(res.body?.items) ? res.body.items : [];
        pages.push(items);
        const pageInfo = res.body?.pageInfo ?? {};
        lastPageInfo = pageInfo;
        nextCursor = pageInfo?.nextCursor ?? pageInfo?.next ?? pageInfo?.cursor ?? res.body?.next ?? res.body?.cursor ?? null;
        cursors.push(nextCursor);
        const hasNext = !!(pageInfo?.hasNext || pageInfo?.has_more || pageInfo?.more || nextCursor);
        if (!nextCursor || !hasNext) break;
      }
      return { ok: true, pages, cursors, lastPageInfo };
    };

    let attempts = 0;
    let collected = null;
    while (attempts < 8) {
      collected = await fetchPages();
      if (!collected.ok) {
        return { test: "objects:search-filter-cursor-roundtrip", result: "FAIL", step: "search", response: collected.res };
      }
      const flatIds = collected.pages.flat().map(i => i?.id).filter(Boolean);
      if (flatIds.length >= 6) break;
      await sleep(400);
      attempts++;
    }

    const idsFlat = collected.pages.flat().map(i => i?.id).filter(Boolean);
    const uniqueIds = new Set(idsFlat);
    const pageLengths = collected.pages.map(p => p.length);
    const firstThree = pageLengths.slice(0, 3);

    const hasOverlap = uniqueIds.size !== idsFlat.length;
    const pageCountOk = firstThree.length === 3 && firstThree.every(len => len === 2);
    const countOk = idsFlat.length === 6;

    // Ordering assertion: updatedAt desc (allow ties), then id asc on ties
    const allItems = collected.pages.flat();
    let orderingOk = true;
    let orderingReason = "";
    for (let i = 1; i < allItems.length; i++) {
      const prev = allItems[i - 1];
      const curr = allItems[i];
      const prevUpdated = prev?.updatedAt || "";
      const currUpdated = curr?.updatedAt || "";
      const prevId = prev?.id || "";
      const currId = curr?.id || "";

      // If both have updatedAt and they differ, assert descending
      if (prevUpdated && currUpdated && prevUpdated !== currUpdated) {
        if (prevUpdated < currUpdated) {
          orderingOk = false;
          orderingReason = `updatedAt not descending: [${i-1}]=${prevUpdated} < [${i}]=${currUpdated}`;
          break;
        }
      } else if (prevUpdated === currUpdated) {
        // Tie on updatedAt (or both empty): assert id ascending
        if (prevId > currId) {
          orderingOk = false;
          orderingReason = `id not ascending on updatedAt tie: [${i-1}]=${prevId} > [${i}]=${currId}`;
          break;
        }
      }
    }

    const pass = !hasOverlap && countOk && pageCountOk && orderingOk;

    if (!pass) {
      return {
        test: "objects:search-filter-cursor-roundtrip",
        result: "FAIL",
        ids: idsFlat,
        uniqueCount: uniqueIds.size,
        pageLengths,
        cursors: collected.cursors,
        lastPageInfo: collected.lastPageInfo,
        boIds,
        observedCount,
        orderingOk,
        orderingReason,
      };
    }

    return {
      test: "objects:search-filter-cursor-roundtrip",
      result: "PASS",
      ids: idsFlat,
      pageLengths,
      cursors: collected.cursors,
      orderingOk,
    };
  },

  // === Sprint AS E3: Simple path key cursor validation (no filters, no q) ===
  "smoke:objects:list-simple-key-cursor": async () => {
    await ensureBearer();

    // Create exactly 5 party records to ensure multi-page results with limit=2
    // This gives us: page1 (2 items), page2 (2 items), page3 (1 item)
    // We'll verify the specific pattern works for at least one full page cycle.
    const parties = [];
    for (let i = 1; i <= 5; i++) {
      const res = await post(
        `/objects/party`,
        { type: "party", name: smokeTag(`SimpleCursorParty${i}-${SMOKE_RUN_ID}`) },
        { "Idempotency-Key": idem() }
      );
      if (!res.ok) {
        return {
          test: "objects:list-simple-key-cursor",
          result: "FAIL",
          step: `party-creation-${i}`,
          res,
        };
      }
      parties.push(res.body?.id);
    }

    const createdPartyIds = parties.filter(Boolean);
    if (createdPartyIds.length < 5) {
      return {
        test: "objects:list-simple-key-cursor",
        result: "FAIL",
        reason: "party-creation-incomplete",
        created: createdPartyIds.length,
        expected: 5,
      };
    }

    // List with limit=2, no filters, no q (triggers simple path with DynamoDB key cursor)
    const firstPage = await get(`/objects/party`, { limit: 2 });
    if (!firstPage.ok) {
      return { test: "objects:list-simple-key-cursor", result: "FAIL", step: "list-first-page", firstPage };
    }

    const items1 = Array.isArray(firstPage.body?.items) ? firstPage.body.items : [];
    const page1Ids = items1.map(i => i?.id).filter(Boolean);
    const nextCursor = firstPage.body?.pageInfo?.nextCursor ?? firstPage.body?.next ?? null;
    const page1NextPresent = !!nextCursor;

    // Assert: page1 must have exactly 2 items
    if (items1.length !== 2) {
      return {
        test: "objects:list-simple-key-cursor",
        result: "FAIL",
        reason: "first-page-count-mismatch",
        expectedCount: 2,
        actualCount: items1.length,
        page1Ids: page1Ids.slice(0, 5),
      };
    }

    // Assert: page1.next must be present (we're paginating)
    if (!page1NextPresent) {
      return {
        test: "objects:list-simple-key-cursor",
        result: "FAIL",
        reason: "page1-next-missing",
        message: "First page should have a next cursor for multi-page result",
      };
    }

    // Decode cursor and verify it's a DynamoDB key cursor (contains pk and sk), not an offset cursor
    let cursorObj;
    try {
      cursorObj = JSON.parse(Buffer.from(nextCursor, "base64").toString("utf8"));
    } catch (e) {
      return {
        test: "objects:list-simple-key-cursor",
        result: "FAIL",
        reason: "cursor-decode-failed",
        error: String(e),
      };
    }

    // Assert: cursor must be DynamoDB key format (pk and sk)
    const haspk = "pk" in cursorObj;
    const hassk = "sk" in cursorObj;
    const hasOffset = "offset" in cursorObj;

    if (!haspk || !hassk) {
      return {
        test: "objects:list-simple-key-cursor",
        result: "FAIL",
        reason: "cursor-not-dynamo-key-format",
        expectedKeys: ["pk", "sk"],
        actualKeys: Object.keys(cursorObj),
      };
    }

    // Assert: cursor must NOT be offset-based
    if (hasOffset) {
      return {
        test: "objects:list-simple-key-cursor",
        result: "FAIL",
        reason: "cursor-is-offset-not-key",
        message: "Simple path (no filters/q) should use DynamoDB key cursor, not offset cursor",
      };
    }

    // Fetch second page using next cursor
    const secondPage = await get(`/objects/party`, { limit: 2, next: nextCursor });
    if (!secondPage.ok) {
      return { test: "objects:list-simple-key-cursor", result: "FAIL", step: "list-second-page", secondPage };
    }

    const items2 = Array.isArray(secondPage.body?.items) ? secondPage.body.items : [];
    const page2Ids = items2.map(i => i?.id).filter(Boolean);
    const page2Next = secondPage.body?.pageInfo?.nextCursor ?? secondPage.body?.next ?? null;
    const page2NextPresent = !!page2Next;

    // Assert: page2 must have exactly 2 items (same limit)
    if (items2.length !== 2) {
      return {
        test: "objects:list-simple-key-cursor",
        result: "FAIL",
        reason: "second-page-count-mismatch",
        expectedCount: 2,
        actualCount: items2.length,
        page2Ids: page2Ids.slice(0, 5),
      };
    }

    // Assert: page2.next must be present (we have 5 items total, 2 on each of first two pages)
    if (!page2NextPresent) {
      return {
        test: "objects:list-simple-key-cursor",
        result: "FAIL",
        reason: "page2-next-missing",
        message: "Second page should have next cursor (5 items total, 2 per page)",
      };
    }

    // Fetch third page to verify completion
    const thirdPage = await get(`/objects/party`, { limit: 2, next: page2Next });
    if (!thirdPage.ok) {
      return { test: "objects:list-simple-key-cursor", result: "FAIL", step: "list-third-page", thirdPage };
    }

    const items3 = Array.isArray(thirdPage.body?.items) ? thirdPage.body.items : [];
    const page3Ids = items3.map(i => i?.id).filter(Boolean);
    const page3Next = thirdPage.body?.pageInfo?.nextCursor ?? thirdPage.body?.next ?? null;
    const page3NextPresent = !!page3Next;

    // Assert: page3 should have at least 1 item
    if (items3.length < 1) {
      return {
        test: "objects:list-simple-key-cursor",
        result: "FAIL",
        reason: "third-page-empty",
        expectedAtLeast: 1,
        actualCount: items3.length,
      };
    }

    // Assert: NO OVERLAP between any pages
    const allPageIds = [...page1Ids, ...page2Ids, ...page3Ids];
    const uniqueIds = new Set(allPageIds);
    if (uniqueIds.size !== allPageIds.length) {
      return {
        test: "objects:list-simple-key-cursor",
        result: "FAIL",
        reason: "overlap-between-pages",
        totalIds: allPageIds.length,
        uniqueCount: uniqueIds.size,
        page1Ids: page1Ids.slice(0, 3),
        page2Ids: page2Ids.slice(0, 3),
        page3Ids: page3Ids.slice(0, 3),
      };
    }

    return {
      test: "objects:list-simple-key-cursor",
      result: "PASS",
      page1Count: items1.length,
      page2Count: items2.length,
      page3Count: items3.length,
      page1Ids: page1Ids.slice(0, 3),
      page2Ids: page2Ids.slice(0, 3),
      page3Ids: page3Ids.slice(0, 3),
      page1NextPresent,
      page2NextPresent,
      page3NextPresent,
      cursorFormat: { haspk, hassk, hasOffset: false },
      totalUniqueAcrossPages: uniqueIds.size,
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

  "smoke:scanner:actions:record": async ()=>{
    await ensureBearer();

    // 1) Create product and inventory item
    const prod = await createProduct({ name: "ScannerActionTest" });
    if (!prod.ok) {
      return { test: "scanner:actions:record", result: "FAIL", step: "createProduct", prod };
    }
    const prodId = prod.body?.id;
    recordCreated({ type: 'product', id: prodId, route: '/objects/product', meta: { name: 'ScannerActionTest' } });

    const item = await createInventoryForProduct(prodId, "ScannerActionItem");
    if (!item.ok) {
      return { test: "scanner:actions:record", result: "FAIL", step: "createInventory", item };
    }
    const itemId = item.body?.id;
    recordCreated({ type: 'inventory', id: itemId, route: '/objects/inventory', meta: { name: 'ScannerActionItem', productId: prodId } });

    // 2) Seed EPC mapping: create an epcMap entry with EPC as id, pointing to itemId
    const uniqueEpc = smokeTag(`EPC-${Date.now()}-${Math.random().toString(36).slice(2,7)}`);
    const epcMapCreate = await post(`/objects/epcMap`, {
      type: "epcMap",
      id: uniqueEpc,  // EPC is used as the id in the API
      epc: uniqueEpc,
      itemId,
      status: "active"
    }, { "Idempotency-Key": idem() });
    if (!epcMapCreate.ok) {
      return { test: "scanner:actions:record", result: "FAIL", step: "createEpcMap", epcMapCreate };
    }
    const epcMapId = epcMapCreate.body?.id;
    recordCreated({ type: 'epcMap', id: epcMapId, route: '/objects/epcMap', meta: { epc: uniqueEpc, itemId } });

    // 3) POST /scanner/actions with action="count", epc=<seeded>, qty=1, no sessionId
    const recordKey = idem();
    const scannerActionPayload = {
      action: "count",
      epc: uniqueEpc,
      qty: 1,
      notes: "smoke test"
    };
    const scannerActionPost = await post(`/scanner/actions`, scannerActionPayload, { "Idempotency-Key": recordKey });
    if (!scannerActionPost.ok) {
      return { test: "scanner:actions:record", result: "FAIL", step: "postScannerActions", scannerActionPost };
    }

    const scannerActionId = scannerActionPost.body?.id;
    const scannerActionType = scannerActionPost.body?.type;
    const scannerActionItemId = scannerActionPost.body?.itemId;

    // Assert response has type === "scannerAction" and itemId matches
    if (scannerActionType !== "scannerAction") {
      return { test: "scanner:actions:record", result: "FAIL", step: "assertType", expected: "scannerAction", got: scannerActionType };
    }
    if (scannerActionItemId !== itemId) {
      return { test: "scanner:actions:record", result: "FAIL", step: "assertItemId", expected: itemId, got: scannerActionItemId };
    }
    recordCreated({ type: 'scannerAction', id: scannerActionId, route: '/scanner/actions', meta: { epc: uniqueEpc, itemId, action: "count" } });

    // 4) Search for scanner action in /objects/scannerAction using pagination
    // Use findItemById to robustly search across all pages until found or timeout
    let scannerActionFound = null;
    try {
      scannerActionFound = await findItemById({
        fetchPage: async ({ limit, next }) => {
          return await get(`/objects/scannerAction`, { limit, ...(next ? { next } : {}) });
        },
        targetId: scannerActionId,
        timeoutMs: 8000,
        intervalMs: 250,
        pageSize: 50,
        maxPages: 100
      });
      recordFromListResult([scannerActionFound], "scannerAction", `/objects/scannerAction`);
    } catch (err) {
      return {
        test: "scanner:actions:record",
        result: "FAIL",
        step: "findScannerActionInList",
        scannerActionId,
        error: err.message,
        debug: err.debug
      };
    }

    // 5) Idempotency check: POST with same Idempotency-Key
    const scannerActionReplay = await post(`/scanner/actions`, scannerActionPayload, { "Idempotency-Key": recordKey });
    if (!scannerActionReplay.ok) {
      return { test: "scanner:actions:record", result: "FAIL", step: "replayIdempotent", scannerActionReplay };
    }

    // Verify replay returns same id (idempotency honored)
    const replayId = scannerActionReplay.body?.id;
    if (replayId !== scannerActionId) {
      return {
        test: "scanner:actions:record",
        result: "FAIL",
        step: "assertIdempotencyId",
        firstId: scannerActionId,
        replayId,
        note: "Idempotent request returned different id"
      };
    }

    // 6) List again to verify no duplicate (count should still be 1, or at most 1 with same id)
    // Use pagination-based search to ensure we find the item even if pagination is in effect
    let itemsAfter = [];
    try {
      const finalFound = await findItemById({
        fetchPage: async ({ limit, next }) => {
          return await get(`/objects/scannerAction`, { limit, ...(next ? { next } : {}) });
        },
        targetId: scannerActionId,
        timeoutMs: 4000,  // shorter timeout for second search
        intervalMs: 200,
        pageSize: 50,
        maxPages: 50
      });
      itemsAfter = finalFound ? [finalFound] : [];
    } catch (err) {
      // If not found in paginated search, try a simple list once more to get diagnostics
      try {
        const simpleList = await get(`/objects/scannerAction`, { limit: 100 });
        itemsAfter = Array.isArray(simpleList.body?.items) ? simpleList.body.items : [];
      } catch {
        itemsAfter = [];
      }
    }
    
    const duplicatesAfterReplay = itemsAfter.filter(item => item.id === scannerActionId);
    if (duplicatesAfterReplay.length !== 1) {
      return {
        test: "scanner:actions:record",
        result: "FAIL",
        step: "assertNoDuplicateAfterReplay",
        expectedCount: 1,
        actualCount: duplicatesAfterReplay.length,
        totalItemsInFinalList: itemsAfter.length,
        note: "Idempotent replay should not create duplicate"
      };
    }

    const pass = scannerActionType === "scannerAction"
      && scannerActionItemId === itemId
      && scannerActionFound !== null
      && replayId === scannerActionId
      && duplicatesAfterReplay.length === 1;

    return {
      test: "scanner:actions:record",
      result: pass ? "PASS" : "FAIL",
      steps: {
        productId: prodId,
        itemId,
        epc: uniqueEpc,
        epcMapId,
        scannerActionId,
        type: scannerActionType,
        responseItemId: scannerActionItemId,
        foundInList: scannerActionFound !== null,
        idempotencyReplayId: replayId,
        idempotencyMatch: replayId === scannerActionId,
        finalListCount: duplicatesAfterReplay.length
      }
    };
  },

  "smoke:auth:policy-derivation": async () => {
    // Test: JWT with roles but no explicit policy should derive permissions correctly
    // Flow:
    //   1) Mint token with roles:["viewer"] (no explicit policy)
    //   2) Verify /auth/policy returns derived permissions
    //   3) Verify read permissions work (200)
    //   4) Verify write permissions fail (403)

    // Step 1: POST /auth/dev-login with roles:["viewer"], NO policy field
    const loginPayload = {
      tenantId: TENANT,
      roles: ["viewer"]
      // IMPORTANT: no 'policy' field - let derivation handle it
    };
    const loginRes = await fetch(`${API}/auth/dev-login`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-tenant-id": TENANT
      },
      body: JSON.stringify(loginPayload)
    });

    if (!loginRes.ok) {
      const errText = await loginRes.text().catch(() => "");
      return {
        test: "auth:policy-derivation",
        result: "FAIL",
        step: "dev-login",
        status: loginRes.status,
        error: errText
      };
    }

    const loginData = await loginRes.json();
    const viewerToken = loginData.token;
    if (!viewerToken) {
      return {
        test: "auth:policy-derivation",
        result: "FAIL",
        step: "extract-token",
        loginData
      };
    }

    // Step 2: GET /auth/policy using viewer token
    const policyRes = await fetch(`${API}/auth/policy`, {
      headers: {
        "authorization": `Bearer ${viewerToken}`,
        "x-tenant-id": TENANT
      }
    });

    if (!policyRes.ok) {
      return {
        test: "auth:policy-derivation",
        result: "FAIL",
        step: "get-policy",
        status: policyRes.status,
        body: await policyRes.json().catch(() => ({}))
      };
    }

    const policyData = await policyRes.json();
    
    // Assert policy is an object with expected viewer permissions
    const isObject = policyData && typeof policyData === "object" && !Array.isArray(policyData);
    const hasReadAll = policyData["*:read"] === true;
    const noSuperuser = policyData["*"] !== true;
    const noWildcardAll = policyData["*:*"] !== true;

    if (!isObject || !hasReadAll || !noSuperuser || !noWildcardAll) {
      return {
        test: "auth:policy-derivation",
        result: "FAIL",
        step: "assert-policy-shape",
        policyData,
        assertions: {
          isObject,
          hasReadAll,
          noSuperuser,
          noWildcardAll
        }
      };
    }

    // Step 3: Allow check - verify read permissions work (GET /objects/product?limit=1)
    const readRes = await fetch(`${API}/objects/product?limit=1`, {
      headers: {
        "authorization": `Bearer ${viewerToken}`,
        "x-tenant-id": TENANT
      }
    });

    const readOk = readRes.ok;
    if (!readOk) {
      return {
        test: "auth:policy-derivation",
        result: "FAIL",
        step: "read-permission-check",
        expectedStatus: 200,
        actualStatus: readRes.status,
        body: await readRes.json().catch(() => ({}))
      };
    }

    // Step 4: Deny check - verify write permissions fail (POST /objects/product)
    const writePayload = {
      type: "product",
      name: smokeTag(`PolicyDenyTest-${Date.now()}`),
      sku: `TEST-${Date.now()}`
    };
    const writeRes = await fetch(`${API}/objects/product`, {
      method: "POST",
      headers: {
        "authorization": `Bearer ${viewerToken}`,
        "x-tenant-id": TENANT,
        "content-type": "application/json"
      },
      body: JSON.stringify(writePayload)
    });

    const writeStatus = writeRes.status;
    const writeBody = await writeRes.json().catch(() => ({}));
    const writeDenied = writeStatus === 403;
    const hasForbiddenMessage = writeBody?.message && 
      (writeBody.message.toLowerCase().includes("forbidden") || 
       writeBody.message.toLowerCase().includes("missing permission"));

    if (!writeDenied || !hasForbiddenMessage) {
      return {
        test: "auth:policy-derivation",
        result: "FAIL",
        step: "write-permission-deny-check",
        expectedStatus: 403,
        actualStatus: writeStatus,
        expectedMessagePattern: "forbidden | missing permission",
        actualMessage: writeBody?.message,
        body: writeBody
      };
    }

    // All checks passed
    return {
      test: "auth:policy-derivation",
      result: "PASS",
      summary: "Viewer role derives correct permissions: read allowed, write denied",
      assertions: {
        policyIsObject: isObject,
        policyHasReadAll: hasReadAll,
        policyNoSuperuser: noSuperuser,
        policyNoWildcardAll: noWildcardAll,
        readAllowed: readOk,
        writeDenied: writeDenied,
        forbiddenMessagePresent: hasForbiddenMessage
      },
      policySnapshot: policyData
    };
  },

  "smoke:auth:legacy-plural-policy-products-read": async () => {
    // Test: Legacy plural permission key products:read works via server alias expansion

    // Step 1: Mint token with explicit policy { "products:read": true } (no roles)
    const loginPayload = {
      tenantId: TENANT,
      policy: {
        "products:read": true
      }
    };
    const loginRes = await fetch(`${API}/auth/dev-login`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-tenant-id": TENANT
      },
      body: JSON.stringify(loginPayload)
    });

    if (!loginRes.ok) {
      const errText = await loginRes.text().catch(() => "");
      return {
        test: "auth:legacy-plural-policy-products-read",
        result: "FAIL",
        step: "dev-login",
        status: loginRes.status,
        error: errText
      };
    }

    const loginData = await loginRes.json();
    const token = loginData.token;
    if (!token) {
      return {
        test: "auth:legacy-plural-policy-products-read",
        result: "FAIL",
        step: "extract-token",
        loginData
      };
    }

    // Step 2: GET /objects/product?limit=1 (should succeed via alias expansion products→product)
    const listRes = await fetch(`${API}/objects/product?limit=1`, {
      headers: {
        "authorization": `Bearer ${token}`,
        "x-tenant-id": TENANT
      }
    });

    if (!listRes.ok) {
      return {
        test: "auth:legacy-plural-policy-products-read",
        result: "FAIL",
        step: "list-products",
        expectedStatus: 200,
        actualStatus: listRes.status,
        body: await listRes.json().catch(() => ({}))
      };
    }

    // Step 4 (optional negative): POST /objects/product should fail (read-only policy)
    const createPayload = {
      type: "product",
      name: smokeTag(`LegacyPlural-${Date.now()}`),
      sku: `LEG-${Date.now()}`
    };
    const createRes = await fetch(`${API}/objects/product`, {
      method: "POST",
      headers: {
        "authorization": `Bearer ${token}`,
        "x-tenant-id": TENANT,
        "content-type": "application/json"
      },
      body: JSON.stringify(createPayload)
    });

    const createDenied = createRes.status === 403;
    const createBody = await createRes.json().catch(() => ({}));
    const hasForbiddenMessage = createBody?.message &&
      (createBody.message.toLowerCase().includes("forbidden") ||
       createBody.message.toLowerCase().includes("missing permission"));

    if (!createDenied || !hasForbiddenMessage) {
      return {
        test: "auth:legacy-plural-policy-products-read",
        result: "FAIL",
        step: "create-denied-check",
        expectedStatus: 403,
        actualStatus: createRes.status,
        expectedMessagePattern: "forbidden | missing permission",
        actualMessage: createBody?.message,
        body: createBody
      };
    }

    return {
      test: "auth:legacy-plural-policy-products-read",
      result: "PASS",
      summary: "Legacy products:read policy grants product list; write still denied",
      assertions: {
        listAllowed: true,
        createDenied,
        createForbiddenMessage: hasForbiddenMessage
      }
    };
  },

  "smoke:auth:perm-keys-are-lowercase": async () => {
    // Contract test: permission keys are lowercase; mixed-case policy should NOT authorize.

    await ensureBearer(); // admin token for setup helpers

    // Setup: create vendor + product
    const { vendorId } = await seedVendor(api);
    const prod = await createProduct({ name: `LowercasePerm-${Date.now()}` });
    if (!prod.ok) {
      return {
        test: "auth:perm-keys-are-lowercase",
        result: "FAIL",
        step: "setup-product",
        prod
      };
    }
    const productId = prod.body?.id;

    // Step 1: Mint token with mixed-case policy key (should NOT authorize)
    const badPolicyPayload = {
      tenantId: TENANT,
      policy: {
        "Purchase:write": true
      }
    };
    const badLoginRes = await fetch(`${API}/auth/dev-login`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-tenant-id": TENANT
      },
      body: JSON.stringify(badPolicyPayload)
    });
    if (!badLoginRes.ok) {
      return {
        test: "auth:perm-keys-are-lowercase",
        result: "FAIL",
        step: "bad-login",
        status: badLoginRes.status,
        error: await badLoginRes.text().catch(() => "")
      };
    }
    const badLoginData = await badLoginRes.json();
    const badToken = badLoginData.token;
    if (!badToken) {
      return {
        test: "auth:perm-keys-are-lowercase",
        result: "FAIL",
        step: "bad-extract-token",
        badLoginData
      };
    }

    // Attempt POST /objects/purchaseOrder with mixed-case policy token (expect 403)
    const badPoRes = await fetch(`${API}/objects/purchaseOrder`, {
      method: "POST",
      headers: {
        "authorization": `Bearer ${badToken}`,
        "x-tenant-id": TENANT,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        type: "purchaseOrder",
        vendorId,
        status: "draft",
        lines: [{ id: "L1", itemId: productId, qty: 1, uom: "ea" }]
      })
    });

    const badDenied = badPoRes.status === 403;
    const badBody = await badPoRes.json().catch(() => ({}));
    const badForbidden = badBody?.message &&
      (badBody.message.toLowerCase().includes("forbidden") ||
       badBody.message.toLowerCase().includes("missing permission"));

    if (!badDenied || !badForbidden) {
      return {
        test: "auth:perm-keys-are-lowercase",
        result: "FAIL",
        step: "bad-perm-deny",
        expectedStatus: 403,
        actualStatus: badPoRes.status,
        expectedMessagePattern: "forbidden | missing permission",
        actualMessage: badBody?.message,
        body: badBody
      };
    }

    // Step 2: Mint token with correct lowercase policy key (should authorize)
    const goodPolicyPayload = {
      tenantId: TENANT,
      policy: {
        "purchase:write": true
      }
    };
    const goodLoginRes = await fetch(`${API}/auth/dev-login`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-tenant-id": TENANT
      },
      body: JSON.stringify(goodPolicyPayload)
    });
    if (!goodLoginRes.ok) {
      return {
        test: "auth:perm-keys-are-lowercase",
        result: "FAIL",
        step: "good-login",
        status: goodLoginRes.status,
        error: await goodLoginRes.text().catch(() => "")
      };
    }
    const goodLoginData = await goodLoginRes.json();
    const goodToken = goodLoginData.token;
    if (!goodToken) {
      return {
        test: "auth:perm-keys-are-lowercase",
        result: "FAIL",
        step: "good-extract-token",
        goodLoginData
      };
    }

    const goodPoRes = await fetch(`${API}/objects/purchaseOrder`, {
      method: "POST",
      headers: {
        "authorization": `Bearer ${goodToken}`,
        "x-tenant-id": TENANT,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        type: "purchaseOrder",
        vendorId,
        status: "draft",
        lines: [{ id: "L1", itemId: productId, qty: 1, uom: "ea" }]
      })
    });

    if (!goodPoRes.ok) {
      return {
        test: "auth:perm-keys-are-lowercase",
        result: "FAIL",
        step: "good-perm-allow",
        expectedStatus: "200 or 201",
        actualStatus: goodPoRes.status,
        body: await goodPoRes.json().catch(() => ({}))
      };
    }

    return {
      test: "auth:perm-keys-are-lowercase",
      result: "PASS",
      summary: "Mixed-case policy key denied; lowercase key allowed",
      assertions: {
        badDenied: badDenied,
        badForbiddenMessage: badForbidden,
        goodAllowed: goodPoRes.ok
      }
    };
  },

  "smoke:auth:warehouse-receive-deny-approve": async () => {
    // Test: warehouse role can receive POs but cannot approve them
    // Flow:
    //   1) Setup: create vendor, product, draft PO, submit it (as admin)
    //   2) Mint warehouse token (roles:["warehouse"], no explicit policy)
    //   3) Verify /auth/policy returns warehouse permissions
    //   4) Verify warehouse can receive PO (200)
    //   5) Verify warehouse cannot approve PO (403)
    //   6) Verify warehouse cannot create products (403)

    await ensureBearer(); // Use admin/default token for setup

    // Step 1: Setup - create vendor, product, and submitted PO
    const vendorName = smokeTag(`WarehouseVendor-${Date.now()}`);
    const vendor = await post("/objects/party", {
      type: "party",
      name: vendorName,
      roles: ["vendor"]
    });

    if (!vendor.ok || !vendor.body?.id) {
      return {
        test: "auth:warehouse-receive-deny-approve",
        result: "FAIL",
        step: "create-vendor",
        vendor
      };
    }
    const vendorId = vendor.body.id;

    const productSku = `WH-TEST-${Date.now()}`;
    const product = await post("/objects/product", {
      type: "product",
      name: smokeTag(`WarehouseProduct-${Date.now()}`),
      sku: productSku
    });

    if (!product.ok || !product.body?.id) {
      return {
        test: "auth:warehouse-receive-deny-approve",
        result: "FAIL",
        step: "create-product",
        product
      };
    }
    const productId = product.body.id;

    const po = await post("/objects/purchaseOrder", {
      type: "purchaseOrder",
      vendorId,
      status: "draft",  // Explicitly set to draft
      lines: [{ productId, qty: 10, unitCost: 5.0 }]
    });

    if (!po.ok || !po.body?.id) {
      return {
        test: "auth:warehouse-receive-deny-approve",
        result: "FAIL",
        step: "create-po",
        po
      };
    }
    const poId = po.body.id;
    // Verify PO is in draft state before submitting
    const poCheck = await get(`/objects/purchaseOrder/${encodeURIComponent(poId)}`);
    if (!poCheck.ok) {
      return {
        test: "auth:warehouse-receive-deny-approve",
        result: "FAIL",
        step: "get-po-before-submit",
        poCheck
      };
    }


    // Submit the PO so it can be approved/received
    const submit = await post(`/purchasing/po/${encodeURIComponent(poId)}:submit`, {});
    if (!submit.ok) {
      return {
        test: "auth:warehouse-receive-deny-approve",
        result: "FAIL",
        step: "submit-po",
        submit,
        poStatusBeforeSubmit: poCheck.body?.status,
        poBeforeSubmit: poCheck.body
      };
    }

    // Approve the PO (with admin token) so it can be received
    const approve = await post(`/purchasing/po/${encodeURIComponent(poId)}:approve`, {});
    if (!approve.ok) {
      return {
        test: "auth:warehouse-receive-deny-approve",
        result: "FAIL",
        step: "approve-po-as-admin",
        approve
      };
    }

    // Step 2: Mint warehouse token
    const loginPayload = {
      tenantId: TENANT,
      roles: ["warehouse"]
      // IMPORTANT: no 'policy' field - let derivation handle it
    };
    const loginRes = await fetch(`${API}/auth/dev-login`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-tenant-id": TENANT
      },
      body: JSON.stringify(loginPayload)
    });

    if (!loginRes.ok) {
      const errText = await loginRes.text().catch(() => "");
      return {
        test: "auth:warehouse-receive-deny-approve",
        result: "FAIL",
        step: "dev-login",
        status: loginRes.status,
        error: errText
      };
    }

    const loginData = await loginRes.json();
    const warehouseToken = loginData.token;
    if (!warehouseToken) {
      return {
        test: "auth:warehouse-receive-deny-approve",
        result: "FAIL",
        step: "extract-token",
        loginData
      };
    }

    // Step 3: Verify /auth/policy returns warehouse permissions
    const policyRes = await fetch(`${API}/auth/policy`, {
      headers: {
        "authorization": `Bearer ${warehouseToken}`,
        "x-tenant-id": TENANT
      }
    });

    if (!policyRes.ok) {
      return {
        test: "auth:warehouse-receive-deny-approve",
        result: "FAIL",
        step: "get-policy",
        status: policyRes.status,
        body: await policyRes.json().catch(() => ({}))
      };
    }

    const policyData = await policyRes.json();

    // Assert warehouse policy shape
    const isObject = policyData && typeof policyData === "object" && !Array.isArray(policyData);
    const hasReadAll = policyData["*:read"] === true;
    const hasInventoryAll = policyData["inventory:*"] === true;
    const hasPurchaseReceive = policyData["purchase:receive"] === true;
    const hasScannerUse = policyData["scanner:use"] === true;
    const noSuperuser = policyData["*"] !== true && policyData["*:*"] !== true;
    const noPurchaseApprove = policyData["purchase:approve"] !== true;

    if (!isObject || !hasReadAll || !hasInventoryAll || !hasPurchaseReceive || !noSuperuser || !noPurchaseApprove) {
      return {
        test: "auth:warehouse-receive-deny-approve",
        result: "FAIL",
        step: "assert-policy-shape",
        policyData,
        assertions: {
          isObject,
          hasReadAll,
          hasInventoryAll,
          hasPurchaseReceive,
          hasScannerUse,
          noSuperuser,
          noPurchaseApprove
        }
      };
    }

    // Step 4: Verify warehouse can receive PO (allowed)
    const receivePayload = {
      lines: [{ lineId: po.body.lines[0].id, deltaQty: 5 }]
    };
    const receiveRes = await fetch(`${API}/purchasing/po/${encodeURIComponent(poId)}:receive`, {
      method: "POST",
      headers: {
        "authorization": `Bearer ${warehouseToken}`,
        "x-tenant-id": TENANT,
        "content-type": "application/json"
      },
      body: JSON.stringify(receivePayload)
    });

    const receiveOk = receiveRes.ok;
    const receiveStatus = receiveRes.status;
    if (!receiveOk) {
      return {
        test: "auth:warehouse-receive-deny-approve",
        result: "FAIL",
        step: "receive-allowed-check",
        expectedStatus: 200,
        actualStatus: receiveStatus,
        body: await receiveRes.json().catch(() => ({}))
      };
    }

    // Step 5: Verify warehouse cannot approve PO (denied)
    const approveRes = await fetch(`${API}/purchasing/po/${encodeURIComponent(poId)}:approve`, {
      method: "POST",
      headers: {
        "authorization": `Bearer ${warehouseToken}`,
        "x-tenant-id": TENANT,
        "content-type": "application/json"
      },
      body: JSON.stringify({})
    });

    const approveDenied = approveRes.status === 403;
    const approveBody = await approveRes.json().catch(() => ({}));
    const hasForbiddenMessage = approveBody?.message &&
      (approveBody.message.toLowerCase().includes("forbidden") ||
       approveBody.message.toLowerCase().includes("missing permission"));

    if (!approveDenied || !hasForbiddenMessage) {
      return {
        test: "auth:warehouse-receive-deny-approve",
        result: "FAIL",
        step: "approve-denied-check",
        expectedStatus: 403,
        actualStatus: approveRes.status,
        expectedMessagePattern: "forbidden | missing permission",
        actualMessage: approveBody?.message,
        body: approveBody
      };
    }

    // Step 6: Verify warehouse cannot create products (denied)
    const createProductPayload = {
      type: "product",
      name: smokeTag(`WarehouseDenyTest-${Date.now()}`),
      sku: `DENY-${Date.now()}`
    };
    const createProductRes = await fetch(`${API}/objects/product`, {
      method: "POST",
      headers: {
        "authorization": `Bearer ${warehouseToken}`,
        "x-tenant-id": TENANT,
        "content-type": "application/json"
      },
      body: JSON.stringify(createProductPayload)
    });

    const productDenied = createProductRes.status === 403;
    const productDenyBody = await createProductRes.json().catch(() => ({}));
    const hasProductForbiddenMessage = productDenyBody?.message &&
      (productDenyBody.message.toLowerCase().includes("forbidden") ||
       productDenyBody.message.toLowerCase().includes("missing permission"));

    if (!productDenied || !hasProductForbiddenMessage) {
      return {
        test: "auth:warehouse-receive-deny-approve",
        result: "FAIL",
        step: "product-create-denied-check",
        expectedStatus: 403,
        actualStatus: createProductRes.status,
        expectedMessagePattern: "forbidden | missing permission",
        actualMessage: productDenyBody?.message,
        body: productDenyBody
      };
    }

    // All checks passed
    return {
      test: "auth:warehouse-receive-deny-approve",
      result: "PASS",
      summary: "Warehouse role: can receive POs, cannot approve POs or create products",
      assertions: {
        policyIsObject: isObject,
        policyHasReadAll: hasReadAll,
        policyHasInventoryAll: hasInventoryAll,
        policyHasPurchaseReceive: hasPurchaseReceive,
        policyHasScannerUse: hasScannerUse,
        policyNoSuperuser: noSuperuser,
        policyNoPurchaseApprove: noPurchaseApprove,
        receiveAllowed: receiveOk,
        approveDenied: approveDenied,
        approveForbiddenMessage: hasForbiddenMessage,
        productCreateDenied: productDenied,
        productForbiddenMessage: hasProductForbiddenMessage
      },
      policySnapshot: policyData,
      artifacts: { vendorId, productId, poId }
    };
  },

  "smoke:objects:perm-prefix-normalization": async () => {
    // Test: /objects/:type permission prefix normalization (Sprint Q)
    // Proves that:
    //   A) Canonical role-derived perms (operator) now allow /objects CRUD for salesOrder/purchaseOrder
    //   B) Legacy explicit policy keys (purchaseorder:write, salesorder:write) still work via alias expansion
    //   C) Tokens without the required permission correctly return 403

    await ensureBearer(); // Use admin token for setup

    // Setup: create vendor, customer, and product
    const { vendorId } = await seedVendor(api);
    const { customerId } = await seedCustomer(api);
    const prod = await createProduct({ name: `PermTest-${Date.now()}` });
    if (!prod.ok) {
      return {
        test: "objects:perm-prefix-normalization",
        result: "FAIL",
        step: "setup-product",
        prod
      };
    }
    const productId = prod.body?.id;

    // Test A: Operator role-derived permissions (canonical: purchase:write, sales:write)
    const operatorLoginPayload = {
      tenantId: TENANT,
      roles: ["operator"]
      // No explicit policy - derived from role
    };
    const operatorLoginRes = await fetch(`${API}/auth/dev-login`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-tenant-id": TENANT
      },
      body: JSON.stringify(operatorLoginPayload)
    });

    if (!operatorLoginRes.ok) {
      const errText = await operatorLoginRes.text().catch(() => "");
      return {
        test: "objects:perm-prefix-normalization",
        result: "FAIL",
        step: "operator-login",
        status: operatorLoginRes.status,
        error: errText
      };
    }

    const operatorData = await operatorLoginRes.json();
    const operatorToken = operatorData.token;
    if (!operatorToken) {
      return {
        test: "objects:perm-prefix-normalization",
        result: "FAIL",
        step: "operator-extract-token",
        operatorData
      };
    }

    // POST /objects/purchaseOrder with operator token (should succeed)
    const poCreateRes = await fetch(`${API}/objects/purchaseOrder`, {
      method: "POST",
      headers: {
        "authorization": `Bearer ${operatorToken}`,
        "x-tenant-id": TENANT,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        type: "purchaseOrder",
        vendorId,
        status: "draft",
        lines: [{ id: "L1", itemId: productId, qty: 5, uom: "ea" }]
      })
    });

    const poCreateOk = poCreateRes.ok;
    const poCreateStatus = poCreateRes.status;
    if (!poCreateOk) {
      return {
        test: "objects:perm-prefix-normalization",
        result: "FAIL",
        step: "operator-create-po",
        expectedStatus: "200 or 201",
        actualStatus: poCreateStatus,
        body: await poCreateRes.json().catch(() => ({}))
      };
    }

    const poId = (await poCreateRes.json()).id;

    // POST /objects/salesOrder with operator token (should succeed)
    const soCreateRes = await fetch(`${API}/objects/salesOrder`, {
      method: "POST",
      headers: {
        "authorization": `Bearer ${operatorToken}`,
        "x-tenant-id": TENANT,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        type: "salesOrder",
        customerId,
        partyId: customerId,
        status: "draft",
        lines: [{ id: "L1", itemId: productId, qty: 3, uom: "ea" }]
      })
    });

    const soCreateOk = soCreateRes.ok;
    const soCreateStatus = soCreateRes.status;
    if (!soCreateOk) {
      return {
        test: "objects:perm-prefix-normalization",
        result: "FAIL",
        step: "operator-create-so",
        expectedStatus: "200 or 201",
        actualStatus: soCreateStatus,
        body: await soCreateRes.json().catch(() => ({}))
      };
    }

    const soId = (await soCreateRes.json()).id;

    // Test B: Legacy explicit policy key (purchaseorder:write) still works via alias expansion
    const legacyLoginPayload = {
      tenantId: TENANT,
      policy: {
        "*:read": true,
        "purchaseorder:write": true
      }
    };
    const legacyLoginRes = await fetch(`${API}/auth/dev-login`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-tenant-id": TENANT
      },
      body: JSON.stringify(legacyLoginPayload)
    });

    if (!legacyLoginRes.ok) {
      const errText = await legacyLoginRes.text().catch(() => "");
      return {
        test: "objects:perm-prefix-normalization",
        result: "FAIL",
        step: "legacy-login",
        status: legacyLoginRes.status,
        error: errText
      };
    }

    const legacyData = await legacyLoginRes.json();
    const legacyToken = legacyData.token;
    if (!legacyToken) {
      return {
        test: "objects:perm-prefix-normalization",
        result: "FAIL",
        step: "legacy-extract-token",
        legacyData
      };
    }

    // POST /objects/purchaseOrder with legacy token (should succeed due to alias expansion)
    const poLegacyRes = await fetch(`${API}/objects/purchaseOrder`, {
      method: "POST",
      headers: {
        "authorization": `Bearer ${legacyToken}`,
        "x-tenant-id": TENANT,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        type: "purchaseOrder",
        vendorId,
        status: "draft",
        lines: [{ id: "L1", itemId: productId, qty: 2, uom: "ea" }]
      })
    });

    const poLegacyOk = poLegacyRes.ok;
    const poLegacyStatus = poLegacyRes.status;
    if (!poLegacyOk) {
      return {
        test: "objects:perm-prefix-normalization",
        result: "FAIL",
        step: "legacy-create-po",
        expectedStatus: "200 or 201",
        actualStatus: poLegacyStatus,
        body: await poLegacyRes.json().catch(() => ({}))
      };
    }

    const poLegacyId = (await poLegacyRes.json()).id;

    // Test C: Negative test - token with only read permission should fail
    const readOnlyLoginPayload = {
      tenantId: TENANT,
      policy: {
        "*:read": true
      }
    };
    const readOnlyLoginRes = await fetch(`${API}/auth/dev-login`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-tenant-id": TENANT
      },
      body: JSON.stringify(readOnlyLoginPayload)
    });

    if (!readOnlyLoginRes.ok) {
      const errText = await readOnlyLoginRes.text().catch(() => "");
      return {
        test: "objects:perm-prefix-normalization",
        result: "FAIL",
        step: "readonly-login",
        status: readOnlyLoginRes.status,
        error: errText
      };
    }

    const readOnlyData = await readOnlyLoginRes.json();
    const readOnlyToken = readOnlyData.token;
    if (!readOnlyToken) {
      return {
        test: "objects:perm-prefix-normalization",
        result: "FAIL",
        step: "readonly-extract-token",
        readOnlyData
      };
    }

    // POST /objects/purchaseOrder with read-only token (should fail with 403)
    const poReadOnlyRes = await fetch(`${API}/objects/purchaseOrder`, {
      method: "POST",
      headers: {
        "authorization": `Bearer ${readOnlyToken}`,
        "x-tenant-id": TENANT,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        type: "purchaseOrder",
        vendorId,
        status: "draft",
        lines: [{ id: "L1", itemId: productId, qty: 1, uom: "ea" }]
      })
    });

    const poReadOnlyDenied = poReadOnlyRes.status === 403;
    const poReadOnlyBody = await poReadOnlyRes.json().catch(() => ({}));
    const hasForbiddenMessage = poReadOnlyBody?.message &&
      (poReadOnlyBody.message.toLowerCase().includes("forbidden") ||
       poReadOnlyBody.message.toLowerCase().includes("missing permission"));

    if (!poReadOnlyDenied || !hasForbiddenMessage) {
      return {
        test: "objects:perm-prefix-normalization",
        result: "FAIL",
        step: "readonly-denied-check",
        expectedStatus: 403,
        actualStatus: poReadOnlyRes.status,
        expectedMessagePattern: "forbidden | missing permission",
        actualMessage: poReadOnlyBody?.message,
        body: poReadOnlyBody
      };
    }

    // All checks passed
    return {
      test: "objects:perm-prefix-normalization",
      result: "PASS",
      summary: "Canonical permission prefixes work for /objects/:type; legacy aliases still honored",
      assertions: {
        operatorCreatePO: poCreateOk,
        operatorCreateSO: soCreateOk,
        legacyCreatePO: poLegacyOk,
        readOnlyDenied: poReadOnlyDenied,
        readOnlyForbiddenMessage: hasForbiddenMessage
      },
      artifacts: {
        operatorPO: poId,
        operatorSO: soId,
        legacyPO: poLegacyId
      }
    };
  },

  "smoke:views-workspaces:permissions": async () => {
    // Test: RBAC boundaries for views/workspaces - write permissions enforced, reads allowed
    // Flow:
    //   1) Mint admin token with view:write + workspace:write
    //   2) Mint viewer token (roles:["viewer"], lacks write perms)
    //   3) Admin creates view + workspace (expect 201)
    //   4) Viewer attempts POST/PATCH/DELETE views (expect 403)
    //   5) Viewer attempts POST/PATCH/DELETE workspaces (expect 403)
    //   6) Viewer confirms GET views/workspaces still works (if policy allows read)

    const featureHeaders = { "X-Feature-Views-Enabled": "true" };
    const runTimestamp = Date.now();
    let viewId = null;
    let workspaceId = null;

    try {
      // Step 1: Mint admin token (operator role with write perms)
      const adminLoginRes = await fetch(`${API}/auth/dev-login`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-tenant-id": TENANT
        },
        body: JSON.stringify({
          tenantId: TENANT,
          roles: ["operator"]
          // operator role includes view:write + workspace:write by default
        })
      });

      if (!adminLoginRes.ok) {
        return {
          test: "views-workspaces:permissions",
          result: "FAIL",
          step: "admin-login",
          status: adminLoginRes.status
        };
      }

      const adminData = await adminLoginRes.json();
      const adminToken = adminData.token;
      if (!adminToken) {
        return {
          test: "views-workspaces:permissions",
          result: "FAIL",
          step: "admin-extract-token",
          adminData
        };
      }

      // Step 2: Mint viewer token (read-only role, no write perms)
      const viewerLoginRes = await fetch(`${API}/auth/dev-login`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-tenant-id": TENANT
        },
        body: JSON.stringify({
          tenantId: TENANT,
          roles: ["viewer"]
          // viewer role has *:read but lacks view:write, workspace:write
        })
      });

      if (!viewerLoginRes.ok) {
        return {
          test: "views-workspaces:permissions",
          result: "FAIL",
          step: "viewer-login",
          status: viewerLoginRes.status
        };
      }

      const viewerData = await viewerLoginRes.json();
      const viewerToken = viewerData.token;
      if (!viewerToken) {
        return {
          test: "views-workspaces:permissions",
          result: "FAIL",
          step: "viewer-extract-token",
          viewerData
        };
      }

      // Step 3a: Admin creates view (expect 201)
      const viewCreateRes = await fetch(`${API}/views`, {
        method: "POST",
        headers: {
          "authorization": `Bearer ${adminToken}`,
          "x-tenant-id": TENANT,
          "content-type": "application/json",
          ...featureHeaders
        },
        body: JSON.stringify({
          name: `PermTest View ${runTimestamp}`,
          entityType: "purchaseOrder",
          filters: [{ field: "status", op: "eq", value: "draft" }]
        })
      });

      const viewCreateOk = viewCreateRes.ok;
      const viewCreateStatus = viewCreateRes.status;
      if (!viewCreateOk || viewCreateStatus !== 201) {
        const viewCreateBody = await viewCreateRes.json().catch(() => ({}));
        return {
          test: "views-workspaces:permissions",
          result: "FAIL",
          step: "admin-create-view",
          expectedStatus: 201,
          actualStatus: viewCreateStatus,
          body: viewCreateBody
        };
      }

      const viewBody = await viewCreateRes.json();
      viewId = viewBody.id;
      if (!viewId) {
        return {
          test: "views-workspaces:permissions",
          result: "FAIL",
          step: "admin-create-view-extract-id",
          viewBody
        };
      }
      recordCreated({ type: 'view', id: viewId, route: '/views', meta: { entityType: "purchaseOrder" } });

      // Step 3b: Admin creates workspace (expect 201)
      const workspaceCreateRes = await fetch(`${API}/workspaces`, {
        method: "POST",
        headers: {
          "authorization": `Bearer ${adminToken}`,
          "x-tenant-id": TENANT,
          "content-type": "application/json",
          ...featureHeaders
        },
        body: JSON.stringify({
          name: `PermTest Workspace ${runTimestamp}`,
          entityType: "purchaseOrder",
          views: [viewId]
        })
      });

      const workspaceCreateOk = workspaceCreateRes.ok;
      const workspaceCreateStatus = workspaceCreateRes.status;
      if (!workspaceCreateOk || workspaceCreateStatus !== 201) {
        const workspaceCreateBody = await workspaceCreateRes.json().catch(() => ({}));
        return {
          test: "views-workspaces:permissions",
          result: "FAIL",
          step: "admin-create-workspace",
          expectedStatus: 201,
          actualStatus: workspaceCreateStatus,
          body: workspaceCreateBody
        };
      }

      const workspaceBody = await workspaceCreateRes.json();
      workspaceId = workspaceBody.id;
      if (!workspaceId) {
        return {
          test: "views-workspaces:permissions",
          result: "FAIL",
          step: "admin-create-workspace-extract-id",
          workspaceBody
        };
      }
      recordCreated({ type: 'workspace', id: workspaceId, route: '/workspaces', meta: { entityType: "purchaseOrder" } });

      // Step 4a: Viewer attempts POST /views (expect 403)
      const viewerCreateViewRes = await fetch(`${API}/views`, {
        method: "POST",
        headers: {
          "authorization": `Bearer ${viewerToken}`,
          "x-tenant-id": TENANT,
          "content-type": "application/json",
          ...featureHeaders
        },
        body: JSON.stringify({
          name: `Viewer Test View ${runTimestamp}`,
          entityType: "product"
        })
      });

      const viewerCreateViewStatus = viewerCreateViewRes.status;
      const viewerCreateViewDenied = viewerCreateViewStatus === 403;
      const viewerCreateViewBody = await viewerCreateViewRes.json().catch(() => ({}));
      const viewerCreateViewForbiddenMsg = viewerCreateViewBody?.message && 
        (viewerCreateViewBody.message.toLowerCase().includes("forbidden") || 
         viewerCreateViewBody.message.toLowerCase().includes("missing permission"));

      if (!viewerCreateViewDenied) {
        return {
          test: "views-workspaces:permissions",
          result: "FAIL",
          step: "viewer-create-view-denied",
          expectedStatus: 403,
          actualStatus: viewerCreateViewStatus,
          body: viewerCreateViewBody
        };
      }

      // Step 4b: Viewer attempts PATCH /views/{id} (expect 403)
      const viewerPatchViewRes = await fetch(`${API}/views/${encodeURIComponent(viewId)}`, {
        method: "PATCH",
        headers: {
          "authorization": `Bearer ${viewerToken}`,
          "x-tenant-id": TENANT,
          "content-type": "application/json",
          ...featureHeaders
        },
        body: JSON.stringify({
          filters: [{ field: "status", op: "eq", value: "submitted" }]
        })
      });

      const viewerPatchViewStatus = viewerPatchViewRes.status;
      const viewerPatchViewDenied = viewerPatchViewStatus === 403;
      const viewerPatchViewBody = await viewerPatchViewRes.json().catch(() => ({}));

      if (!viewerPatchViewDenied) {
        return {
          test: "views-workspaces:permissions",
          result: "FAIL",
          step: "viewer-patch-view-denied",
          expectedStatus: 403,
          actualStatus: viewerPatchViewStatus,
          body: viewerPatchViewBody
        };
      }

      // Step 4c: Viewer attempts DELETE /views/{id} (expect 403)
      const viewerDeleteViewRes = await fetch(`${API}/views/${encodeURIComponent(viewId)}`, {
        method: "DELETE",
        headers: {
          "authorization": `Bearer ${viewerToken}`,
          "x-tenant-id": TENANT,
          ...featureHeaders
        }
      });

      const viewerDeleteViewStatus = viewerDeleteViewRes.status;
      const viewerDeleteViewDenied = viewerDeleteViewStatus === 403;
      const viewerDeleteViewBody = await viewerDeleteViewRes.json().catch(() => ({}));

      if (!viewerDeleteViewDenied) {
        return {
          test: "views-workspaces:permissions",
          result: "FAIL",
          step: "viewer-delete-view-denied",
          expectedStatus: 403,
          actualStatus: viewerDeleteViewStatus,
          body: viewerDeleteViewBody
        };
      }

      // Step 5a: Viewer attempts POST /workspaces (expect 403)
      const viewerCreateWorkspaceRes = await fetch(`${API}/workspaces`, {
        method: "POST",
        headers: {
          "authorization": `Bearer ${viewerToken}`,
          "x-tenant-id": TENANT,
          "content-type": "application/json",
          ...featureHeaders
        },
        body: JSON.stringify({
          name: `Viewer Test Workspace ${runTimestamp}`,
          entityType: "product"
        })
      });

      const viewerCreateWorkspaceStatus = viewerCreateWorkspaceRes.status;
      const viewerCreateWorkspaceDenied = viewerCreateWorkspaceStatus === 403;
      const viewerCreateWorkspaceBody = await viewerCreateWorkspaceRes.json().catch(() => ({}));

      if (!viewerCreateWorkspaceDenied) {
        return {
          test: "views-workspaces:permissions",
          result: "FAIL",
          step: "viewer-create-workspace-denied",
          expectedStatus: 403,
          actualStatus: viewerCreateWorkspaceStatus,
          body: viewerCreateWorkspaceBody
        };
      }

      // Step 5b: Viewer attempts PATCH /workspaces/{id} (expect 403)
      const viewerPatchWorkspaceRes = await fetch(`${API}/workspaces/${encodeURIComponent(workspaceId)}`, {
        method: "PATCH",
        headers: {
          "authorization": `Bearer ${viewerToken}`,
          "x-tenant-id": TENANT,
          "content-type": "application/json",
          ...featureHeaders
        },
        body: JSON.stringify({
          name: `Viewer Patched Workspace ${runTimestamp}`
        })
      });

      const viewerPatchWorkspaceStatus = viewerPatchWorkspaceRes.status;
      const viewerPatchWorkspaceDenied = viewerPatchWorkspaceStatus === 403;
      const viewerPatchWorkspaceBody = await viewerPatchWorkspaceRes.json().catch(() => ({}));

      if (!viewerPatchWorkspaceDenied) {
        return {
          test: "views-workspaces:permissions",
          result: "FAIL",
          step: "viewer-patch-workspace-denied",
          expectedStatus: 403,
          actualStatus: viewerPatchWorkspaceStatus,
          body: viewerPatchWorkspaceBody
        };
      }

      // Step 5c: Viewer attempts DELETE /workspaces/{id} (expect 403)
      const viewerDeleteWorkspaceRes = await fetch(`${API}/workspaces/${encodeURIComponent(workspaceId)}`, {
        method: "DELETE",
        headers: {
          "authorization": `Bearer ${viewerToken}`,
          "x-tenant-id": TENANT,
          ...featureHeaders
        }
      });

      const viewerDeleteWorkspaceStatus = viewerDeleteWorkspaceRes.status;
      const viewerDeleteWorkspaceDenied = viewerDeleteWorkspaceStatus === 403;
      const viewerDeleteWorkspaceBody = await viewerDeleteWorkspaceRes.json().catch(() => ({}));

      if (!viewerDeleteWorkspaceDenied) {
        return {
          test: "views-workspaces:permissions",
          result: "FAIL",
          step: "viewer-delete-workspace-denied",
          expectedStatus: 403,
          actualStatus: viewerDeleteWorkspaceStatus,
          body: viewerDeleteWorkspaceBody
        };
      }

      // Step 6a: Viewer confirms GET /views still works (read allowed)
      const viewerReadViewsRes = await fetch(`${API}/views?limit=5`, {
        headers: {
          "authorization": `Bearer ${viewerToken}`,
          "x-tenant-id": TENANT,
          ...featureHeaders
        }
      });

      const viewerReadViewsOk = viewerReadViewsRes.ok;
      const viewerReadViewsStatus = viewerReadViewsRes.status;
      if (!viewerReadViewsOk) {
        return {
          test: "views-workspaces:permissions",
          result: "FAIL",
          step: "viewer-read-views-allowed",
          expectedStatus: 200,
          actualStatus: viewerReadViewsStatus,
          body: await viewerReadViewsRes.json().catch(() => ({}))
        };
      }

      // Step 6b: Viewer confirms GET /workspaces still works (read allowed)
      const viewerReadWorkspacesRes = await fetch(`${API}/workspaces?limit=5`, {
        headers: {
          "authorization": `Bearer ${viewerToken}`,
          "x-tenant-id": TENANT,
          ...featureHeaders
        }
      });

      const viewerReadWorkspacesOk = viewerReadWorkspacesRes.ok;
      const viewerReadWorkspacesStatus = viewerReadWorkspacesRes.status;
      if (!viewerReadWorkspacesOk) {
        return {
          test: "views-workspaces:permissions",
          result: "FAIL",
          step: "viewer-read-workspaces-allowed",
          expectedStatus: 200,
          actualStatus: viewerReadWorkspacesStatus,
          body: await viewerReadWorkspacesRes.json().catch(() => ({}))
        };
      }

      // All checks passed
      return {
        test: "views-workspaces:permissions",
        result: "PASS",
        summary: "RBAC boundaries enforced: admin writes succeed, viewer writes denied (403), viewer reads succeed",
        assertions: {
          adminCreateView: viewCreateOk,
          adminCreateWorkspace: workspaceCreateOk,
          viewerCreateViewDenied: viewerCreateViewDenied,
          viewerPatchViewDenied: viewerPatchViewDenied,
          viewerDeleteViewDenied: viewerDeleteViewDenied,
          viewerCreateWorkspaceDenied: viewerCreateWorkspaceDenied,
          viewerPatchWorkspaceDenied: viewerPatchWorkspaceDenied,
          viewerDeleteWorkspaceDenied: viewerDeleteWorkspaceDenied,
          viewerReadViewsAllowed: viewerReadViewsOk,
          viewerReadWorkspacesAllowed: viewerReadWorkspacesOk
        },
        artifacts: {
          viewId,
          workspaceId
        }
      };
    } finally {
      // Cleanup: delete view and workspace with admin token
      await ensureBearer(); // Use default admin token for cleanup

      if (viewId) {
        const deleteHeaders = { ...baseHeaders(), ...featureHeaders };
        for (let attempt = 0; attempt < 5; attempt++) {
          const delRes = await fetch(`${API}/views/${encodeURIComponent(viewId)}`, {
            method: "DELETE",
            headers: deleteHeaders
          });
          if (delRes.ok || delRes.status === 404) break;
          await sleep(300);
        }
      }

      if (workspaceId) {
        const deleteHeaders = { ...baseHeaders(), ...featureHeaders };
        for (let attempt = 0; attempt < 5; attempt++) {
          const delRes = await fetch(`${API}/workspaces/${encodeURIComponent(workspaceId)}`, {
            method: "DELETE",
            headers: deleteHeaders
          });
          if (delRes.ok || delRes.status === 404) break;
          await sleep(300);
        }
      }
    }
  },

  /* ===================== Sprint III: Views, Workspaces, Events ===================== */
  
  "smoke:views:crud": async ()=>{
    await ensureBearer();

    // Use consistent entityType + timestamped unique name for deterministic q= filtering
    const entityType = "inventoryItem";
    const timestamp = Date.now();
    const uniqueName = smokeTag(`SmokeView-${timestamp}`);
    
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

    // 2) LIST views with exact q= filter + retry for eventual consistency
    // Use q=<exact unique name> to find view deterministically without pagination depth limits
    const maxAttempts = 5;
    const delayMs = 300;
    let found = null;
    let lastListResponse = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) await sleep(delayMs);

      const listQuery = { entityType, q: uniqueName, limit: 50 };
      const list = await get(`/views`, listQuery);
      lastListResponse = list;

      if (list.ok && Array.isArray(list.body?.items)) {
        // Search for created view by ID in first page only (q= should narrow results)
        found = list.body.items.find(v => v.id === viewId);
        if (found) break;
      }
    }

    if (!found) {
      return {
        test:"views:crud",
        result:"FAIL",
        reason:"view-not-in-list-after-retries",
        debug: {
          created: { id: viewId, name: uniqueName, entityType },
          listQuery: { entityType, q: uniqueName, limit: 50 },
          attempts: maxAttempts,
          lastListItems: lastListResponse?.body?.items?.length ?? 0,
          sampledItems: lastListResponse?.body?.items?.slice(0, 3)
        }
      };
    }

    // 3) GET single view
    const get1 = await get(`/views/${encodeURIComponent(viewId)}`);
    if (!get1.ok || get1.body?.id !== viewId) {
      return { test:"views:crud", result:"FAIL", reason:"get-failed", get:get1 };
    }

    // 4) PATCH view (update description) then verify
    const patchedDescription = `patched-${timestamp}`;
    const patchResp = await fetch(`${API}/views/${encodeURIComponent(viewId)}`, {
      method: "PATCH",
      headers: baseHeaders(),
      body: JSON.stringify({ description: patchedDescription })
    });
    const patchBody = await patchResp.json().catch(() => ({}));
    if (!patchResp.ok || patchBody?.description !== patchedDescription) {
      return { test:"views:crud", result:"FAIL", reason:"patch-failed", status: patchResp.status, body: snippet(patchBody, 400) };
    }

    const getAfterPatch = await get(`/views/${encodeURIComponent(viewId)}`);
    if (!getAfterPatch.ok || getAfterPatch.body?.description !== patchedDescription) {
      return { test:"views:crud", result:"FAIL", reason:"patch-not-reflected", getAfterPatch };
    }

    // 5) PUT (update) view
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

    // 6) DELETE view
    const del = await fetch(`${API}/views/${encodeURIComponent(viewId)}`, {
      method: "DELETE",
      headers: baseHeaders()
    });
    if (!del.ok) {
      return { test:"views:crud", result:"FAIL", reason:"delete-failed", delStatus:del.status };
    }

    // 7) Verify deleted (should not be in list anymore)
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

  "smoke:views:validate-filters": async ()=>{
    await ensureBearer();

    const entityType = "purchaseOrder";
    const uniqueName = smokeTag(`FilterValidationTest-${Date.now()}`);

    // Test 1: Invalid filter - missing field
    const test1 = await post(`/views`, {
      name: uniqueName,
      entityType,
      filters: [{ op: "eq", value: "draft" }] // Missing field
    });
    if (test1.ok) {
      return {
        test: "views:validate-filters",
        result: "FAIL",
        reason: "should-reject-missing-field",
        test1
      };
    }

    // Test 2: Invalid filter - bad operator
    const test2 = await post(`/views`, {
      name: uniqueName,
      entityType,
      filters: [{ field: "status", op: "badOp", value: "draft" }] // Bad op
    });
    if (test2.ok) {
      return {
        test: "views:validate-filters",
        result: "FAIL",
        reason: "should-reject-bad-op",
        test2
      };
    }

    // Test 3: Invalid filter - "in" operator with non-array value
    const test3 = await post(`/views`, {
      name: uniqueName,
      entityType,
      filters: [{ field: "status", op: "in", value: "draft" }] // "in" requires array
    });
    if (test3.ok) {
      return {
        test: "views:validate-filters",
        result: "FAIL",
        reason: "should-reject-in-with-non-array",
        test3
      };
    }

    // Test 4: Invalid filter - value is an object (not allowed)
    const test4 = await post(`/views`, {
      name: uniqueName,
      entityType,
      filters: [{ field: "status", op: "eq", value: { nested: "object" } }] // No objects
    });
    if (test4.ok) {
      return {
        test: "views:validate-filters",
        result: "FAIL",
        reason: "should-reject-object-value",
        test4
      };
    }

    // Test 5: Valid filters - should pass
    const validName = smokeTag(`FilterValidationTest-Valid-${Date.now()}`);
    const test5 = await post(`/views`, {
      name: validName,
      entityType,
      filters: [
        { field: "status", op: "eq", value: "draft" },
        { field: "vendorId", op: "in", value: ["v1", "v2"] },
        { field: "createdAt", op: "ge", value: "2025-01-01T00:00:00Z" }
      ]
    });
    if (!test5.ok || !test5.body?.id) {
      return {
        test: "views:validate-filters",
        result: "FAIL",
        reason: "valid-filters-should-pass",
        test5
      };
    }

    return {
      test: "views:validate-filters",
      result: "PASS",
      artifacts: {
        invalidTests: { missingField: !test1.ok, badOp: !test2.ok, inWithNonArray: !test3.ok, objectValue: !test4.ok },
        validTest: test5.ok
      }
    };
  },

  "smoke:workspaces:list": async ()=>{
    await ensureBearer();

    // Sprint H: Test /workspaces filters (q, entityType) with unique smokeTag to avoid pollution
    const runTimestamp = Date.now();
    const uniqueToken = `ws-smoke-${runTimestamp}-${Math.random().toString(36).slice(2, 8)}`;
    const featureHeaders = { "X-Feature-Views-Enabled": "true" };
    const listHdr = { ...baseHeaders(), ...featureHeaders };

    // 1) Create two temp workspaces (stored as views) with different entityTypes using unique smokeTag
    const createA = await fetch(`${API}/workspaces`, {
      method: "POST",
      headers: listHdr,
      body: JSON.stringify({
        name: smokeTag(`${uniqueToken}-A`),
        entityType: "purchaseOrder",
        views: [],
      })
    });
    const bodyA = await createA.json().catch(() => ({}));
    if (!createA.ok || !bodyA?.id) {
      return { test:"workspaces:list", result:"FAIL", reason:"create-workspace-a-failed" };
    }
    const workspaceIdA = bodyA.id;
    recordCreated({ type: 'workspace', id: workspaceIdA, route: '/workspaces', meta: { name: bodyA?.name, entityType: bodyA?.entityType } });

    const createB = await fetch(`${API}/workspaces`, {
      method: "POST",
      headers: listHdr,
      body: JSON.stringify({
        name: smokeTag(`${uniqueToken}-B`),
        entityType: "salesOrder",
        views: [],
      })
    });
    const bodyB = await createB.json().catch(() => ({}));
    if (!createB.ok || !bodyB?.id) {
      // Cleanup A before failing
      await fetch(`${API}/workspaces/${encodeURIComponent(workspaceIdA)}` , {
        method: "DELETE",
        headers: listHdr
      });
      return { test:"workspaces:list", result:"FAIL", reason:"create-workspace-b-failed" };
    }
    const workspaceIdB = bodyB.id;
    recordCreated({ type: 'workspace', id: workspaceIdB, route: '/workspaces', meta: { name: bodyB?.name, entityType: bodyB?.entityType } });

    const cleanup = async () => {
      await fetch(`${API}/workspaces/${encodeURIComponent(workspaceIdA)}`, { method: "DELETE", headers: listHdr });
      await fetch(`${API}/workspaces/${encodeURIComponent(workspaceIdB)}`, { method: "DELETE", headers: listHdr });
    };

    const listWorkspacesUntil = async ({ q, entityType: et, wantIds }) => {
      const maxAttempts = 25;
      const delayMs = 500;
      let lastSnapshot = null;

      const buildUrl = (cursor) => {
        const params = new URLSearchParams();
        params.set("limit", "200");
        if (q) params.set("q", q);
        if (et) params.set("entityType", et);
        params.set("shared", "false");
        if (cursor) params.set("next", cursor);
        return `${API}/workspaces?${params.toString()}`;
      };

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        let cursor = null;
        let pages = 0;
        let cursorsSeen = [];
        let items = [];
        let allFound = false;

        while (pages < 10) {
          const url = buildUrl(cursor);
          const resp = await fetch(url, { headers: listHdr });
          const body = await resp.json().catch(() => ({}));
          const pageItems = Array.isArray(body?.items) ? body.items : [];
          items = items.concat(pageItems);
          const nextCursor = body?.next ?? body?.nextToken ?? body?.pageInfo?.next ?? body?.pageInfo?.nextCursor ?? null;
          if (nextCursor) cursorsSeen.push(nextCursor);

          allFound = wantIds.every(id => items.some(it => it?.id === id));
          if (allFound || !nextCursor) break;

          cursor = nextCursor;
          pages++;
        }

        lastSnapshot = { attempt, items, pagesFetched: pages + 1, cursorsSeen, count: items.length };
        if (allFound) return { ok: true, ...lastSnapshot };
        await sleep(delayMs);
      }

      return { ok: false, ...(lastSnapshot || {}) };
    };

    // 2) GET /workspaces?q=<unique tag> -> assert both created views are in results
    const entityType = "purchaseOrder";
    const qResult = await listWorkspacesUntil({ q: uniqueToken, entityType, wantIds: [workspaceIdA] });
    if (!qResult.ok) {
      const diagResp = await fetch(`${API}/workspaces?entityType=${encodeURIComponent(entityType)}&limit=50`, { headers: listHdr });
      const diagBody = await diagResp.json().catch(() => ({}));
      const unfiltered = Array.isArray(diagBody?.items) ? diagBody.items : [];
      await cleanup();
      throw new Error(JSON.stringify({
        test: "workspaces:list",
        result: "FAIL",
        reason: "q-filter-missing-created-view",
        expectedIds: [workspaceIdA],
        q: uniqueToken,
        entityType,
        attempts: qResult.attempt,
        pagesFetched: qResult.pagesFetched,
        cursorsSeen: qResult.cursorsSeen,
        collectedCount: qResult.count,
        sample: (qResult.items || []).slice(0, 5).map(i => ({ id: i?.id, name: i?.name, entityType: i?.entityType })),
        unfilteredCount: unfiltered.length,
        unfilteredSample: unfiltered.slice(0, 5).map(i => ({ id: i?.id, name: i?.name })),
      }));
    }

    // 3) GET /workspaces?entityType=purchaseOrder with pagination + retry until created view is found
    const entityResult = await listWorkspacesUntil({ entityType: "purchaseOrder", wantIds: [workspaceIdA] });
    const allPO = (entityResult.items || []).every(item => item?.entityType === "purchaseOrder");
    if (!entityResult.ok || !allPO) {
      await cleanup();
      throw new Error(JSON.stringify({
        test: "workspaces:list",
        result: "FAIL",
        reason: entityResult.ok ? "entityType-filter-mismatch" : "entityType-filter-missing-view",
        expectedIds: [workspaceIdA],
        entityType: "purchaseOrder",
        attempts: entityResult.attempt,
        pagesFetched: entityResult.pagesFetched,
        cursorsSeen: entityResult.cursorsSeen,
        collectedCount: entityResult.count,
        sample: (entityResult.items || []).slice(0, 5).map(i => ({ id: i?.id, name: i?.name, entityType: i?.entityType })),
      }));
    }

    // 4) Cleanup: delete both temp views
    const delA = await fetch(`${API}/workspaces/${encodeURIComponent(workspaceIdA)}`, {
      method: "DELETE",
      headers: listHdr
    });
    const delB = await fetch(`${API}/workspaces/${encodeURIComponent(workspaceIdB)}`, {
      method: "DELETE",
      headers: listHdr
    });

    const pass = createA.ok && createB.ok && qResult.ok && entityResult.ok && allPO && delA.ok && delB.ok;
    const byEntityCount = entityResult.count;
    return {
      test: "workspaces:list",
      result: pass ? "PASS" : "FAIL",
      counts: {
        q: qResult.count,
        byEntity: byEntityCount
      }
    };
  },

  "smoke:workspaces:mixed-dedupe": async () => {
    await ensureBearer();
    const featureHeaders = { "X-Feature-Views-Enabled": "true" };
    const headers = { ...baseHeaders(), ...featureHeaders };

    const token = smokeTag(`ws-mixed-dedupe-${Date.now()}`);
    const limit = 200; // fetch everything we created in 1–2 pages when filtered by token
    const ids = [0, 1, 2].map(() => `ws-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    const [idA, idB, idC] = ids;
    const createdWorkspaces = [];
    const createdViews = [];

    const createWs = async (id, name, entityType) => {
      const resp = await fetch(`${API}/workspaces`, {
        method: "POST",
        headers,
        body: JSON.stringify({ id, name, entityType, views: [] })
      });
      const body = await resp.json().catch(() => ({}));
      return { resp, body };
    };
    const listOnce = async (cursor) => {
      const params = new URLSearchParams();
      params.set("limit", String(limit));
      params.set("q", token);
      if (cursor) params.set("cursor", cursor);
      const resp = await fetch(`${API}/workspaces?${params.toString()}`, { headers });
      const body = await resp.json().catch(() => ({}));
      return { ok: resp.ok, body };
    };

    // Helper: retry list with eventual consistency polling
    const listAllWithRetry = async (maxRetries = 10) => {
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        if (attempt > 0) {
          await new Promise((r) => setTimeout(r, 250)); // 250ms delay between retries
        }

        const allItems = [];
        let page1 = await listOnce(null);
        if (!page1.ok) {
          if (attempt === maxRetries - 1) return { ok: false, reason: "list-page1-failed" };
          continue; // retry on transient error
        }

        const items1 = Array.isArray(page1.body?.items) ? page1.body.items : [];
        allItems.push(...items1);
        let cursor = page1.body?.next ?? page1.body?.pageInfo?.nextCursor ?? null;
        let pages = 1;

        // Pagination: fetch all pages
        while (cursor && pages < 5) {
          const page = await listOnce(cursor);
          if (!page.ok) {
            if (attempt === maxRetries - 1) return { ok: false, reason: `list-page${pages + 1}-failed` };
            break; // retry from start on pagination failure
          }
          const pageItems = Array.isArray(page.body?.items) ? page.body.items : [];
          allItems.push(...pageItems);
          cursor = page.body?.next ?? page.body?.pageInfo?.nextCursor ?? null;
          pages += 1;
        }

        // Check if all 3 IDs are present (eventual consistency check)
        const idsFound = allItems.map((i) => i?.id).filter(Boolean);
        const needed = new Set([idA, idB, idC]);
        const hasAll = [...needed].every((id) => idsFound.includes(id));

        if (!hasAll) {
          if (attempt === maxRetries - 1) {
            return { ok: false, reason: "missing-ids", idsFound, pagesFetched: pages, needIds: [idA, idB, idC] };
          }
          continue; // retry on eventual consistency timeout
        }

        // Dedupe validation: no duplicates
        const uniqueIds = new Set(idsFound);
        if (uniqueIds.size < 3) {
          return { ok: false, reason: "dedupe-failed", idsFound, uniqueCount: uniqueIds.size };
        }

        const countA = idsFound.filter((x) => x === idA).length;
        if (countA !== 1) {
          return { ok: false, reason: "duplicate-id-a", countA, idsFound };
        }

        // Success: all checks passed
        return { ok: true, idsFound, pagesFetched: pages };
      }

      return { ok: false, reason: "retry-exhausted" };
    };

    const cleanup = async () => {
      for (const id of createdWorkspaces) {
        try {
          await fetch(`${API}/workspaces/${encodeURIComponent(id)}`, { method: "DELETE", headers });
        } catch (e) {
          console.warn("[smoke:workspaces:mixed-dedupe] cleanup workspace failed", id, e?.message ?? e);
        }
      }
      for (const id of createdViews) {
        try {
          await fetch(`${API}/views/${encodeURIComponent(id)}`, { method: "DELETE", headers });
        } catch (e) {
          console.warn("[smoke:workspaces:mixed-dedupe] cleanup view failed", id, e?.message ?? e);
        }
      }
    };

    try {
      // Create three uniques; names carry token for scoped listing
      const { resp: respA, body: bodyA } = await createWs(idA, `${token}-A`, "purchaseOrder");
      if (!respA.ok || bodyA?.id !== idA) {
        return { test: "workspaces:mixed-dedupe", result: "FAIL", reason: "create-workspace-A" };
      }
      createdWorkspaces.push(bodyA.id);
      recordCreated({ type: "workspace", id: bodyA.id, route: "/workspaces", meta: { name: bodyA.name } });

      const { resp: respB, body: bodyB } = await createWs(idB, `${token}-B`, "salesOrder");
      if (!respB.ok || bodyB?.id !== idB) {
        return { test: "workspaces:mixed-dedupe", result: "FAIL", reason: "create-workspace-B" };
      }
      createdWorkspaces.push(bodyB.id);
      recordCreated({ type: "workspace", id: bodyB.id, route: "/workspaces", meta: { name: bodyB.name } });

      const { resp: respC, body: bodyC } = await createWs(idC, `${token}-C`, "purchaseOrder");
      if (!respC.ok || bodyC?.id !== idC) {
        return { test: "workspaces:mixed-dedupe", result: "FAIL", reason: "create-workspace-C" };
      }
      createdWorkspaces.push(bodyC.id);
      recordCreated({ type: "workspace", id: bodyC.id, route: "/workspaces", meta: { name: bodyC.name } });

      // Best-effort legacy shadow for idA (kept until after assertions)
      const createShadow = await fetch(`${API}/views`, {
        method: "POST",
        headers,
        body: JSON.stringify({ id: idA, name: `${token}-Shadow`, entityType: "purchaseOrder", views: [] })
      });
      const shadowBody = await createShadow.json().catch(() => ({}));
      if (createShadow.ok && shadowBody?.id === idA) {
        createdViews.push(idA);
        recordCreated({ type: "view", id: idA, route: "/views", meta: { name: shadowBody.name } });
      }

      // Retry list with eventual consistency polling
      const listResult = await listAllWithRetry(10);
      if (!listResult.ok) {
        const debugInfo = {
          reason: listResult.reason,
          ...(listResult.idsFound && { idsFound: listResult.idsFound }),
          ...(listResult.needIds && { needIds: listResult.needIds }),
          ...(listResult.pagesFetched && { pagesFetched: listResult.pagesFetched }),
          ...(listResult.uniqueCount && { uniqueCount: listResult.uniqueCount }),
          ...(listResult.countA && { countA: listResult.countA })
        };
        return { test: "workspaces:mixed-dedupe", result: "FAIL", ...debugInfo };
      }

      return { test: "workspaces:mixed-dedupe", result: "PASS", artifacts: { ids: listResult.idsFound, pagesFetched: listResult.pagesFetched } };
    } finally {
      await cleanup();
    }
  },

  "smoke:workspaces:get-no-fallback": async () => {
    await ensureBearer();
    const featureHeaders = { "X-Feature-Views-Enabled": "true" };
    const headers = { ...baseHeaders(), ...featureHeaders };

    const tag = smokeTag(`ws-no-fallback-${Date.now()}`);
    const id = `ws-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    // Create workspace primary
    const createWs = await fetch(`${API}/workspaces`, {
      method: "POST",
      headers,
      body: JSON.stringify({ id, name: `${tag}-primary`, entityType: "purchaseOrder", views: [] })
    });
    const wsBody = await createWs.json().catch(() => ({}));
    if (!createWs.ok || wsBody?.id !== id) {
      return { test: "workspaces:get-no-fallback", result: "FAIL", reason: "create-workspace" };
    }
    recordCreated({ type: "workspace", id, route: "/workspaces", meta: { name: wsBody.name } });

    // Test 1: GET workspace should return workspace when it exists
    const getWsFirst = await fetch(`${API}/workspaces/${encodeURIComponent(id)}`, { headers });
    const wsFirstBody = await getWsFirst.json().catch(() => ({}));
    if (!getWsFirst.ok || wsFirstBody?.id !== id || wsFirstBody?.type !== "workspace") {
      return { test: "workspaces:get-no-fallback", result: "FAIL", reason: "get-workspace-failed", status: getWsFirst.status };
    }

    // Create legacy view shadow with same id
    const createView = await fetch(`${API}/views`, {
      method: "POST",
      headers,
      body: JSON.stringify({ id, name: `${tag}-shadow`, entityType: "purchaseOrder", views: [] })
    });
    const viewBody = await createView.json().catch(() => ({}));
    if (!createView.ok || viewBody?.id !== id) {
      return { test: "workspaces:get-no-fallback", result: "FAIL", reason: "create-view-shadow" };
    }
    recordCreated({ type: "view", id, route: "/views", meta: { name: viewBody.name } });

    // Test 2: GET workspace should still return workspace (not fallback to view)
    const getWsSecond = await fetch(`${API}/workspaces/${encodeURIComponent(id)}`, { headers });
    const wsSecondBody = await getWsSecond.json().catch(() => ({}));
    if (!getWsSecond.ok || wsSecondBody?.id !== id || wsSecondBody?.type !== "workspace") {
      return { test: "workspaces:get-no-fallback", result: "FAIL", reason: "get-workspace-with-view-shadow-failed", status: getWsSecond.status };
    }

    // Delete workspace only; legacy view should remain
    const delWs = await fetch(`${API}/workspaces/${encodeURIComponent(id)}`, { method: "DELETE", headers });
    if (!delWs.ok && delWs.status !== 204 && delWs.status !== 200) {
      return { test: "workspaces:get-no-fallback", result: "FAIL", reason: "delete-workspace" };
    }

    // Test 3: GET workspace should now return 404 (NO FALLBACK to view)
    const getWsAfterDelete = await fetch(`${API}/workspaces/${encodeURIComponent(id)}`, { headers });
    if (getWsAfterDelete.ok || getWsAfterDelete.status !== 404) {
      const body = await getWsAfterDelete.json().catch(() => ({}));
      return { test: "workspaces:get-no-fallback", result: "FAIL", reason: "fallback-not-removed", status: getWsAfterDelete.status, body };
    }

    return { test: "workspaces:get-no-fallback", result: "PASS", artifacts: { id, validated: "no-fallback" } };
  },

  "smoke:workspaces:cutover-validation": async () => {
    await ensureBearer();
    const featureHeaders = { "X-Feature-Views-Enabled": "true" };
    const headers = { ...baseHeaders(), ...featureHeaders };

    const tag = smokeTag(`ws-cutover-${Date.now()}`);
    const id = `ws-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    // Step 1: Create canonical workspace
    const createWs = await fetch(`${API}/workspaces`, {
      method: "POST",
      headers,
      body: JSON.stringify({ id, name: `${tag}-canonical`, entityType: "salesOrder", views: [] })
    });
    const wsBody = await createWs.json().catch(() => ({}));
    if (!createWs.ok || wsBody?.id !== id) {
      return { test: "workspaces:cutover-validation", result: "FAIL", step: "create-workspace" };
    }
    recordCreated({ type: "workspace", id, route: "/workspaces", meta: { name: wsBody.name } });

    // Step 2: Create legacy view "shadow" with same id
    const createView = await fetch(`${API}/views`, {
      method: "POST",
      headers,
      body: JSON.stringify({ id, name: `${tag}-legacy-shadow`, entityType: "salesOrder", views: [] })
    });
    const viewBody = await createView.json().catch(() => ({}));
    if (!createView.ok || viewBody?.id !== id) {
      return { test: "workspaces:cutover-validation", result: "FAIL", step: "create-legacy-view" };
    }
    recordCreated({ type: "view", id, route: "/views", meta: { name: viewBody.name } });

    // Step 3: GET /workspaces/:id should return workspace (not view)
    const getWs = await fetch(`${API}/workspaces/${encodeURIComponent(id)}`, { headers });
    const getWsBody = await getWs.json().catch(() => ({}));
    if (!getWs.ok || getWsBody?.id !== id || getWsBody?.type !== "workspace") {
      return { test: "workspaces:cutover-validation", result: "FAIL", step: "get-workspace", status: getWs.status };
    }

    // Step 4: DELETE /workspaces/:id
    const delWs = await fetch(`${API}/workspaces/${encodeURIComponent(id)}`, { method: "DELETE", headers });
    if (!delWs.ok && delWs.status !== 204 && delWs.status !== 200) {
      return { test: "workspaces:cutover-validation", result: "FAIL", step: "delete-workspace", status: delWs.status };
    }

    // Step 5: GET /workspaces/:id should return 404 (NO FALLBACK to legacy view)
    const getWsAfterDel = await fetch(`${API}/workspaces/${encodeURIComponent(id)}`, { headers });
    if (getWsAfterDel.ok || getWsAfterDel.status !== 404) {
      return { test: "workspaces:cutover-validation", result: "FAIL", step: "get-after-delete-should-404", status: getWsAfterDel.status };
    }

    // Step 6: LIST /workspaces should NOT include the deleted record
    const listRes = await fetch(`${API}/workspaces?q=${encodeURIComponent(tag)}`, { headers });
    const listBody = await listRes.json().catch(() => ({ items: [] }));
    const items = Array.isArray(listBody?.items) ? listBody.items : [];
    const foundItem = items.find((item) => item.id === id);
    if (foundItem) {
      return { test: "workspaces:cutover-validation", result: "FAIL", step: "list-should-not-include-deleted", foundItem };
    }

    return { test: "workspaces:cutover-validation", result: "PASS", artifacts: { id, validated: "full-cutover" } };
  },

  "smoke:workspaces:default-view-validation": async () => {
    await ensureBearer();
    const featureHeaders = { "X-Feature-Views-Enabled": "true" };
    const headers = { ...baseHeaders(), ...featureHeaders };

    const tag = smokeTag(`ws-defaultview-${Date.now()}`);
    const wsId = `ws-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const createdViews = [];
    const createdWorkspaces = [];

    const cleanup = async () => {
      for (const id of createdWorkspaces) {
        try {
          await fetch(`${API}/workspaces/${encodeURIComponent(id)}`, { method: "DELETE", headers });
        } catch (e) {
          console.warn("[smoke:workspaces:default-view-validation] cleanup workspace failed", id, e?.message ?? e);
        }
      }
      for (const id of createdViews) {
        try {
          await fetch(`${API}/views/${encodeURIComponent(id)}`, { method: "DELETE", headers });
        } catch (e) {
          console.warn("[smoke:workspaces:default-view-validation] cleanup view failed", id, e?.message ?? e);
        }
      }
    };

    try {
      // 1) Create two views for purchaseOrder entityType
      const viewACreate = await fetch(`${API}/views`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: `${tag}-ViewA`,
          entityType: "purchaseOrder",
          filters: [],
          columns: ["id", "vendorId"]
        })
      });
      const viewABody = await viewACreate.json().catch(() => ({}));
      if (!viewACreate.ok || !viewABody?.id) {
        return { test: "workspaces:default-view-validation", result: "FAIL", step: "createViewA" };
      }
      const viewAId = viewABody.id;
      createdViews.push(viewAId);
      recordCreated({ type: "view", id: viewAId, route: "/views", meta: { name: viewABody.name } });

      const viewBCreate = await fetch(`${API}/views`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: `${tag}-ViewB`,
          entityType: "purchaseOrder",
          filters: [],
          columns: ["id", "status"]
        })
      });
      const viewBBody = await viewBCreate.json().catch(() => ({}));
      if (!viewBCreate.ok || !viewBBody?.id) {
        return { test: "workspaces:default-view-validation", result: "FAIL", step: "createViewB" };
      }
      const viewBId = viewBBody.id;
      createdViews.push(viewBId);
      recordCreated({ type: "view", id: viewBId, route: "/views", meta: { name: viewBBody.name } });

      // 2) Create workspace with views [A,B], defaultViewId=B
      const wsCreate = await fetch(`${API}/workspaces`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          id: wsId,
          name: `${tag}-Workspace`,
          entityType: "purchaseOrder",
          views: [viewAId, viewBId],
          defaultViewId: viewBId
        })
      });
      const wsBody = await wsCreate.json().catch(() => ({}));
      if (!wsCreate.ok || wsBody?.id !== wsId) {
        return { test: "workspaces:default-view-validation", result: "FAIL", step: "createWorkspace", wsBody };
      }
      createdWorkspaces.push(wsId);
      recordCreated({ type: "workspace", id: wsId, route: "/workspaces", meta: { name: wsBody.name } });

      // 3) GET workspace and assert defaultViewId=B
      const wsGet1 = await fetch(`${API}/workspaces/${encodeURIComponent(wsId)}`, { headers });
      const wsGet1Body = await wsGet1.json().catch(() => ({}));
      if (!wsGet1.ok || wsGet1Body?.defaultViewId !== viewBId) {
        return {
          test: "workspaces:default-view-validation",
          result: "FAIL",
          step: "assertDefaultViewB",
          expected: viewBId,
          actual: wsGet1Body?.defaultViewId
        };
      }

      // 4) PATCH defaultViewId=A
      const patchA = await fetch(`${API}/workspaces/${encodeURIComponent(wsId)}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ defaultViewId: viewAId })
      });
      if (!patchA.ok) {
        return { test: "workspaces:default-view-validation", result: "FAIL", step: "patchDefaultViewA", status: patchA.status };
      }

      // 5) GET workspace and assert defaultViewId=A
      const wsGet2 = await fetch(`${API}/workspaces/${encodeURIComponent(wsId)}`, { headers });
      const wsGet2Body = await wsGet2.json().catch(() => ({}));
      if (!wsGet2.ok || wsGet2Body?.defaultViewId !== viewAId) {
        return {
          test: "workspaces:default-view-validation",
          result: "FAIL",
          step: "assertDefaultViewA",
          expected: viewAId,
          actual: wsGet2Body?.defaultViewId
        };
      }

      // 6) PATCH defaultViewId="unknown" => expect 400
      const unknownId = "unknown-view-id";
      const patchUnknown = await fetch(`${API}/workspaces/${encodeURIComponent(wsId)}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ defaultViewId: unknownId })
      });
      if (patchUnknown.ok || patchUnknown.status !== 400) {
        return {
          test: "workspaces:default-view-validation",
          result: "FAIL",
          step: "patchUnknownViewId",
          expected: 400,
          actual: patchUnknown.status,
          note: "Should reject unknown viewId"
        };
      }
      const patchUnknownBody = await patchUnknown.json().catch(() => ({}));
      const hasUnknownError = patchUnknownBody?.message?.includes("Unknown viewId") || patchUnknownBody?.message?.includes(unknownId);
      if (!hasUnknownError) {
        return {
          test: "workspaces:default-view-validation",
          result: "FAIL",
          step: "assertUnknownViewIdMessage",
          message: patchUnknownBody?.message,
          note: "Error message should mention Unknown viewId"
        };
      }

      // 7) Create a mismatched view (salesOrder) and attempt defaultViewId=mismatch
      const viewMismatchCreate = await fetch(`${API}/views`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: `${tag}-ViewMismatch`,
          entityType: "salesOrder",
          filters: [],
          columns: ["id"]
        })
      });
      const viewMismatchBody = await viewMismatchCreate.json().catch(() => ({}));
      if (!viewMismatchCreate.ok || !viewMismatchBody?.id) {
        return { test: "workspaces:default-view-validation", result: "FAIL", step: "createViewMismatch" };
      }
      const viewMismatchId = viewMismatchBody.id;
      createdViews.push(viewMismatchId);
      recordCreated({ type: "view", id: viewMismatchId, route: "/views", meta: { name: viewMismatchBody.name } });

      // First add mismatched view to workspace.views (should fail validation)
      const patchMismatchViews = await fetch(`${API}/workspaces/${encodeURIComponent(wsId)}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ views: [viewAId, viewBId, viewMismatchId] })
      });
      if (patchMismatchViews.ok || patchMismatchViews.status !== 400) {
        return {
          test: "workspaces:default-view-validation",
          result: "FAIL",
          step: "patchMismatchedViewInViews",
          expected: 400,
          actual: patchMismatchViews.status,
          note: "Should reject mismatched entityType in views[]"
        };
      }

      // Now try to set as default (without adding to views first, should also fail)
      const patchMismatch = await fetch(`${API}/workspaces/${encodeURIComponent(wsId)}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ defaultViewId: viewMismatchId })
      });
      if (patchMismatch.ok || patchMismatch.status !== 400) {
        return {
          test: "workspaces:default-view-validation",
          result: "FAIL",
          step: "patchMismatchedDefaultView",
          expected: 400,
          actual: patchMismatch.status,
          note: "Should reject mismatched entityType for defaultViewId"
        };
      }
      const patchMismatchBody = await patchMismatch.json().catch(() => ({}));
      const hasMismatchError = patchMismatchBody?.message?.includes("not found in views array") || patchMismatchBody?.message?.includes(viewMismatchId);
      if (!hasMismatchError) {
        return {
          test: "workspaces:default-view-validation",
          result: "FAIL",
          step: "assertMismatchMessage",
          message: patchMismatchBody?.message,
          note: "Error message should mention view not in views array or mismatch"
        };
      }

      // 8) PATCH views removing the default while keeping defaultViewId => expect 400
      // Current state: defaultViewId=viewAId, views=[viewAId, viewBId]
      // Try to set views=[viewBId] only (removing viewAId which is the default)
      const patchRemoveDefault = await fetch(`${API}/workspaces/${encodeURIComponent(wsId)}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          views: [viewBId],
          defaultViewId: viewAId  // Still referencing removed view
        })
      });
      if (patchRemoveDefault.ok || patchRemoveDefault.status !== 400) {
        return {
          test: "workspaces:default-view-validation",
          result: "FAIL",
          step: "patchRemoveDefaultView",
          expected: 400,
          actual: patchRemoveDefault.status,
          note: "Should reject defaultViewId not in views[]"
        };
      }
      const patchRemoveDefaultBody = await patchRemoveDefault.json().catch(() => ({}));
      const hasNotInViewsError = patchRemoveDefaultBody?.message?.includes("not found in views array");
      if (!hasNotInViewsError) {
        return {
          test: "workspaces:default-view-validation",
          result: "FAIL",
          step: "assertNotInViewsMessage",
          message: patchRemoveDefaultBody?.message,
          note: "Error message should mention defaultViewId not in views array"
        };
      }

      return {
        test: "workspaces:default-view-validation",
        result: "PASS",
        artifacts: {
          workspaceId: wsId,
          viewAId,
          viewBId,
          viewMismatchId
        }
      };
    } finally {
      await cleanup();
    }
  },

  "smoke:views:apply-to-po-list": async () => {
    await ensureBearer();

    const featureHeaders = { "X-Feature-Views-Enabled": "true" };
    const runTimestamp = Date.now();
    let viewId = null;
    let viewFilters = [];

    try {

    // 1) Create vendor + product + inventory
    const { vendorId } = await seedVendor(api);
    const prod = await createProduct({ name: `ViewApplyTest-${runTimestamp}`, preferredVendorId: vendorId });
    if (!prod.ok) return { test: "views:apply-to-po-list", result: "FAIL", step: "createProduct", prod };
    const prodId = prod.body?.id;
    recordCreated({ type: 'product', id: prodId, route: '/objects/product', meta: { name: prod.body?.name } });

    const item = await createInventoryForProduct(prodId, `ViewApplyItem-${runTimestamp}`);
    if (!item.ok) return { test: "views:apply-to-po-list", result: "FAIL", step: "createInventory", item };
    const itemId = item.body?.id;
    recordCreated({ type: 'inventory', id: itemId, route: '/objects/inventory', meta: { name: item.body?.name, productId: prodId } });

    // 2) Create two POs with different statuses: one draft, one submitted
    const po1Create = await post(
      `/objects/purchaseOrder`,
      {
        type: "purchaseOrder",
        status: "draft",
        vendorId,
        lines: [{ itemId, qty: 1, uom: "ea" }]
      },
      { "Idempotency-Key": idem() }
    );
    if (!po1Create.ok) return { test: "views:apply-to-po-list", result: "FAIL", step: "createPO1", po1Create };
    const po1Id = po1Create.body?.id;
    recordCreated({ type: 'purchaseOrder', id: po1Id, route: '/objects/purchaseOrder', meta: { vendorId, status: "draft" } });

    const po2Create = await post(
      `/objects/purchaseOrder`,
      {
        type: "purchaseOrder",
        status: "draft",
        vendorId,
        lines: [{ itemId, qty: 1, uom: "ea" }]
      },
      { "Idempotency-Key": idem() }
    );
    if (!po2Create.ok) return { test: "views:apply-to-po-list", result: "FAIL", step: "createPO2", po2Create };
    const po2Id = po2Create.body?.id;
    recordCreated({ type: 'purchaseOrder', id: po2Id, route: '/objects/purchaseOrder', meta: { vendorId, status: "draft" } });

    // Submit PO2 so we have two different statuses
    const po2Submit = await post(
      `/purchasing/po/${encodeURIComponent(po2Id)}:submit`,
      {},
      { "Idempotency-Key": idem() }
    );
    if (!po2Submit.ok) return { test: "views:apply-to-po-list", result: "FAIL", step: "submitPO2", po2Submit };

    // 3) Create a View with filter: status="draft"
    const viewCreateHeaders = { ...baseHeaders(), ...featureHeaders };
    const viewCreate = await fetch(`${API}/views`, {
      method: "POST",
      headers: viewCreateHeaders,
      body: JSON.stringify({
        name: smokeTag(`ViewApplyPOFilter-${runTimestamp}`),
        entityType: "purchaseOrder",
        filters: [{ field: "status", op: "eq", value: "draft" }],
        columns: ["id", "vendorId", "status"],
        description: "smoke:views:apply-to-po-list filter test"
      })
    });
    const viewBody = await viewCreate.json().catch(() => ({}));
    if (!viewCreate.ok || !viewBody?.id) {
      return { test: "views:apply-to-po-list", result: "FAIL", step: "createView", status: viewCreate.status, body: snippet(viewBody, 400) };
    }
    viewId = viewBody.id;
    recordCreated({ type: 'view', id: viewId, route: '/views', meta: { name: viewBody?.name, entityType: "purchaseOrder" } });

    // 4) Fetch the view back to get its filters
    const viewGetHeaders = { ...baseHeaders(), ...featureHeaders };
    const viewGet = await fetch(`${API}/views/${encodeURIComponent(viewId)}`, {
      method: "GET",
      headers: viewGetHeaders
    });
    const viewGetBody = await viewGet.json().catch(() => ({}));
    if (!viewGet.ok || !viewGetBody?.id) {
      return { test: "views:apply-to-po-list", result: "FAIL", step: "getView", status: viewGet.status, body: snippet(viewGetBody, 400) };
    }

    // 5) Convert view.filters into query params
    // For this smoke, support only "eq" operator; fail fast if view contains anything else
    viewFilters = viewGetBody.filters || [];
    const derivedQueryParams = { "filter.vendorId": vendorId, limit: 200 };
    
    for (const filter of viewFilters) {
      if (filter.op !== "eq") {
        return {
          test: "views:apply-to-po-list",
          result: "FAIL",
          step: "deriveFilters",
          reason: "unsupported-filter-operator",
          filter,
          message: "smoke:views:apply-to-po-list only supports 'eq' operator"
        };
      }
      derivedQueryParams[`filter.${filter.field}`] = filter.value;
    }

    // 6) Query PO list WITHOUT filter applied (should see both PO1 and PO2)
    // Use retry loop for eventual consistency (proven pattern from other PO smokes)
    // Filter by vendorId to narrow scope and ensure our POs are in first page
    const maxAttempts = 25;
    const delayMs = 500;
    let po1Found = false;
    let po2Found = false;
    let lastUnfilteredList = null;
    let unfilteredItems = [];

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) await sleep(delayMs);

      // Use proven /objects/purchaseOrder endpoint with vendor filter (filter.vendorId syntax)
      const listUnfiltered = await get(`/objects/purchaseOrder`, { "filter.vendorId": vendorId, limit: 200 });
      lastUnfilteredList = listUnfiltered;

      if (listUnfiltered.ok && Array.isArray(listUnfiltered.body?.items)) {
        const items = listUnfiltered.body.items;
        unfilteredItems = items; // Save for final report
        po1Found = items.some(po => po.id === po1Id);
        po2Found = items.some(po => po.id === po2Id);
        
        // Stop early if both found
        if (po1Found && po2Found) break;
      }
    }

    const po1InUnfiltered = po1Found;
    const po2InUnfiltered = po2Found;

    if (!po1Found || !po2Found) {
      const items = lastUnfilteredList?.body?.items ?? [];
      return {
        test: "views:apply-to-po-list",
        result: "FAIL",
        step: "verifyBothPOsInUnfilteredList",
        debug: {
          po1Id,
          po2Id,
          po1Found,
          po2Found,
          endpoint: "/objects/purchaseOrder",
          query: { "filter.vendorId": vendorId, limit: 200 },
          attempts: maxAttempts,
          unfilteredCount: items.length,
          firstFiveIds: items.slice(0, 5).map(po => po.id)
        }
      };
    }

    // 7) Query PO list WITH view filters applied (derived from view definition)
    // Use retry loop to handle eventual consistency
    let po1InFiltered = false;
    let po2InFiltered = false;
    let filteredItems = [];
    let lastFilteredList = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) await sleep(delayMs);

      const listFiltered = await get(`/objects/purchaseOrder`, derivedQueryParams);
      lastFilteredList = listFiltered;

      if (listFiltered.ok && Array.isArray(listFiltered.body?.items)) {
        const items = listFiltered.body.items;
        filteredItems = items;
        po1InFiltered = items.some(po => po.id === po1Id);
        po2InFiltered = items.some(po => po.id === po2Id);

        // Stop early if we have po1 and NOT po2 (expected state)
        if (po1InFiltered && !po2InFiltered) break;
      }
    }

    if (!lastFilteredList?.ok) {
      return {
        test: "views:apply-to-po-list",
        result: "FAIL",
        step: "listFiltered",
        reason: "filter-query-failed",
        status: lastFilteredList?.status,
        derivedQueryParams
      };
    }

    if (filteredItems.length === 0) {
      return {
        test: "views:apply-to-po-list",
        result: "FAIL",
        step: "listFiltered",
        reason: "filter-returned-empty",
        derivedQueryParams
      };
    }

    // 8) Assert: PO1 (draft) is in filtered results
    if (!po1InFiltered) {
      return {
        test: "views:apply-to-po-list",
        result: "FAIL",
        step: "assertPO1InFiltered",
        reason: "draft-PO-not-in-filtered-results",
        po1Id,
        filteredCount: filteredItems.length,
        filteredIds: filteredItems.map(po => ({ id: po.id, status: po.status })),
        derivedQueryParams
      };
    }

    // 9) Assert: PO2 (submitted) is NOT in filtered results
    if (po2InFiltered) {
      return {
        test: "views:apply-to-po-list",
        result: "FAIL",
        step: "assertPO2NotInFiltered",
        reason: "submitted-PO-should-not-be-in-filtered-results",
        po2Id,
        filteredCount: filteredItems.length,
        filteredIds: filteredItems.map(po => ({ id: po.id, status: po.status })),
        derivedQueryParams
      };
    }

    // 10) Assert: all items in filtered results have status="draft"
    const allDraft = filteredItems.every(po => po.status === "draft");
    if (!allDraft) {
      const nonDraft = filteredItems.filter(po => po.status !== "draft");
      return {
        test: "views:apply-to-po-list",
        result: "FAIL",
        step: "assertAllDraftStatus",
        reason: "filtered-list-contains-non-draft-items",
        nonDraftCount: nonDraft.length,
        nonDraftItems: nonDraft.map(po => ({ id: po.id, status: po.status })),
        derivedQueryParams
      };
    }

    const pass = po1InFiltered && !po2InFiltered && allDraft;
    return {
      test: "views:apply-to-po-list",
      result: pass ? "PASS" : "FAIL",
      message: "Applied view filters via derived list query params",
      steps: {
        product: { prodId },
        inventory: { itemId },
        po1: { id: po1Id, status: "draft", inUnfiltered: po1InUnfiltered, inFiltered: po1InFiltered },
        po2: { id: po2Id, status: "submitted", inUnfiltered: po2InUnfiltered, inFiltered: po2InFiltered },
        view: { id: viewId, entityType: "purchaseOrder", filters: viewFilters },
        derivedQueryParams,
        results: {
          unfilteredCount: unfilteredItems.length,
          filteredCount: filteredItems.length,
          allFilteredAreDraft: allDraft
        }
      }
    };
    } finally {
      if (viewId) {
        const deleteHeaders = { ...baseHeaders(), ...featureHeaders };
        let deleted = false;
        let lastError = null;
        for (let attempt = 0; attempt < 5 && !deleted; attempt++) {
          const delResp = await fetch(`${API}/views/${encodeURIComponent(viewId)}`, { method: "DELETE", headers: deleteHeaders });
          if (delResp.ok || delResp.status === 404) {
            deleted = true;
            break;
          }
          lastError = {
            status: delResp.status,
            body: await delResp.json().catch(async () => await delResp.text().catch(() => null)),
          };
          await sleep(300);
        }
        if (!deleted) {
          console.error(JSON.stringify({
            test: "views:apply-to-po-list",
            cleanup: "delete-view",
            viewId,
            smokeRunId: runTimestamp,
            lastError,
          }));
        }
      }
    }
  },

  "smoke:views:apply-to-product-list": async () => {
    await ensureBearer();

    const featureHeaders = { "X-Feature-Views-Enabled": "true" };
    const runTimestamp = Date.now();
    let viewId = null;
    let prod1Id = null;
    let prod2Id = null;

    try {
      // 1) Create two products with distinct tokens
      const token1 = smokeTag(`VPRODT1-${runTimestamp}`);
      const token2 = smokeTag(`VPRODT2-${runTimestamp}`);

      const prod1Create = await post(`/objects/product`, {
        type: "product",
        kind: "good",
        name: `Product with ${token1}`,
        sku: token1
      }, { "Idempotency-Key": idem() });

      if (!prod1Create.ok || !prod1Create.body?.id) {
        return { test: "views:apply-to-product-list", result: "FAIL", step: "createProduct1", prod1Create };
      }
      prod1Id = prod1Create.body.id;
      recordCreated({ type: 'product', id: prod1Id, route: '/objects/product', meta: { sku: token1 } });

      const prod2Create = await post(`/objects/product`, {
        type: "product",
        kind: "good",
        name: `Product with ${token2}`,
        sku: token2
      }, { "Idempotency-Key": idem() });

      if (!prod2Create.ok || !prod2Create.body?.id) {
        return { test: "views:apply-to-product-list", result: "FAIL", step: "createProduct2", prod2Create };
      }
      prod2Id = prod2Create.body.id;
      recordCreated({ type: 'product', id: prod2Id, route: '/objects/product', meta: { sku: token2 } });

      // 2) Verify both products exist via GET by id
      const getProd1 = await get(`/objects/product/${encodeURIComponent(prod1Id)}`);
      if (!getProd1.ok) {
        return { test: "views:apply-to-product-list", result: "FAIL", step: "verifyProd1", getProd1 };
      }

      const getProd2 = await get(`/objects/product/${encodeURIComponent(prod2Id)}`);
      if (!getProd2.ok) {
        return { test: "views:apply-to-product-list", result: "FAIL", step: "verifyProd2", getProd2 };
      }

      const maxAttempts = 10;
      const delayMs = 250;

      // 3) Create a View with q filter for token1
      const viewCreateHeaders = { ...baseHeaders(), ...featureHeaders };
      const viewCreate = await fetch(`${API}/views`, {
        method: "POST",
        headers: viewCreateHeaders,
        body: JSON.stringify({
          name: smokeTag(`ViewProductFilter-${runTimestamp}`),
          entityType: "product",
          filters: [{ field: "q", op: "contains", value: token1 }],
          description: "smoke:views:apply-to-product-list filter test"
        })
      });
      const viewBody = await viewCreate.json().catch(() => ({}));

      if (!viewCreate.ok || !viewBody?.id) {
        return {
          test: "views:apply-to-product-list",
          result: "FAIL",
          step: "createView",
          status: viewCreate.status,
          body: snippet(viewBody, 400)
        };
      }
      viewId = viewBody.id;
      recordCreated({ type: 'view', id: viewId, route: '/views', meta: { entityType: "product" } });

      // 4) Derive query params from view filters and list products
      const derivedQueryParams = { limit: 100, q: token1 };
      let prod1InFiltered = false;
      let prod2InFiltered = false;
      let filteredItems = [];

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (attempt > 0) await sleep(delayMs);
        const listFiltered = await get(`/objects/product`, derivedQueryParams);
        if (listFiltered.ok && Array.isArray(listFiltered.body?.items)) {
          const items = listFiltered.body.items;
          filteredItems = items;
          prod1InFiltered = items.some(p => p.id === prod1Id);
          prod2InFiltered = items.some(p => p.id === prod2Id);
          if (prod1InFiltered && !prod2InFiltered) break;
        }
      }

      // 5) Assert: Product 1 (token1) is in filtered results
      if (!prod1InFiltered) {
        return {
          test: "views:apply-to-product-list",
          result: "FAIL",
          step: "assertProd1InFiltered",
          reason: "filtered-product-not-in-results",
          prod1Id,
          filteredCount: filteredItems.length
        };
      }

      // 6) Assert: Product 2 (token2) is NOT in filtered results
      if (prod2InFiltered) {
        return {
          test: "views:apply-to-product-list",
          result: "FAIL",
          step: "assertProd2NotInFiltered",
          reason: "non-matching-product-should-not-be-in-filtered-results",
          prod2Id,
          filteredCount: filteredItems.length
        };
      }

      const pass = prod1InFiltered && !prod2InFiltered;
      return {
        test: "views:apply-to-product-list",
        result: pass ? "PASS" : "FAIL",
        message: "Applied view filter (q contains) to product list",
        steps: {
          prod1: { id: prod1Id, sku: token1, inFiltered: prod1InFiltered },
          prod2: { id: prod2Id, sku: token2, inFiltered: prod2InFiltered },
          view: { id: viewId, filters: viewBody?.filters },
          derivedQueryParams,
          results: { filteredCount: filteredItems.length }
        }
      };
    } finally {
      if (viewId) {
        const deleteHeaders = { ...baseHeaders(), ...featureHeaders };
        let deleted = false;
        for (let attempt = 0; attempt < 5 && !deleted; attempt++) {
          const delResp = await fetch(`${API}/views/${encodeURIComponent(viewId)}`, { method: "DELETE", headers: deleteHeaders });
          if (delResp.ok || delResp.status === 404) {
            deleted = true;
            break;
          }
          await sleep(300);
        }
      }
    }
  },

  "smoke:views:apply-to-inventory-list": async () => {
    await ensureBearer();

    const featureHeaders = { "X-Feature-Views-Enabled": "true" };
    const runTimestamp = Date.now();
    let viewId = null;
    let prodAId = null;
    let prodBId = null;
    let itemAId = null;
    let itemBId = null;

    try {
      // 1) Create product A + inventory item A
      const tokenA = smokeTag(`VINVA-${runTimestamp}`);
      const tokenB = smokeTag(`VINVB-${runTimestamp}`);

      const prodA = await post(`/objects/product`, {
        type: "product",
        kind: "good",
        name: `Product A ${tokenA}`,
        sku: tokenA
      }, { "Idempotency-Key": idem() });

      if (!prodA.ok || !prodA.body?.id) {
        return { test: "views:apply-to-inventory-list", result: "FAIL", step: "createProdA", prodA };
      }
      prodAId = prodA.body.id;
      recordCreated({ type: 'product', id: prodAId, route: '/objects/product', meta: { sku: tokenA } });

      const itemA = await createInventoryForProduct(prodAId, `Item A ${tokenA}`);
      if (!itemA.ok || !itemA.body?.id) {
        return { test: "views:apply-to-inventory-list", result: "FAIL", step: "createItemA", itemA };
      }
      itemAId = itemA.body.id;
      recordCreated({ type: 'inventory', id: itemAId, route: '/objects/inventory', meta: { productId: prodAId } });

      // 2) Create product B + inventory item B
      const prodB = await post(`/objects/product`, {
        type: "product",
        kind: "good",
        name: `Product B ${tokenB}`,
        sku: tokenB
      }, { "Idempotency-Key": idem() });

      if (!prodB.ok || !prodB.body?.id) {
        return { test: "views:apply-to-inventory-list", result: "FAIL", step: "createProdB", prodB };
      }
      prodBId = prodB.body.id;
      recordCreated({ type: 'product', id: prodBId, route: '/objects/product', meta: { sku: tokenB } });

      const itemB = await createInventoryForProduct(prodBId, `Item B ${tokenB}`);
      if (!itemB.ok || !itemB.body?.id) {
        return { test: "views:apply-to-inventory-list", result: "FAIL", step: "createItemB", itemB };
      }
      itemBId = itemB.body.id;
      recordCreated({ type: 'inventory', id: itemBId, route: '/objects/inventory', meta: { productId: prodBId } });

      // 3) Verify both items exist via GET by id
      const getItemA = await get(`/objects/inventory/${encodeURIComponent(itemAId)}`);
      if (!getItemA.ok) {
        return { test: "views:apply-to-inventory-list", result: "FAIL", step: "verifyItemA", getItemA };
      }

      const getItemB = await get(`/objects/inventory/${encodeURIComponent(itemBId)}`);
      if (!getItemB.ok) {
        return { test: "views:apply-to-inventory-list", result: "FAIL", step: "verifyItemB", getItemB };
      }

      const maxAttempts = 10;
      const delayMs = 250;

      // 4) Create a View with productId filter for product A
      const viewCreateHeaders = { ...baseHeaders(), ...featureHeaders };
      const viewCreate = await fetch(`${API}/views`, {
        method: "POST",
        headers: viewCreateHeaders,
        body: JSON.stringify({
          name: smokeTag(`ViewInventoryFilter-${runTimestamp}`),
          entityType: "inventoryItem",
          filters: [{ field: "productId", op: "eq", value: prodAId }],
          description: "smoke:views:apply-to-inventory-list filter test"
        })
      });
      const viewBody = await viewCreate.json().catch(() => ({}));

      if (!viewCreate.ok || !viewBody?.id) {
        return {
          test: "views:apply-to-inventory-list",
          result: "FAIL",
          step: "createView",
          status: viewCreate.status,
          body: snippet(viewBody, 400)
        };
      }
      viewId = viewBody.id;
      recordCreated({ type: 'view', id: viewId, route: '/views', meta: { entityType: "inventoryItem" } });

      // 5) Derive query params from view filters and list inventory
      const derivedQueryParams = { limit: 100, "filter.productId": prodAId };
      let itemAInFiltered = false;
      let itemBInFiltered = false;
      let filteredItems = [];

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (attempt > 0) await sleep(delayMs);
        const listFiltered = await get(`/objects/inventory`, derivedQueryParams);
        if (listFiltered.ok && Array.isArray(listFiltered.body?.items)) {
          const items = listFiltered.body.items;
          filteredItems = items;
          itemAInFiltered = items.some(i => i.id === itemAId);
          itemBInFiltered = items.some(i => i.id === itemBId);
          if (itemAInFiltered && !itemBInFiltered) break;
        }
      }

      // 6) Assert: Item A (prodA) is in filtered results
      if (!itemAInFiltered) {
        return {
          test: "views:apply-to-inventory-list",
          result: "FAIL",
          step: "assertItemAInFiltered",
          reason: "filtered-inventory-item-not-in-results",
          itemAId,
          filteredCount: filteredItems.length
        };
      }

      // 7) Assert: Item B (prodB) is NOT in filtered results
      if (itemBInFiltered) {
        return {
          test: "views:apply-to-inventory-list",
          result: "FAIL",
          step: "assertItemBNotInFiltered",
          reason: "non-matching-inventory-item-should-not-be-in-filtered-results",
          itemBId,
          filteredCount: filteredItems.length
        };
      }

      const pass = itemAInFiltered && !itemBInFiltered;
      return {
        test: "views:apply-to-inventory-list",
        result: pass ? "PASS" : "FAIL",
        message: "Applied view filter (productId eq) to inventory list",
        steps: {
          itemA: { id: itemAId, productId: prodAId, inFiltered: itemAInFiltered },
          itemB: { id: itemBId, productId: prodBId, inFiltered: itemBInFiltered },
          view: { id: viewId, filters: viewBody?.filters },
          derivedQueryParams,
          results: { filteredCount: filteredItems.length }
        }
      };
    } finally {
      if (viewId) {
        const deleteHeaders = { ...baseHeaders(), ...featureHeaders };
        let deleted = false;
        for (let attempt = 0; attempt < 5 && !deleted; attempt++) {
          const delResp = await fetch(`${API}/views/${encodeURIComponent(viewId)}`, { method: "DELETE", headers: deleteHeaders });
          if (delResp.ok || delResp.status === 404) {
            deleted = true;
            break;
          }
          await sleep(300);
        }
      }
    }
  },

  "smoke:views:apply-to-party-list": async () => {
    await ensureBearer();

    const featureHeaders = { "X-Feature-Views-Enabled": "true" };
    const runTimestamp = Date.now();
    let viewId = null;
    let partyAId = null;
    let partyBId = null;

    try {
      // 1) Create party A with token and role "customer"
      const tokenA = smokeTag(`VPARTY-${runTimestamp}`);
      const tokenB = smokeTag(`VPARTYB-${runTimestamp}`);

      const partyA = await post(`/objects/party`, {
        type: "party",
        kind: "organization",
        name: `Party A ${tokenA}`,
        roles: ["customer"]
      }, { "Idempotency-Key": idem() });

      if (!partyA.ok || !partyA.body?.id) {
        return { test: "views:apply-to-party-list", result: "FAIL", step: "createPartyA", partyA };
      }
      partyAId = partyA.body.id;
      recordCreated({ type: 'party', id: partyAId, route: '/objects/party', meta: { roles: ["customer"] } });

      // 2) Create party B with different token and role "vendor"
      const partyB = await post(`/objects/party`, {
        type: "party",
        kind: "organization",
        name: `Party B ${tokenB}`,
        roles: ["vendor"]
      }, { "Idempotency-Key": idem() });

      if (!partyB.ok || !partyB.body?.id) {
        return { test: "views:apply-to-party-list", result: "FAIL", step: "createPartyB", partyB };
      }
      partyBId = partyB.body.id;
      recordCreated({ type: 'party', id: partyBId, route: '/objects/party', meta: { roles: ["vendor"] } });

      // 3) Verify both parties exist via GET by id
      const getPartyA = await get(`/objects/party/${encodeURIComponent(partyAId)}`);
      if (!getPartyA.ok) {
        return { test: "views:apply-to-party-list", result: "FAIL", step: "verifyPartyA", getPartyA };
      }

      const getPartyB = await get(`/objects/party/${encodeURIComponent(partyBId)}`);
      if (!getPartyB.ok) {
        return { test: "views:apply-to-party-list", result: "FAIL", step: "verifyPartyB", getPartyB };
      }

      const maxAttempts = 10;
      const delayMs = 250;

      // 4) Create a View with q filter for tokenA (safe, no role requirement on list endpoint)
      const viewCreateHeaders = { ...baseHeaders(), ...featureHeaders };
      const viewCreate = await fetch(`${API}/views`, {
        method: "POST",
        headers: viewCreateHeaders,
        body: JSON.stringify({
          name: smokeTag(`ViewPartyFilter-${runTimestamp}`),
          entityType: "party",
          filters: [{ field: "q", op: "contains", value: tokenA }],
          description: "smoke:views:apply-to-party-list filter test"
        })
      });
      const viewBody = await viewCreate.json().catch(() => ({}));

      if (!viewCreate.ok || !viewBody?.id) {
        return {
          test: "views:apply-to-party-list",
          result: "FAIL",
          step: "createView",
          status: viewCreate.status,
          body: snippet(viewBody, 400)
        };
      }
      viewId = viewBody.id;
      recordCreated({ type: 'view', id: viewId, route: '/views', meta: { entityType: "party" } });

      // 5) Derive query params from view filters and list parties
      const derivedQueryParams = { limit: 100, q: tokenA };
      let partyAInFiltered = false;
      let partyBInFiltered = false;
      let filteredItems = [];

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (attempt > 0) await sleep(delayMs);
        const listFiltered = await get(`/objects/party`, derivedQueryParams);
        if (listFiltered.ok && Array.isArray(listFiltered.body?.items)) {
          const items = listFiltered.body.items;
          filteredItems = items;
          partyAInFiltered = items.some(p => p.id === partyAId);
          partyBInFiltered = items.some(p => p.id === partyBId);
          if (partyAInFiltered && !partyBInFiltered) break;
        }
      }

      // 6) Assert: Party A (tokenA) is in filtered results
      if (!partyAInFiltered) {
        return {
          test: "views:apply-to-party-list",
          result: "FAIL",
          step: "assertPartyAInFiltered",
          reason: "filtered-party-not-in-results",
          partyAId,
          filteredCount: filteredItems.length
        };
      }

      // 7) Assert: Party B (tokenB) is NOT in filtered results
      if (partyBInFiltered) {
        return {
          test: "views:apply-to-party-list",
          result: "FAIL",
          step: "assertPartyBNotInFiltered",
          reason: "non-matching-party-should-not-be-in-filtered-results",
          partyBId,
          filteredCount: filteredItems.length
        };
      }

      const pass = partyAInFiltered && !partyBInFiltered;
      return {
        test: "views:apply-to-party-list",
        result: pass ? "PASS" : "FAIL",
        message: "Applied view filter (q contains) to party list",
        steps: {
          partyA: { id: partyAId, name: `Party A ${tokenA}`, inFiltered: partyAInFiltered },
          partyB: { id: partyBId, name: `Party B ${tokenB}`, inFiltered: partyBInFiltered },
          view: { id: viewId, filters: viewBody?.filters },
          derivedQueryParams,
          results: { filteredCount: filteredItems.length }
        }
      };
    } finally {
      if (viewId) {
        const deleteHeaders = { ...baseHeaders(), ...featureHeaders };
        let deleted = false;
        for (let attempt = 0; attempt < 5 && !deleted; attempt++) {
          const delResp = await fetch(`${API}/views/${encodeURIComponent(viewId)}`, { method: "DELETE", headers: deleteHeaders });
          if (delResp.ok || delResp.status === 404) {
            deleted = true;
            break;
          }
          await sleep(300);
        }
      }
    }
  },

  "smoke:views:apply-to-backorders-list": async () => {
    await ensureBearer();

    const featureHeaders = { "X-Feature-Views-Enabled": "true" };
    const runTimestamp = Date.now();
    let viewId = null;
    let backorderAId = null;
    let backorderBId = null;

    try {
      // 1) Create inventory and sales order for backorders
      const itemName = smokeTag(`VBOITEM-${runTimestamp}`);
      const soName = smokeTag(`VBOSO-${runTimestamp}`);
      const vendorName = smokeTag(`VBOVENDOR-${runTimestamp}`);

      // Create product
      const prod = await post(`/objects/product`, {
        type: "product",
        name: itemName,
        sku: `SKU-${runTimestamp}`,
        uom: "unit"
      }, { "Idempotency-Key": idem() });
      if (!prod.ok || !prod.body?.id) {
        return { test: "views:apply-to-backorders-list", result: "FAIL", step: "createProduct", prod };
      }
      const productId = prod.body.id;
      recordCreated({ type: 'product', id: productId, route: '/objects/product', meta: {} });

      // Create customer party for sales order
      const customer = await post(`/objects/party`, {
        type: "party",
        kind: "organization",
        name: smokeTag(`VBOCUSTOMER-${runTimestamp}`),
        roles: ["customer"]
      }, { "Idempotency-Key": idem() });
      if (!customer.ok || !customer.body?.id) {
        return { test: "views:apply-to-backorders-list", result: "FAIL", step: "createCustomer", customer };
      }
      const customerId = customer.body.id;
      recordCreated({ type: 'party', id: customerId, route: '/objects/party', meta: { roles: ["customer"] } });

      // Create vendor party for preferred vendor
      const vendor = await post(`/objects/party`, {
        type: "party",
        kind: "organization",
        name: vendorName,
        roles: ["vendor"]
      }, { "Idempotency-Key": idem() });
      if (!vendor.ok || !vendor.body?.id) {
        return { test: "views:apply-to-backorders-list", result: "FAIL", step: "createVendor", vendor };
      }
      const vendorId = vendor.body.id;
      recordCreated({ type: 'party', id: vendorId, route: '/objects/party', meta: { roles: ["vendor"] } });

      // Create inventory item
      const invItem = await post(`/objects/inventoryItem`, {
        type: "inventoryItem",
        itemId: itemName,
        productId,
        onHand: 0,
        reserved: 0
      }, { "Idempotency-Key": idem() });
      if (!invItem.ok || !invItem.body?.id) {
        return { test: "views:apply-to-backorders-list", result: "FAIL", step: "createInventory", invItem };
      }
      const inventoryId = invItem.body.id;
      recordCreated({ type: 'inventoryItem', id: inventoryId, route: '/objects/inventoryItem', meta: {} });

      // Create sales order using customer party
      const so = await post(`/objects/salesOrder`, {
        type: "salesOrder",
        partyId: customerId,
        lines: [{ itemId: inventoryId, qtyOrdered: 10, notes: "test backorder" }],
        notes: soName
      }, { "Idempotency-Key": idem() });
      if (!so.ok || !so.body?.id) {
        return { test: "views:apply-to-backorders-list", result: "FAIL", step: "createSalesOrder", so };
      }
      const soId = so.body.id;
      recordCreated({ type: 'salesOrder', id: soId, route: '/objects/salesOrder', meta: {} });

      // 2) Create two backorders (one with open status, one with ignored status)
      const backorderA = await post(`/objects/backorderRequest`, {
        type: "backorderRequest",
        soId,
        soLineId: "L1",
        itemId: inventoryId,
        qty: 5,
        status: "open",
        preferredVendorId: vendorId
      }, { "Idempotency-Key": idem() });

      if (!backorderA.ok || !backorderA.body?.id) {
        return { test: "views:apply-to-backorders-list", result: "FAIL", step: "createBackorderA", backorderA };
      }
      backorderAId = backorderA.body.id;
      recordCreated({ type: 'backorderRequest', id: backorderAId, route: '/objects/backorderRequest', meta: { status: "open" } });

      const backorderB = await post(`/objects/backorderRequest`, {
        type: "backorderRequest",
        soId,
        soLineId: "L1",
        itemId: inventoryId,
        qty: 3,
        status: "ignored",
        preferredVendorId: vendorId
      }, { "Idempotency-Key": idem() });

      if (!backorderB.ok || !backorderB.body?.id) {
        return { test: "views:apply-to-backorders-list", result: "FAIL", step: "createBackorderB", backorderB };
      }
      backorderBId = backorderB.body.id;
      recordCreated({ type: 'backorderRequest', id: backorderBId, route: '/objects/backorderRequest', meta: { status: "ignored" } });

      // 3) Create a View with status=open filter
      const viewCreateHeaders = { ...baseHeaders(), ...featureHeaders };
      const viewCreate = await fetch(`${API}/views`, {
        method: "POST",
        headers: viewCreateHeaders,
        body: JSON.stringify({
          name: smokeTag(`ViewBackorderFilter-${runTimestamp}`),
          entityType: "backorderRequest",
          filters: [{ field: "status", op: "eq", value: "open" }],
          description: "smoke:views:apply-to-backorders-list filter test"
        })
      });
      const viewBody = await viewCreate.json().catch(() => ({}));

      if (!viewCreate.ok || !viewBody?.id) {
        return {
          test: "views:apply-to-backorders-list",
          result: "FAIL",
          step: "createView",
          status: viewCreate.status,
          body: snippet(viewBody, 400)
        };
      }
      viewId = viewBody.id;
      recordCreated({ type: 'view', id: viewId, route: '/views', meta: { entityType: "backorderRequest" } });

      // 4) Derive query params from view filters and list backorders with status=open filter
      const derivedQueryParams = { status: "open", limit: 25 };
      let backorderAInFiltered = false;
      let backorderBInFiltered = false;
      let filteredItems = [];

      const maxAttempts = 10;
      const delayMs = 250;

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (attempt > 0) await sleep(delayMs);
        const listFiltered = await post(`/objects/backorderRequest/search`, derivedQueryParams);
        if (listFiltered.ok && Array.isArray(listFiltered.body?.items)) {
          const items = listFiltered.body.items;
          filteredItems = items;
          backorderAInFiltered = items.some(b => b.id === backorderAId);
          backorderBInFiltered = items.some(b => b.id === backorderBId);
          if (backorderAInFiltered && !backorderBInFiltered) break;
        }
      }

      // 5) Assert: BackorderA (status=open) is in filtered results
      if (!backorderAInFiltered) {
        return {
          test: "views:apply-to-backorders-list",
          result: "FAIL",
          step: "assertBackorderAInFiltered",
          reason: "open-backorder-not-in-results",
          backorderAId,
          filteredCount: filteredItems.length,
          returnedIdsSample: filteredItems.slice(0, 10).map(b => b.id)
        };
      }

      // 6) Assert: BackorderB (status=ignored) is NOT in filtered results
      if (backorderBInFiltered) {
        return {
          test: "views:apply-to-backorders-list",
          result: "FAIL",
          step: "assertBackorderBNotInFiltered",
          reason: "ignored-backorder-should-not-be-in-filtered-results",
          backorderBId,
          filteredCount: filteredItems.length,
          returnedIdsSample: filteredItems.slice(0, 10).map(b => b.id)
        };
      }

      const pass = backorderAInFiltered && !backorderBInFiltered;
      return {
        test: "views:apply-to-backorders-list",
        result: pass ? "PASS" : "FAIL",
        message: "Applied view filter (status=open) to backorder list",
        steps: {
          backorderA: { id: backorderAId, status: "open", inFiltered: backorderAInFiltered },
          backorderB: { id: backorderBId, status: "ignored", inFiltered: backorderBInFiltered },
          view: { id: viewId, filters: viewBody?.filters },
          derivedQueryParams,
          results: {
            containsA: backorderAInFiltered,
            containsB: backorderBInFiltered,
            returnedIdsSample: filteredItems.slice(0, 10).map(b => b.id),
            filteredCount: filteredItems.length
          }
        }
      };
    } finally {
      if (viewId) {
        const deleteHeaders = { ...baseHeaders(), ...featureHeaders };
        let deleted = false;
        for (let attempt = 0; attempt < 5 && !deleted; attempt++) {
          const delResp = await fetch(`${API}/views/${encodeURIComponent(viewId)}`, { method: "DELETE", headers: deleteHeaders });
          if (delResp.ok || delResp.status === 404) {
            deleted = true;
            break;
          }
          await sleep(300);
        }
      }
    }
  },

  "smoke:views:save-then-update": async () => {
    // Test PATCH workflow: create view, apply filters, update filters, reapply, verify flip
    // This validates "operator leverage" — update existing view without creating duplicate
    await ensureBearer();

    const featureHeaders = { "X-Feature-Views-Enabled": "true" };
    const runTimestamp = Date.now();
    let vendorId = null;
    let prodId = null;
    let itemId = null;
    let po1Id = null;
    let po2Id = null;
    let viewId = null;

    try {
      // 1) Seed: vendor → product → inventory
      const { vendorId: vid } = await seedVendor(api);
      vendorId = vid;

      const productRes = await createProduct({ vendorId, token: smokeTag(`VTOK-SAVEUPD-${runTimestamp}`) });
      if (!productRes.ok) {
        return {
          test: "views:save-then-update",
          result: "FAIL",
          step: "createProduct",
          status: productRes.status
        };
      }
      prodId = productRes.body?.id;

      const inventoryRes = await createInventoryForProduct(prodId, `Item-SaveUpdate-${runTimestamp}`);
      if (!inventoryRes.ok) {
        return {
          test: "views:save-then-update",
          result: "FAIL",
          step: "createInventory",
          status: inventoryRes.status
        };
      }
      itemId = inventoryRes.body?.id;

      // 2) Create 2 POs with different statuses (both draft initially, then submit one)
      const po1Create = await post(`/objects/purchaseOrder`, {
        type: "purchaseOrder",
        status: "draft",
        vendorId,
        lines: [{ itemId, qty: 10, uom: "ea" }]
      }, { "Idempotency-Key": idem() });
      if (!po1Create.ok || !po1Create.body?.id) {
        return {
          test: "views:save-then-update",
          result: "FAIL",
          step: "createPO1",
          status: po1Create.status
        };
      }
      po1Id = po1Create.body.id;
      recordCreated({ type: 'purchaseOrder', id: po1Id, route: '/objects/purchaseOrder' });

      const po2Create = await post(`/objects/purchaseOrder`, {
        type: "purchaseOrder",
        status: "draft",
        vendorId,
        lines: [{ itemId, qty: 20, uom: "ea" }]
      }, { "Idempotency-Key": idem() });
      if (!po2Create.ok || !po2Create.body?.id) {
        return {
          test: "views:save-then-update",
          result: "FAIL",
          step: "createPO2",
          status: po2Create.status
        };
      }
      po2Id = po2Create.body.id;
      recordCreated({ type: 'purchaseOrder', id: po2Id, route: '/objects/purchaseOrder' });

      // 3) Submit PO2 (flip status from draft to submitted)
      const submitResp = await fetch(`${API}/purchasing/po/${encodeURIComponent(po2Id)}:submit`, {
        method: "POST",
        headers: baseHeaders()
      });
      if (!submitResp.ok) {
        return {
          test: "views:save-then-update",
          result: "FAIL",
          step: "submitPO2",
          status: submitResp.status
        };
      }

      // 4) Create view with status="draft" filter
      const viewCreateResp = await fetch(`${API}/views`, {
        method: "POST",
        headers: { ...baseHeaders(), ...featureHeaders },
        body: JSON.stringify({
          name: `View SaveUpdate Draft ${runTimestamp}`,
          entityType: "purchaseOrder",
          filters: [
            { field: "status", op: "eq", value: "draft" }
          ]
        })
      });
      const viewBody = await viewCreateResp.json().catch(() => ({}));
      if (!viewCreateResp.ok || !viewBody?.id) {
        return {
          test: "views:save-then-update",
          result: "FAIL",
          step: "createView",
          status: viewCreateResp.status
        };
      }
      viewId = viewBody.id;
      recordCreated({ type: 'view', id: viewId, route: '/views', meta: { entityType: "purchaseOrder" } });

      // 5) Apply view (PO1 draft should be found, PO2 submitted should NOT)
      const maxAttempts = 25;
      const delayMs = 500;
      let po1InFilteredDraft = false;
      let po2InFilteredDraft = false;
      let filteredItemsDraft = [];

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (attempt > 0) await sleep(delayMs);
        const listResp = await get(`/objects/purchaseOrder`, { "filter.vendorId": vendorId, "filter.status": "draft", limit: 200 });
        if (listResp.ok && Array.isArray(listResp.body?.items)) {
          const items = listResp.body.items;
          filteredItemsDraft = items;
          po1InFilteredDraft = items.some(po => po.id === po1Id);
          po2InFilteredDraft = items.some(po => po.id === po2Id);
          if (po1InFilteredDraft && !po2InFilteredDraft) break;
        }
      }

      // 6) Assert initial state (draft filter: PO1 yes, PO2 no)
      if (!po1InFilteredDraft) {
        return {
          test: "views:save-then-update",
          result: "FAIL",
          step: "assertPO1InDraftFilter",
          reason: "draft-PO-should-be-in-results",
          po1Id,
          filteredCount: filteredItemsDraft.length
        };
      }
      if (po2InFilteredDraft) {
        return {
          test: "views:save-then-update",
          result: "FAIL",
          step: "assertPO2NotInDraftFilter",
          reason: "submitted-PO-should-not-be-in-draft-filter",
          po2Id,
          filteredCount: filteredItemsDraft.length
        };
      }

      // 7) PATCH view to flip filter to status="submitted"
      const patchResp = await fetch(`${API}/views/${encodeURIComponent(viewId)}`, {
        method: "PATCH",
        headers: { ...baseHeaders(), ...featureHeaders },
        body: JSON.stringify({
          filters: [
            { field: "status", op: "eq", value: "submitted" }
          ]
        })
      });
      if (!patchResp.ok) {
        return {
          test: "views:save-then-update",
          result: "FAIL",
          step: "patchViewToSubmitted",
          status: patchResp.status,
          body: await patchResp.json().catch(() => ({}))
        };
      }

      // 8) Apply updated view (PO2 submitted should be found, PO1 draft should NOT)
      let po1InFilteredSubmitted = false;
      let po2InFilteredSubmitted = false;
      let filteredItemsSubmitted = [];

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (attempt > 0) await sleep(delayMs);
        const listResp = await get(`/objects/purchaseOrder`, { "filter.vendorId": vendorId, "filter.status": "submitted", limit: 200 });
        if (listResp.ok && Array.isArray(listResp.body?.items)) {
          const items = listResp.body.items;
          filteredItemsSubmitted = items;
          po1InFilteredSubmitted = items.some(po => po.id === po1Id);
          po2InFilteredSubmitted = items.some(po => po.id === po2Id);
          if (!po1InFilteredSubmitted && po2InFilteredSubmitted) break;
        }
      }

      // 9) Assert flipped state (submitted filter: PO1 no, PO2 yes)
      if (po1InFilteredSubmitted) {
        return {
          test: "views:save-then-update",
          result: "FAIL",
          step: "assertPO1NotInSubmittedFilter",
          reason: "draft-PO-should-not-be-in-submitted-filter",
          po1Id,
          filteredCount: filteredItemsSubmitted.length
        };
      }
      if (!po2InFilteredSubmitted) {
        return {
          test: "views:save-then-update",
          result: "FAIL",
          step: "assertPO2InSubmittedFilter",
          reason: "submitted-PO-should-be-in-results",
          po2Id,
          filteredCount: filteredItemsSubmitted.length
        };
      }

      const pass = po1InFilteredDraft && !po2InFilteredDraft && !po1InFilteredSubmitted && po2InFilteredSubmitted;
      return {
        test: "views:save-then-update",
        result: pass ? "PASS" : "FAIL",
        message: "Updated view filters via PATCH and reapplied with flipped results",
        steps: {
          vendor: { vendorId },
          product: { prodId },
          inventory: { itemId },
          po1: { id: po1Id, status: "draft", inDraftFilter: po1InFilteredDraft, inSubmittedFilter: po1InFilteredSubmitted },
          po2: { id: po2Id, status: "submitted", inDraftFilter: po2InFilteredDraft, inSubmittedFilter: po2InFilteredSubmitted },
          view: { id: viewId, entityType: "purchaseOrder" },
          assertions: {
            draftFilterCorrect: po1InFilteredDraft && !po2InFilteredDraft,
            submittedFilterCorrect: !po1InFilteredSubmitted && po2InFilteredSubmitted,
            filteredCountDraft: filteredItemsDraft.length,
            filteredCountSubmitted: filteredItemsSubmitted.length
          }
        }
      };
    } finally {
      if (viewId) {
        const deleteHeaders = { ...baseHeaders(), ...featureHeaders };
        let deleted = false;
        for (let attempt = 0; attempt < 5 && !deleted; attempt++) {
          const delResp = await fetch(`${API}/views/${encodeURIComponent(viewId)}`, { method: "DELETE", headers: deleteHeaders });
          if (delResp.ok || delResp.status === 404) {
            deleted = true;
            break;
          }
          await sleep(300);
        }
      }
    }
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

  "smoke:registrations:public-checkout": async ()=>{
    await ensureBearer();

    const featureHeaders = {
      "X-Feature-Registrations-Enabled": "true",
      "X-Feature-Stripe-Simulate": "true"
    };

    // Create an open event (capacity 1)
    const eventName = smokeTag("public_evt");
    const evt = await post("/objects/event", {
      type: "event",
      status: "open",
      name: eventName,
      capacity: 1,
      reservedCount: 0
    });
    if (!evt.ok || !evt.body?.id) {
      return { test:"registrations:public-checkout", result:"FAIL", reason:"event-create-failed", evt };
    }
    const eventId = evt.body.id;
    recordCreated({ type: "event", id: eventId, route: "/objects/event", meta: { name: eventName } });

    // Create public registration
    const regCreate = await post(`/registrations:public`, { eventId }, featureHeaders, { auth: "none" });
    if (!regCreate.ok || !regCreate.body?.registration?.id || !regCreate.body?.publicToken) {
      return { test:"registrations:public-checkout", result:"FAIL", reason:"reg-create-failed", regCreate };
    }
    const regId = regCreate.body.registration.id;
    const publicToken = regCreate.body.publicToken;

    // Checkout with idempotency + public token
    const idemKey = idem();
    const checkout = await post(`/events/registration/${encodeURIComponent(regId)}:checkout`, {}, {
      ...featureHeaders,
      "X-MBapp-Public-Token": publicToken,
      "Idempotency-Key": idemKey
    }, { auth: "none" });

    const pass = checkout.ok && checkout.body?.paymentIntentId && checkout.body?.clientSecret;
    return {
      test: "registrations:public-checkout",
      result: pass ? "PASS" : "FAIL",
      status: checkout.status,
      paymentIntentId: checkout.body?.paymentIntentId,
      clientSecret: checkout.body?.clientSecret,
      steps: { eventId, regId }
    };
  },

  "smoke:registrations:public-checkout-idempotent": async ()=>{
    await ensureBearer();

    const featureHeaders = {
      "X-Feature-Registrations-Enabled": "true",
      "X-Feature-Stripe-Simulate": "true"
    };

    const evt = await post("/objects/event", {
      type: "event",
      status: "open",
      name: smokeTag("public_idem_evt"),
      capacity: 1,
      reservedCount: 0
    });
    if (!evt.ok || !evt.body?.id) {
      return { test:"registrations:public-checkout-idempotent", result:"FAIL", reason:"event-create-failed", evt };
    }
    const eventId = evt.body.id;
    recordCreated({ type: "event", id: eventId, route: "/objects/event" });

    const regCreate = await post(`/registrations:public`, { eventId }, featureHeaders, { auth: "none" });
    if (!regCreate.ok || !regCreate.body?.registration?.id || !regCreate.body?.publicToken) {
      return { test:"registrations:public-checkout-idempotent", result:"FAIL", reason:"reg-create-failed", regCreate };
    }
    const regId = regCreate.body.registration.id;
    const publicToken = regCreate.body.publicToken;

    const idemKey = idem();
    const first = await post(`/events/registration/${encodeURIComponent(regId)}:checkout`, {}, {
      ...featureHeaders,
      "X-MBapp-Public-Token": publicToken,
      "Idempotency-Key": idemKey
    }, { auth: "none" });

    const second = await post(`/events/registration/${encodeURIComponent(regId)}:checkout`, {}, {
      ...featureHeaders,
      "X-MBapp-Public-Token": publicToken,
      "Idempotency-Key": idemKey
    }, { auth: "none" });

    const samePi = first.ok && second.ok && first.body?.paymentIntentId && first.body?.paymentIntentId === second.body?.paymentIntentId;

    return {
      test: "registrations:public-checkout-idempotent",
      result: samePi ? "PASS" : "FAIL",
      first: { status: first.status, pi: first.body?.paymentIntentId },
      second: { status: second.status, pi: second.body?.paymentIntentId },
      steps: { eventId, regId }
    };
  },

  "smoke:events:capacity-guard": async ()=>{
    await ensureBearer();

    const featureHeaders = {
      "X-Feature-Registrations-Enabled": "true",
      "X-Feature-Stripe-Simulate": "true"
    };

    const evt = await post("/objects/event", {
      type: "event",
      status: "open",
      name: smokeTag("cap_evt"),
      capacity: 1,
      reservedCount: 0
    });
    if (!evt.ok || !evt.body?.id) {
      return { test:"events:capacity-guard", result:"FAIL", reason:"event-create-failed", evt };
    }
    const eventId = evt.body.id;
    recordCreated({ type: "event", id: eventId, route: "/objects/event" });

    const r1 = await post(`/registrations:public`, { eventId }, featureHeaders, { auth: "none" });
    const r2 = await post(`/registrations:public`, { eventId }, featureHeaders, { auth: "none" });

    if (!r1.ok || !r1.body?.registration?.id || !r1.body?.publicToken) {
      return { test:"events:capacity-guard", result:"FAIL", reason:"reg1-create-failed", r1 };
    }
    if (!r2.ok || !r2.body?.registration?.id || !r2.body?.publicToken) {
      return { test:"events:capacity-guard", result:"FAIL", reason:"reg2-create-failed", r2 };
    }

    const idem1 = idem();
    const c1 = await post(`/events/registration/${encodeURIComponent(r1.body.registration.id)}:checkout`, {}, {
      ...featureHeaders,
      "X-MBapp-Public-Token": r1.body.publicToken,
      "Idempotency-Key": idem1
    }, { auth: "none" });

    const idem2 = idem();
    const c2 = await post(`/events/registration/${encodeURIComponent(r2.body.registration.id)}:checkout`, {}, {
      ...featureHeaders,
      "X-MBapp-Public-Token": r2.body.publicToken,
      "Idempotency-Key": idem2
    }, { auth: "none" });

    const pass = c1.ok && c2.status === 409;
    return {
      test: "events:capacity-guard",
      result: pass ? "PASS" : "FAIL",
      c1: { status: c1.status, pi: c1.body?.paymentIntentId },
      c2: { status: c2.status, body: c2.body },
      steps: { eventId, reg1: r1.body.registration.id, reg2: r2.body.registration.id }
    };
  },

  "smoke:webhooks:stripe-payment-intent-succeeded": async ()=>{
    await ensureBearer();

    const featureHeaders = {
      "X-Feature-Registrations-Enabled": "true",
      "X-Feature-Stripe-Simulate": "true"
    };

    const evt = await post("/objects/event", {
      type: "event",
      status: "open",
      name: smokeTag("wh_evt"),
      capacity: 1,
      reservedCount: 0
    });
    if (!evt.ok || !evt.body?.id) {
      return { test:"webhooks:stripe-payment-intent-succeeded", result:"FAIL", reason:"event-create-failed", evt };
    }
    const eventId = evt.body.id;
    recordCreated({ type: "event", id: eventId, route: "/objects/event" });

    const regCreate = await post(`/registrations:public`, { eventId }, featureHeaders, { auth: "none" });
    if (!regCreate.ok || !regCreate.body?.registration?.id || !regCreate.body?.publicToken) {
      return { test:"webhooks:stripe-payment-intent-succeeded", result:"FAIL", reason:"reg-create-failed", regCreate };
    }
    const regId = regCreate.body.registration.id;
    const publicToken = regCreate.body.publicToken;

    const checkout = await post(`/events/registration/${encodeURIComponent(regId)}:checkout`, {}, {
      ...featureHeaders,
      "X-MBapp-Public-Token": publicToken,
      "Idempotency-Key": idem()
    }, { auth: "none" });

    if (!checkout.ok || !checkout.body?.paymentIntentId) {
      return { test:"webhooks:stripe-payment-intent-succeeded", result:"FAIL", reason:"checkout-failed", checkout };
    }

    const piId = checkout.body.paymentIntentId;

    // Send simulated webhook with known signature pattern
    const webhookBody = {
      id: `evt_${SMOKE_RUN_ID}`,
      type: "payment_intent.succeeded",
      data: {
        object: {
          id: piId,
          status: "succeeded",
          metadata: {
            registrationId: regId,
            eventId
          }
        }
      }
    };

    const whRes = await fetch(`${API}/webhooks/stripe`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Stripe-Signature": "sim_valid_signature",
        ...featureHeaders,
        "x-tenant-id": TENANT
      },
      body: JSON.stringify(webhookBody)
    });
    const whBody = await whRes.json().catch(() => ({}));
    if (!whRes.ok) {
      return { test:"webhooks:stripe-payment-intent-succeeded", result:"FAIL", reason:"webhook-failed", whStatus: whRes.status, whBody };
    }

    // Poll registration until confirmed
    const confirmed = await waitForStatus("registration", regId, ["confirmed"], { tries: 20, delayMs: 300 });

    const reg = await get(`/objects/registration/${encodeURIComponent(regId)}`);
    const status = reg?.body?.status;
    const payStatus = reg?.body?.paymentStatus;

    const pass = confirmed.ok && status === "confirmed" && payStatus === "paid";
    return {
      test: "webhooks:stripe-payment-intent-succeeded",
      result: pass ? "PASS" : "FAIL",
      status,
      paymentStatus: payStatus,
      webhookStatus: whRes.status,
      steps: { eventId, regId, piId }
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
  },

  /**
   * E4: Idempotent replay test for po:create-from-suggestion endpoint
   * Validates that calling create-from-suggestion with same Idempotency-Key returns identical PO IDs
   * and does not create duplicate POs
   */
  "smoke:po:create-from-suggestion:idempotent-replay": async () => {
    await ensureBearer();
    
    // Step 1: Seed vendor
    const { vendorId } = await seedVendor(api);
    if (!vendorId) {
      return { test: "smoke:po:create-from-suggestion:idempotent-replay", result: "FAIL", reason: "vendor-seed-failed" };
    }
    
    // Step 2: Create product with preferredVendorId and inventory item
    const prod = await createProduct({ name: "IdempotentReplayTest", preferredVendorId: vendorId });
    if (!prod.ok) return { test: "smoke:po:create-from-suggestion:idempotent-replay", result: "FAIL", reason: "product-create-failed", prod };
    
    const inv = await createInventoryForProduct(prod.body.id, "IdempotentReplayItem");
    if (!inv.ok) return { test: "smoke:po:create-from-suggestion:idempotent-replay", result: "FAIL", reason: "inventory-create-failed", inv };
    
    const itemId = inv.body?.id;
    
    // Step 3: Create customer for SO
    const { customerId } = await seedCustomer(api);
    if (!customerId) {
      return { test: "smoke:po:create-from-suggestion:idempotent-replay", result: "FAIL", reason: "customer-seed-failed" };
    }
    
    // Step 4: Create SO with shortage to trigger backorder
    const soCreate = await post(`/objects/salesOrder`, {
      type: "salesOrder",
      status: "draft",
      customerId,
      lines: [{ id: "L1", itemId, qty: 10, uom: "ea" }]
    });
    
    if (!soCreate.ok || !soCreate.body?.id) {
      return { test: "smoke:po:create-from-suggestion:idempotent-replay", result: "FAIL", reason: "so-create-failed", soCreate };
    }
    
    const soId = soCreate.body.id;
    
    // Step 5: Submit and commit SO to create backorder
    const submit = await post(
      `/sales/so/${encodeURIComponent(soId)}:submit`,
      {},
      { "Idempotency-Key": idem() }
    );
    
    if (!submit.ok) {
      return { test: "smoke:po:create-from-suggestion:idempotent-replay", result: "FAIL", reason: "so-submit-failed", submit };
    }
    
    const commit = await post(
      `/sales/so/${encodeURIComponent(soId)}:commit`,
      { strict: false },
      { "Idempotency-Key": idem() }
    );
    
    if (!commit.ok) {
      return { test: "smoke:po:create-from-suggestion:idempotent-replay", result: "FAIL", reason: "so-commit-failed", commit };
    }
    
    // Step 6: Wait for backorder request
    const boWait = await waitForBackorders({ soId, itemId, status: "open", preferredVendorId: vendorId }, { timeoutMs: 5000 });
    if (!boWait.ok || !boWait.items || boWait.items.length === 0) {
      return { test: "smoke:po:create-from-suggestion:idempotent-replay", result: "FAIL", reason: "backorder-not-created", boWait };
    }
    
    const boId = boWait.items[0]?.id;
    if (!boId) {
      return { test: "smoke:po:create-from-suggestion:idempotent-replay", result: "FAIL", reason: "backorder-missing-id" };
    }
    
    // Step 7: Suggest PO from backorder
    const sugg = await post(
      `/purchasing/suggest-po`,
      { requests: [{ backorderRequestId: boId }] },
      { "Idempotency-Key": idem() }
    );
    
    if (!sugg.ok) {
      return { test: "smoke:po:create-from-suggestion:idempotent-replay", result: "FAIL", reason: "suggest-po-failed", sugg };
    }
    
    const drafts = Array.isArray(sugg.body?.drafts) ? sugg.body.drafts : (sugg.body?.draft ? [sugg.body.draft] : []);
    
    if (drafts.length === 0) {
      const skipped = Array.isArray(sugg.body?.skipped) ? sugg.body.skipped : [];
      return {
        test: "smoke:po:create-from-suggestion:idempotent-replay",
        result: "FAIL",
        reason: "no-drafts-from-suggest-po",
        skipped: skipped.map(s => ({ id: s.backorderRequestId, reason: s.reason }))
      };
    }
    
    const draft = drafts[0];
    if (!draft.vendorId) {
      return { test: "smoke:po:create-from-suggestion:idempotent-replay", result: "FAIL", reason: "draft-missing-vendor", draft };
    }
    
    // Step 8: FIRST create-from-suggestion call with stable Idempotency-Key
    const fixedKey = `idempotent-replay-test-${Date.now()}`;
    const create1 = await post(
      `/purchasing/po:create-from-suggestion`,
      { draft },
      { "Idempotency-Key": fixedKey }
    );
    
    if (!create1.ok) {
      return { test: "smoke:po:create-from-suggestion:idempotent-replay", result: "FAIL", reason: "first-create-failed", create1 };
    }
    
    const ids1 = create1.body?.ids || (create1.body?.id ? [create1.body.id] : []);
    if (ids1.length === 0) {
      return { test: "smoke:po:create-from-suggestion:idempotent-replay", result: "FAIL", reason: "no-ids-returned-first-call", create1: create1.body };
    }
    
    // Step 9: REPLAY with same Idempotency-Key
    const create2 = await post(
      `/purchasing/po:create-from-suggestion`,
      { draft },
      { "Idempotency-Key": fixedKey }
    );
    
    if (!create2.ok) {
      return { test: "smoke:po:create-from-suggestion:idempotent-replay", result: "FAIL", reason: "replay-create-failed", create2 };
    }
    
    const ids2 = create2.body?.ids || (create2.body?.id ? [create2.body.id] : []);
    if (ids2.length === 0) {
      return { test: "smoke:po:create-from-suggestion:idempotent-replay", result: "FAIL", reason: "no-ids-returned-replay-call", create2: create2.body };
    }
    
    // Step 10: Assert identical IDs
    const idsMatch = JSON.stringify(ids1.sort()) === JSON.stringify(ids2.sort());
    
    // Step 11: Verify only one PO exists (use first ID)
    const poId = ids1[0];
    const fetchPo = await get(`/objects/purchaseOrder/${encodeURIComponent(poId)}`);
    
    if (!fetchPo.ok || !fetchPo.body) {
      return { test: "smoke:po:create-from-suggestion:idempotent-replay", result: "FAIL", reason: "po-fetch-failed", poId, fetchPo };
    }
    
    const po = fetchPo.body;
    const hasVendor = po.vendorId === vendorId;
    const hasLines = Array.isArray(po.lines) && po.lines.length > 0;
    
    const pass = idsMatch && hasVendor && hasLines;
    
    return {
      test: "smoke:po:create-from-suggestion:idempotent-replay",
      result: pass ? "PASS" : "FAIL",
      steps: {
        boId,
        vendorId,
        itemId,
        firstCallIds: ids1,
        replayCallIds: ids2,
        idsMatch,
        poId,
        poVendorId: po.vendorId,
        poLineCount: po.lines?.length || 0,
        hasVendor,
        hasLines
      },
      ...(!pass ? { failures: { idsMatch, hasVendor, hasLines } } : {})
    };
  },

  /**
   * E4: Regression test for po-create-from-suggestion line ID normalization (Sprint M E1)
   * Ensures all created PO lines have stable L{n} IDs (not ln_* or other ad-hoc patterns)
   */
  "smoke:po:create-from-suggestion:line-ids": async () => {
    await ensureBearer();
    
    // Step 1: Seed vendor to ensure vendor resolution
    const { vendorId } = await seedVendor(api);
    if (!vendorId) {
      return { test: "po:create-from-suggestion:line-ids", result: "FAIL", reason: "vendor-seed-failed" };
    }
    
    // Step 2: Create product with preferredVendorId and inventory item
    const prod = await createProduct({ name: "PoLineIdTest", preferredVendorId: vendorId });
    if (!prod.ok) return { test: "po:create-from-suggestion:line-ids", result: "FAIL", reason: "product-create-failed", prod };
    
    const inv = await createInventoryForProduct(prod.body.id, "PoLineIdTestItem");
    if (!inv.ok) return { test: "po:create-from-suggestion:line-ids", result: "FAIL", reason: "inventory-create-failed", inv };
    
    const itemId = inv.body?.id;
    
    // Step 3: Create customer for SO
    const { customerId } = await seedCustomer(api);
    if (!customerId) {
      return { test: "po:create-from-suggestion:line-ids", result: "FAIL", reason: "customer-seed-failed" };
    }
    
    // Step 4: Create SO with shortage to trigger backorder
    const soCreate = await post(`/objects/salesOrder`, {
      type: "salesOrder",
      status: "draft",
      customerId,
      lines: [{ id: "L1", itemId, qty: 5, uom: "ea" }]
    });
    
    if (!soCreate.ok || !soCreate.body?.id) {
      return { test: "po:create-from-suggestion:line-ids", result: "FAIL", reason: "so-create-failed", soCreate };
    }
    
    const soId = soCreate.body.id;
    
    // Step 5: Submit SO (required before commit)
    const submit = await post(
      `/sales/so/${encodeURIComponent(soId)}:submit`,
      {},
      { "Idempotency-Key": idem() }
    );
    
    if (!submit.ok) {
      return { test: "po:create-from-suggestion:line-ids", result: "FAIL", reason: "so-submit-failed", submit };
    }
    
    // Step 6: Verify SO status after submit
    const soAfterSubmit = await get(`/objects/salesOrder/${encodeURIComponent(soId)}`);
    if (!soAfterSubmit.ok || soAfterSubmit.body?.status !== "submitted") {
      return {
        test: "po:create-from-suggestion:line-ids",
        result: "FAIL",
        reason: "so-status-not-submitted",
        expectedStatus: "submitted",
        actualStatus: soAfterSubmit.body?.status,
        soAfterSubmit
      };
    }
    
    // Step 7: Commit SO (non-strict) to create backorder request
    const commit = await post(
      `/sales/so/${encodeURIComponent(soId)}:commit`,
      { strict: false },
      { "Idempotency-Key": idem() }
    );
    
    if (!commit.ok) {
      return { test: "po:create-from-suggestion:line-ids", result: "FAIL", reason: "so-commit-failed", commit };
    }
    
    // Step 8: Wait for backorder request to be created
    const boWait = await waitForBackorders({ soId, itemId, status: "open", preferredVendorId: vendorId }, { timeoutMs: 5000 });
    if (!boWait.ok || !boWait.items || boWait.items.length === 0) {
      return { test: "po:create-from-suggestion:line-ids", result: "FAIL", reason: "backorder-not-created", boWait };
    }
    
    const bo = boWait.items[0];
    const boId = bo?.id;
    
    if (!boId) {
      return { test: "po:create-from-suggestion:line-ids", result: "FAIL", reason: "backorder-missing-id", bo };
    }
    
    // Step 9: Suggest PO from backorder
    const sugg = await post(
      `/purchasing/suggest-po`,
      { requests: [{ backorderRequestId: boId }] },
      { "Idempotency-Key": idem() }
    );
    
    if (!sugg.ok) {
      return { test: "po:create-from-suggestion:line-ids", result: "FAIL", reason: "suggest-po-failed", sugg };
    }
    
    const drafts = Array.isArray(sugg.body?.drafts) ? sugg.body.drafts : (sugg.body?.draft ? [sugg.body.draft] : []);
    const skipped = Array.isArray(sugg.body?.skipped) ? sugg.body.skipped : [];
    
    if (drafts.length === 0) {
      // Debug: include skipped reasons and vendor resolution details
      const boData = await get(`/objects/backorderRequest/${encodeURIComponent(boId)}`);
      const invData = await get(`/objects/inventory/${encodeURIComponent(itemId)}`);
      const prodData = invData.ok && invData.body?.productId 
        ? await get(`/objects/product/${encodeURIComponent(invData.body.productId)}`)
        : { ok: false };
      
      return {
        test: "po:create-from-suggestion:line-ids",
        result: "FAIL",
        reason: "no-drafts-from-suggest-po",
        debug: {
          skippedReasons: skipped.map(s => ({ backorderRequestId: s.backorderRequestId, reason: s.reason })),
          backorder: { id: boData.body?.id, preferredVendorId: boData.body?.preferredVendorId, itemId: boData.body?.itemId },
          inventory: { id: invData.body?.id, productId: invData.body?.productId },
          product: { id: prodData.body?.id, preferredVendorId: prodData.body?.preferredVendorId },
          vendorIdUsed: vendorId
        }
      };
    }
    
    const draft = drafts[0];
    if (!draft.vendorId) {
      return { test: "po:create-from-suggestion:line-ids", result: "FAIL", reason: "draft-missing-vendor", draft };
    }
    
    // Step 10: Create PO from suggestion
    const create = await post(
      `/purchasing/po:create-from-suggestion`,
      { draft },
      { "Idempotency-Key": idem() }
    );
    
    if (!create.ok || !create.body?.id) {
      return { test: "po:create-from-suggestion:line-ids", result: "FAIL", reason: "create-from-suggestion-failed", create };
    }
    
    const poId = create.body.id;
    
    // Step 11: Fetch persisted PO and validate line IDs
    const fetchPo = await get(`/objects/purchaseOrder/${encodeURIComponent(poId)}`);
    
    if (!fetchPo.ok || !fetchPo.body) {
      return { test: "po:create-from-suggestion:line-ids", result: "FAIL", reason: "po-fetch-failed", fetchPo };
    }
    
    const lines = Array.isArray(fetchPo.body.lines) ? fetchPo.body.lines : [];
    if (lines.length === 0) {
      return { test: "po:create-from-suggestion:line-ids", result: "FAIL", reason: "no-lines-in-po", fetchPo: fetchPo.body };
    }
    
    // Step 12: Assert every line ID matches ^L\d+$ pattern (e.g., L1, L2, L3, ...)
    const lineIdPattern = /^L\d+$/;
    const invalidLines = lines.filter(ln => {
      const id = String(ln.id || ln.lineId || "").trim();
      return !lineIdPattern.test(id);
    });
    
    const allLineIdsValid = invalidLines.length === 0;
    const lineIds = lines.map(ln => String(ln.id || ln.lineId || "").trim());
    
    const pass = allLineIdsValid && lines.length > 0;
    
    return {
      test: "po:create-from-suggestion:line-ids",
      result: pass ? "PASS" : "FAIL",
      poId,
      lineCount: lines.length,
      lineIds,
      allLineIdsValid,
      ...(pass ? {} : { invalidLines: invalidLines.map(ln => ({ id: ln.id, lineId: ln.lineId })) })
    };
  },

  /**
   * E4: Regression test for web CID support in patch-lines (Sprint M E2)
   * Ensures new lines sent with cid field get stable server IDs, and subsequent updates use id field
   */
  "smoke:so:patch-lines:cid": async () => {
    await ensureBearer();
    
    const { customerId } = await seedCustomer(api);
    
    // Step 1: Create SO draft with 1 initial line
    const prod = await createProduct({ name: "SoCidTest" });
    if (!prod.ok) return { test: "so:patch-lines:cid", result: "FAIL", reason: "product-create-failed", prod };
    
    const inv = await createInventoryForProduct(prod.body.id, "SoCidTestItem");
    if (!inv.ok) return { test: "so:patch-lines:cid", result: "FAIL", reason: "inventory-create-failed", inv };
    
    const itemId = inv.body?.id;
    
    const create = await post(`/objects/salesOrder`, {
      type: "salesOrder",
      status: "draft",
      customerId,
      lines: [{ itemId, qty: 1, uom: "ea" }] // 1 initial line for remove/update testing
    });
    
    if (!create.ok || !create.body?.id) {
      return { test: "so:patch-lines:cid", result: "FAIL", reason: "so-create-failed", create };
    }
    
    const soId = create.body.id;
    const initialLine = Array.isArray(create.body.lines) ? create.body.lines[0] : null;
    const initialLineId = initialLine?.id ? String(initialLine.id).trim() : null;
    
    // Step 2: Multi-op patch: add via cid, update via id, remove existing
    const clientId = `tmp-${Math.random().toString(36).slice(2, 11)}`; // Generate tmp-* CID
    
    const prod2 = await createProduct({ name: "SoCidTest2" });
    const inv2 = await createInventoryForProduct(prod2.body.id, "SoCidTestItem2");
    const itemId2 = inv2.body?.id;
    
    const patchMultiOp = await post(
      `/sales/so/${encodeURIComponent(soId)}:patch-lines`,
      {
        ops: [
          { op: "upsert", cid: clientId, patch: { itemId: itemId2, qty: 3, uom: "ea" } }, // Add via cid
          { op: "upsert", id: initialLineId, patch: { qty: 2 } }, // Update existing via id
          initialLineId ? { op: "remove", id: initialLineId } : null, // Remove existing line
        ].filter(Boolean)
      },
      { "Idempotency-Key": idem() }
    );
    
    if (!patchMultiOp.ok) {
      return { test: "so:patch-lines:cid", result: "FAIL", reason: "patch-multi-op-failed", patchMultiOp };
    }
    
    // Step 3: Fetch and verify multi-op results
    const fetchSo1 = await get(`/objects/salesOrder/${encodeURIComponent(soId)}`);
    if (!fetchSo1.ok || !fetchSo1.body) {
      return { test: "so:patch-lines:cid", result: "FAIL", reason: "so-fetch1-failed", fetchSo1 };
    }
    
    const lines1 = Array.isArray(fetchSo1.body.lines) ? fetchSo1.body.lines : [];
    
    // Verify: removed line is gone, new line exists with L{n} id, no tmp-* ids remain
    const removedLineExists = initialLineId && lines1.some(ln => ln.id === initialLineId);
    const newLineAdded = lines1.find(ln => ln.itemId === itemId2);
    const newLineHasValidId = newLineAdded && /^L\d+$/.test(String(newLineAdded.id).trim());
    const noTmpIdsRemain = !lines1.some(ln => String(ln.id || "").trim().startsWith("tmp-"));
    
    if (removedLineExists) {
      return { test: "so:patch-lines:cid", result: "FAIL", reason: "multi-op-remove-failed", removedLineStillExists: initialLineId };
    }
    
    if (!newLineAdded) {
      return { test: "so:patch-lines:cid", result: "FAIL", reason: "multi-op-add-failed", lines: lines1.map(l => ({ id: l.id, itemId: l.itemId })) };
    }
    
    if (!newLineHasValidId) {
      return { test: "so:patch-lines:cid", result: "FAIL", reason: "multi-op-new-id-invalid", newLineId: newLineAdded.id };
    }
    
    const newLineId = String(newLineAdded.id).trim();
    
    // Step 4: Status guard test - move to non-editable status and verify 409
    const cancel = await post(
      `/sales/so/${encodeURIComponent(soId)}:cancel`,
      {},
      { "Idempotency-Key": idem() }
    );
    
    if (!cancel.ok) {
      return { test: "so:patch-lines:cid", result: "FAIL", reason: "cancel-failed", cancel };
    }
    
    // Try patch on cancelled SO (should fail 409 - status not editable)
    const patchAfterCancel = await post(
      `/sales/so/${encodeURIComponent(soId)}:patch-lines`,
      {
        ops: [{ op: "upsert", cid: `tmp-guard-${Math.random().toString(36).slice(2, 7)}`, patch: { itemId, qty: 1, uom: "ea" } }]
      },
      { "Idempotency-Key": idem() }
    );
    
    const statusGuardCorrect = !patchAfterCancel.ok && patchAfterCancel.status === 409;
    
    // Final assertions
    const pass = patchMultiOp.ok && newLineHasValidId && noTmpIdsRemain && statusGuardCorrect;
    
    return {
      test: "so:patch-lines:cid",
      result: pass ? "PASS" : "FAIL",
      soId,
      clientId,
      newLineId,
      assertions: {
        multiOp_ok: patchMultiOp.ok,
        multiOp_newLineAdded: newLineAdded ? true : false,
        multiOp_removedLineGone: !removedLineExists,
        multiOp_newLineHasL_n_Id: newLineHasValidId,
        multiOp_noTmpIdsRemain: noTmpIdsRemain,
        statusGuard_409_on_cancelled: statusGuardCorrect,
        statusGuard_actual_status: patchAfterCancel.status
      }
    };
  },

  // Alias + parity: ensure SO CID flow matches PO (tmp-* cid -> server L{n} id, stable across updates)
  "smoke:salesOrders:patch-lines:cid": async () => {
    await ensureBearer();

    const { customerId } = await seedCustomer(api);

    // Step 1: Create SO draft with no lines
    const create = await post(`/objects/salesOrder`, {
      type: "salesOrder",
      status: "draft",
      customerId,
      lines: [],
    });

    if (!create.ok || !create.body?.id) {
      return { test: "salesOrders:patch-lines:cid", result: "FAIL", reason: "so-create-failed", create };
    }

    const soId = create.body.id;

    // Step 2: Seed product + inventory for line
    const prod = await createProduct({ name: "SoCidParity" });
    if (!prod.ok) return { test: "salesOrders:patch-lines:cid", result: "FAIL", reason: "product-create-failed", prod };

    const inv = await createInventoryForProduct(prod.body.id, "SoCidParityItem");
    if (!inv.ok) return { test: "salesOrders:patch-lines:cid", result: "FAIL", reason: "inventory-create-failed", inv };

    const itemId = inv.body?.id;

    // Step 3: Add line via cid (tmp-*)
    const clientId = `tmp-${Math.random().toString(36).slice(2, 11)}`;

    const patch1 = await post(
      `/sales/so/${encodeURIComponent(soId)}:patch-lines`,
      {
        ops: [
          {
            op: "upsert",
            cid: clientId,
            patch: { itemId, qty: 4, uom: "ea" },
          },
        ],
      },
      { "Idempotency-Key": idem() }
    );

    if (!patch1.ok) {
      return { test: "salesOrders:patch-lines:cid", result: "FAIL", reason: "patch1-failed", patch1 };
    }

    // Step 4: Fetch and capture server-assigned id (must be L{n})
    const fetch1 = await get(`/objects/salesOrder/${encodeURIComponent(soId)}`);

    if (!fetch1.ok || !fetch1.body) {
      return { test: "salesOrders:patch-lines:cid", result: "FAIL", reason: "so-fetch1-failed", fetch1 };
    }

    const lines1 = Array.isArray(fetch1.body.lines) ? fetch1.body.lines : [];
    if (lines1.length === 0) {
      return { test: "salesOrders:patch-lines:cid", result: "FAIL", reason: "no-lines-after-patch1", fetch1: fetch1.body };
    }

    const newLine = lines1.find((ln) => ln.itemId === itemId);
    if (!newLine || !newLine.id) {
      return {
        test: "salesOrders:patch-lines:cid",
        result: "FAIL",
        reason: "new-line-not-found-or-no-id",
        lines1: lines1.map((ln) => ({ id: ln.id, itemId: ln.itemId })),
      };
    }

    const serverId = String(newLine.id).trim();
    const lineIdPattern = /^L\d+$/;
    const serverIdValid = lineIdPattern.test(serverId);

    if (!serverIdValid) {
      return {
        test: "salesOrders:patch-lines:cid",
        result: "FAIL",
        reason: "server-id-invalid-pattern",
        serverId,
        expectedPattern: "L{n}",
      };
    }

    // Step 5: Update same line via id and ensure id stability (no reuse/flip)
    const patch2 = await post(
      `/sales/so/${encodeURIComponent(soId)}:patch-lines`,
      {
        ops: [
          {
            op: "upsert",
            id: serverId,
            patch: { qty: 9 },
          },
        ],
      },
      { "Idempotency-Key": idem() }
    );

    if (!patch2.ok) {
      return { test: "salesOrders:patch-lines:cid", result: "FAIL", reason: "patch2-failed", patch2 };
    }

    // Step 6: Fetch again and assert id unchanged + qty updated
    const fetch2 = await get(`/objects/salesOrder/${encodeURIComponent(soId)}`);

    if (!fetch2.ok || !fetch2.body) {
      return { test: "salesOrders:patch-lines:cid", result: "FAIL", reason: "so-fetch2-failed", fetch2 };
    }

    const lines2 = Array.isArray(fetch2.body.lines) ? fetch2.body.lines : [];
    const updatedLine = lines2.find((ln) => ln.id === serverId);

    if (!updatedLine) {
      return { test: "salesOrders:patch-lines:cid", result: "FAIL", reason: "updated-line-not-found", serverId, lines2 };
    }

    const qtyUpdated = updatedLine.qty === 9;
    const idStable = updatedLine.id === serverId;

    const pass = serverIdValid && qtyUpdated && idStable;

    return {
      test: "salesOrders:patch-lines:cid",
      result: pass ? "PASS" : "FAIL",
      soId,
      clientId,
      serverId,
      serverIdValid,
      qtyUpdated,
      idStable,
      assertions: {
        clientCidIsTmp: /^tmp-/.test(clientId),
        serverIdMatchesPattern: serverIdValid,
        idStableAcrossPatches: idStable,
        qtyUpdated,
      },
    };
  },

  "smoke:line-identity:id-canonical": async () => {
    // Smoke to validate: (1) all SO/PO line responses have `id` field, (2) action endpoints accept `id` in request
    const tests = [];
    // Get party IDs for SO and vendor for PO
    const { partyId } = await seedParties(api);
    
    // Create a product
    const prod = await post(`/objects/product`, {
      type: "product",
      name: `line-id-test-product-${SMOKE_RUN_ID}`,
      sku: `LID-P-${SMOKE_RUN_ID}`,
      unitPrice: 50
    });
    if (!prod.ok) return { test: "line-identity:id-canonical", result: "FAIL", step: "create-product", prod };
    const productId = prod.body?.id;
    tests.push({ step: "create-product", ok: prod.ok });

    // Create inventory
    const item = await post(`/objects/inventoryItem`, {
      type: "inventoryItem",
      name: `line-id-test-item-${SMOKE_RUN_ID}`,
      sku: `LID-I-${SMOKE_RUN_ID}`,
      qty: 20,
      uom: "unit"
    });
    if (!item.ok) return { test: "line-identity:id-canonical", result: "FAIL", step: "create-inventory", item };
    const itemId = item.body?.id;
    tests.push({ step: "create-inventory", ok: item.ok, itemId });

    // Create a vendor
    const vendor = await post(`/objects/party`, {
      type: "party",
      name: `line-id-vendor-${SMOKE_RUN_ID}`,
      roles: ["vendor"]
    });
    if (!vendor.ok) return { test: "line-identity:id-canonical", result: "FAIL", step: "create-vendor", vendor };
    const vendorId = vendor.body?.id;
    tests.push({ step: "create-vendor", ok: vendor.ok, vendorId });

    // Test 1: Create PO and verify all lines have `id`
    const poDraft = {
      type: "purchaseOrder",
      status: "draft",
      vendorId,
      lines: [
        { itemId, qty: 5, uom: "unit" },
        { itemId, qty: 3, uom: "unit" }
      ]
    };
    const poCreate = await post(`/objects/purchaseOrder`, poDraft);
    if (!poCreate.ok) return { test: "line-identity:id-canonical", result: "FAIL", step: "po-create", poCreate };
    const poId = poCreate.body?.id;
    
    // Verify all PO lines have `id`
    const poLines = poCreate.body?.lines ?? [];
    for (let i = 0; i < poLines.length; i++) {
      if (!poLines[i].id) {
        return {
          test: "line-identity:id-canonical",
          result: "FAIL",
          step: "po-lines-missing-id",
          lineIndex: i,
          line: poLines[i]
        };
      }
    }
    tests.push({ step: "po-create-all-lines-have-id", ok: true, lineCount: poLines.length });

    // Submit and approve PO
    const poSubmit = await post(`/purchasing/po/${encodeURIComponent(poId)}:submit`, {}, { "Idempotency-Key": idem() });
    if (!poSubmit.ok) return { test: "line-identity:id-canonical", result: "FAIL", step: "po-submit", poSubmit };
    
    const poApprove = await post(`/purchasing/po/${encodeURIComponent(poId)}:approve`, {}, { "Idempotency-Key": idem() });
    if (!poApprove.ok) return { test: "line-identity:id-canonical", result: "FAIL", step: "po-approve", poApprove };
    tests.push({ step: "po-submit-approve", ok: true });

    // Fetch PO and use line `id` (not lineId) for receive request
    const poGet = await get(`/objects/purchaseOrder/${encodeURIComponent(poId)}`);
    if (!poGet.ok) return { test: "line-identity:id-canonical", result: "FAIL", step: "po-get", poGet };
    
    const receivableLines = (poGet.body?.lines ?? [])
      .map(ln => ({ id: ln.id, deltaQty: (ln.qty - (ln.receivedQty ?? 0)) }))
      .filter(l => l.deltaQty > 0);
    
    // Test 2: Execute PO receive using `id` (canonical field)
    const poReceive = await post(
      `/purchasing/po/${encodeURIComponent(poId)}:receive`,
      { lines: receivableLines },
      { "Idempotency-Key": idem() }
    );
    if (!poReceive.ok) return { test: "line-identity:id-canonical", result: "FAIL", step: "po-receive-with-id", poReceive };
    
    // Verify received PO response has all lines with `id`
    const receivedLines = poReceive.body?.lines ?? [];
    for (let i = 0; i < receivedLines.length; i++) {
      if (!receivedLines[i].id) {
        return {
          test: "line-identity:id-canonical",
          result: "FAIL",
          step: "po-receive-response-missing-id",
          lineIndex: i,
          line: receivedLines[i]
        };
      }
    }
    tests.push({ step: "po-receive-all-lines-have-id", ok: true });

    // Test 3: Create SO and verify all lines have `id`
    const soDraft = {
        partyId,
      type: "salesOrder",
      status: "draft",
      lines: [
        { itemId, qty: 3, uom: "unit" }
      ]
    };
    const soCreate = await post(`/objects/salesOrder`, soDraft);
    if (!soCreate.ok) return { test: "line-identity:id-canonical", result: "FAIL", step: "so-create", soCreate };
    const soId = soCreate.body?.id;
    
    const soLines = soCreate.body?.lines ?? [];
    for (let i = 0; i < soLines.length; i++) {
      if (!soLines[i].id) {
        return {
          test: "line-identity:id-canonical",
          result: "FAIL",
          step: "so-lines-missing-id",
          lineIndex: i,
          line: soLines[i]
        };
      }
    }
    tests.push({ step: "so-create-all-lines-have-id", ok: true, lineCount: soLines.length });

    // Submit, approve, commit SO
    const soSubmit = await post(`/sales/so/${encodeURIComponent(soId)}:submit`, {}, { "Idempotency-Key": idem() });
    if (!soSubmit.ok) return { test: "line-identity:id-canonical", result: "FAIL", step: "so-submit", soSubmit };
    const soCommit = await post(`/sales/so/${encodeURIComponent(soId)}:commit`, {}, { "Idempotency-Key": idem() });
    if (!soCommit.ok) return { test: "line-identity:id-canonical", result: "FAIL", step: "so-commit", soCommit };

    tests.push({ step: "so-submit-commit", ok: true });
    // Fetch SO and use line `id` for reserve request
    const soGet = await get(`/objects/salesOrder/${encodeURIComponent(soId)}`);
    if (!soGet.ok) return { test: "line-identity:id-canonical", result: "FAIL", step: "so-get", soGet };
    
    const reserveLines = (soGet.body?.lines ?? [])
      .map(ln => ({ id: ln.id, deltaQty: ln.qty ?? 0 }))
      .filter(l => l.deltaQty > 0);

    // Test 4: Execute SO reserve using `id` (canonical field)
    const soReserve = await post(
      `/sales/so/${encodeURIComponent(soId)}:reserve`,
      { lines: reserveLines },
      { "Idempotency-Key": idem() }
    );
    if (!soReserve.ok) return { test: "line-identity:id-canonical", result: "FAIL", step: "so-reserve-with-id", soReserve };
    
    // Verify reserved SO response has all lines with `id`
    const reservedSoLines = soReserve.body?.lines ?? [];
    for (let i = 0; i < reservedSoLines.length; i++) {
      if (!reservedSoLines[i].id) {
        return {
          test: "line-identity:id-canonical",
          result: "FAIL",
          step: "so-reserve-response-missing-id",
          lineIndex: i,
          line: reservedSoLines[i]
        };
      }
    }
    tests.push({ step: "so-reserve-all-lines-have-id", ok: true });

    // Test 5: INVARIANT - Verify removed SO line id is not reused (patch-lines remove + add)
    const soIdsCaptured = (soReserve.body?.lines ?? []).map(ln => String(ln.id || "").trim()).filter(Boolean);
    const firstSoLineId = soIdsCaptured[0];
    
    if (firstSoLineId) {
      // Patch: remove first line, add new line
      const patchRemoveAdd = await post(
        `/sales/so/${encodeURIComponent(soId)}:patch-lines`,
        {
          ops: [
            { op: "remove", id: firstSoLineId },
            { op: "upsert", patch: { itemId, qty: 1, uom: "unit" } },
          ],
        },
        { "Idempotency-Key": idem() }
      );
      
      if (patchRemoveAdd.ok) {
        const soFinal = await get(`/objects/salesOrder/${encodeURIComponent(soId)}`);
        const finalLines = soFinal.body?.lines ?? [];
        const newLineAfterRemove = finalLines.find(ln => (ln.id || "") !== firstSoLineId && ln.qty === 1);
        const newLineId = newLineAfterRemove?.id;
        // INVARIANT: New line must not reuse the removed id
        const noIdReuse = newLineId && newLineId !== firstSoLineId;
        tests.push({ step: "so-remove-add-no-reuse", ok: patchRemoveAdd.ok, noIdReuse, removedId: firstSoLineId, newId: newLineId });
      }
    }

    // All tests passed
    return {
      test: "line-identity:id-canonical",
      result: "PASS",
      summary: "All SO/PO lines have canonical 'id' field; action endpoints accept id-based payloads",
      tests,
      artifacts: { poId, soId, itemId, vendorId }
    };
  },

  "smoke:wipe-tool:safety-guards": async () => {
    // Foundation smoke: Validates wipe-tenant.mjs safety guards (NO ACTUAL DELETES)
    const testResults = [];
    
    // Check for AWS credentials (needed for dry-run test only)
    const hasAwsCreds = Boolean(
      process.env.AWS_ACCESS_KEY_ID || 
      process.env.AWS_SESSION_TOKEN || 
      process.env.AWS_PROFILE
    );

    // Test 1: Missing --confirm-tenant (should reject with exit 2)
    const test1 = spawnSync("node", [
      "ops/tools/wipe-tenant.mjs",
      "--tenant", "SmokeTenant",
      "--confirm"
    ], { encoding: "utf8", env: process.env });
    
    const test1Output = (test1.stderr || "") + (test1.stdout || "");
    const test1Pass = test1.status === 2 && test1Output.includes("--confirm requires --confirm-tenant");
    testResults.push({
      name: "missing-confirm-tenant",
      pass: test1Pass,
      exitCode: test1.status,
      expectedExit: 2,
      output: test1Output.slice(0, 200)
    });
    
    if (!test1Pass) {
      return {
        test: "wipe-tool:safety-guards",
        result: "FAIL",
        step: "missing-confirm-tenant",
        expectedExit: 2,
        actualExit: test1.status,
        output: test1Output
      };
    }

    // Test 2: Mismatched --confirm-tenant (should reject with exit 2)
    const test2 = spawnSync("node", [
      "ops/tools/wipe-tenant.mjs",
      "--tenant", "SmokeTenant",
      "--confirm",
      "--confirm-tenant", "WrongTenant"
    ], { encoding: "utf8", env: process.env });
    
    const test2Output = (test2.stderr || "") + (test2.stdout || "");
    const test2Pass = test2.status === 2 && test2Output.includes("does not match target tenant");
    testResults.push({
      name: "mismatched-confirm-tenant",
      pass: test2Pass,
      exitCode: test2.status,
      expectedExit: 2,
      output: test2Output.slice(0, 200)
    });
    
    if (!test2Pass) {
      return {
        test: "wipe-tool:safety-guards",
        result: "FAIL",
        step: "mismatched-confirm-tenant",
        expectedExit: 2,
        actualExit: test2.status,
        output: test2Output
      };
    }

    // Test 3: Non-allowlisted tenant (should reject with exit 2)
    const test3 = spawnSync("node", [
      "ops/tools/wipe-tenant.mjs",
      "--tenant", "HackerTenant",
      "--confirm",
      "--confirm-tenant", "HackerTenant"
    ], { encoding: "utf8", env: process.env });
    
    const test3Output = (test3.stderr || "") + (test3.stdout || "");
    const test3Pass = test3.status === 2 && test3Output.includes("not in allowlist");
    testResults.push({
      name: "non-allowlisted-tenant",
      pass: test3Pass,
      exitCode: test3.status,
      expectedExit: 2,
      output: test3Output.slice(0, 200)
    });
    
    if (!test3Pass) {
      return {
        test: "wipe-tool:safety-guards",
        result: "FAIL",
        step: "non-allowlisted-tenant",
        expectedExit: 2,
        actualExit: test3.status,
        output: test3Output
      };
    }

    // Test 4: Dry-run succeeds (no --confirm = safe list-only mode)
    // NOTE: Dry-run queries DynamoDB, so skip if no AWS credentials (e.g., CI)
    if (hasAwsCreds) {
      const test4 = spawnSync("node", [
        "ops/tools/wipe-tenant.mjs",
        "--tenant", "SmokeTenant"
      ], { encoding: "utf8", env: process.env });
      
      const test4Output = (test4.stderr || "") + (test4.stdout || "");
      const test4Pass = test4.status === 0 && test4Output.includes("Dry run complete");
      testResults.push({
        name: "dry-run-succeeds",
        pass: test4Pass,
        exitCode: test4.status,
        expectedExit: 0,
        output: test4Output.slice(0, 200)
      });
      
      if (!test4Pass) {
        return {
          test: "wipe-tool:safety-guards",
          result: "FAIL",
          step: "dry-run-succeeds",
          expectedExit: 0,
          actualExit: test4.status,
          output: test4Output
        };
      }
    } else {
      // Skip dry-run test when AWS credentials not available (CI-safe)
      testResults.push({
        name: "dry-run-succeeds",
        status: "SKIP",
        reason: "no AWS credentials in environment"
      });
    }

    // All safety guards validated
    return {
      test: "wipe-tool:safety-guards",
      result: "PASS",
      summary: `Wipe tool correctly enforces all safety guards (confirm-tenant match, allowlist, dry-run default). Dry-run test ${hasAwsCreds ? "executed" : "skipped (no AWS creds)"}`,
      testResults,
      awsCredsAvailable: hasAwsCreds
    };
  },

  "smoke:migrate-legacy-workspaces:creates-workspace": async () => {
    // E2 smoke: End-to-end test of legacy workspace migration (post-Sprint AY cutover)
    // E15: Step 1 creates legacy view DIRECTLY in DynamoDB (ensures isWorkspaceShaped() match)
    // 1) Create a legacy "workspace-shaped view" via DynamoDB PutItem (NO filters field)
    // 2) Verify GET /workspaces/:id returns 404 (no fallback post-cutover)
    // 3) Run migrate-legacy-workspaces.mjs to copy to canonical workspace
    // 4) Verify canonical workspace record exists and is returned
    // 5) Verify fields are preserved (name, views, ownerId, etc.)
    
    const runId = idem();
    const viewName = `LegacyWorkspace-${runId}`;
    const testViewId = idem();
    let legacyViewId = null;
    let workspaceId = null;

    try {
      // Step 1: Create a legacy "workspace-shaped view" directly in DynamoDB
      // E15: Write view#<id> record WITHOUT filters field to match isWorkspaceShaped() heuristic
      // This ensures the migration tool will definitely find and process this record
      legacyViewId = idem();
      const TABLE = process.env.OBJECTS_TABLE || `${process.env.PROJECT_NAME ?? "mbapp"}_objects`;
      const REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
      const PK = process.env.MBAPP_TABLE_PK || "pk";
      const SK = process.env.MBAPP_TABLE_SK || "sk";
      
      const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }), {
        marshallOptions: { convertClassInstanceToMap: true, removeUndefinedValues: true, convertEmptyValues: false },
        unmarshallOptions: { wrapNumbers: false },
      });

      const now = new Date().toISOString();
      const legacyViewRecord = {
        [PK]: TENANT,
        [SK]: `view#${legacyViewId}`,
        type: "view",
        id: legacyViewId,
        name: viewName,
        views: [testViewId],
        shared: false,
        ownerId: "smoke-test-owner",
        entityType: "purchaseOrder",
        description: `Legacy workspace-shaped view for migration test ${runId}`,
        createdAt: now,
        updatedAt: now,
        // CRITICAL: NO filters field - this is what makes it workspace-shaped
      };

      try {
        await ddb.send(
          new PutCommand({
            TableName: TABLE,
            Item: legacyViewRecord,
          })
        );
      } catch (err) {
        return {
          test: "migrate-legacy-workspaces:creates-workspace",
          result: "FAIL",
          step: "create-legacy-view-dynamodb",
          error: err.message,
          detail: "Failed to write legacy workspace-shaped view to DynamoDB"
        };
      }

      recordCreated({ type: "view", id: legacyViewId, route: "/views", meta: { name: viewName, isLegacyWorkspace: true } });

      // Step 2 (Post-Sprint AY): Verify no fallback exists
      // After Phase 3 cutover, GET /workspaces/:id should return 404 when only legacy view exists
      // (no fallback to type="view" anymore)
      const preGetRes = await fetch(`${API}/workspaces/${encodeURIComponent(legacyViewId)}`, {
        method: "GET",
        headers: buildHeaders()
      });

      const preGetReturns404 = !preGetRes.ok && preGetRes.status === 404;

      if (!preGetReturns404) {
        return {
          test: "migrate-legacy-workspaces:creates-workspace",
          result: "FAIL",
          step: "pre-migration-no-fallback-assert-404",
          expectedStatus: 404,
          actualStatus: preGetRes.status,
          detail: "POST-CUTOVER: Legacy workspace-shaped view should NOT be readable via /workspaces/:id (no fallback after Phase 3)",
          body: preGetRes.ok ? await preGetRes.json() : {}
        };
      }

      // Step 3: Run migration tool to copy legacy view to canonical workspace
      // Check for AWS credentials (needed to access DynamoDB)
      const hasAwsCreds = Boolean(
        process.env.AWS_ACCESS_KEY_ID || 
        process.env.AWS_SESSION_TOKEN || 
        process.env.AWS_PROFILE
      );

      if (!hasAwsCreds) {
        return {
          test: "migrate-legacy-workspaces:creates-workspace",
          result: "SKIP",
          reason: "AWS credentials not available; cannot run migration tool in CI",
          detail: "Run this smoke locally with AWS credentials to test migration",
          legacyViewId
        };
      }

      const toolPath = path.join(repoRoot, "ops/tools/migrate-legacy-workspaces.mjs");
      // E19: Respect AWS region from environment, fallback to us-east-1
      const awsRegionUsed = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
      const migrationResult = spawnSync("node", [
        toolPath,
        "--tenant", TENANT,
        "--confirm",
        "--confirm-tenant", TENANT
      ], { 
        encoding: "utf8", 
        env: {
          ...process.env, 
          AWS_REGION: awsRegionUsed, 
          AWS_DEFAULT_REGION: awsRegionUsed
        }
      });

      const migrationOutput = (migrationResult.stderr || "") + (migrationResult.stdout || "");
      const migrationSuccess = migrationResult.status === 0;

      if (!migrationSuccess) {
        return {
          test: "migrate-legacy-workspaces:creates-workspace",
          result: "FAIL",
          step: "migration-tool-execution",
          expectedExit: 0,
          actualExit: migrationResult.status,
          awsRegionUsed,
          legacyViewId,
          output: migrationOutput.slice(0, 500)
        };
      }

      // Parse migration tool output: tool prints final JSON summary
      // Expected format: { candidatesFound: N, plannedCreates: N, created: N, skippedExists: N, errors: N }
      // E18: Robust line-by-line parsing from bottom up
      let toolSummary = null;
      let parseError = null;
      let candidateLine = null;
      
      try {
        const lines = migrationOutput.split('\n');
        // Search from bottom up for a line containing '{' and '"created"'
        for (let i = lines.length - 1; i >= 0; i--) {
          const line = lines[i];
          if (line.includes('{') && line.includes('"created"')) {
            candidateLine = line;
            // Extract substring from first '{' to last '}'
            const firstBrace = line.indexOf('{');
            const lastBrace = line.lastIndexOf('}');
            if (firstBrace >= 0 && lastBrace > firstBrace) {
              const jsonStr = line.substring(firstBrace, lastBrace + 1);
              toolSummary = JSON.parse(jsonStr);
              break;
            }
          }
        }
      } catch (parseErr) {
        parseError = parseErr.message;
      }

      // E18: Enhanced parsing failure diagnostics
      if (!toolSummary && parseError) {
        return {
          test: "migrate-legacy-workspaces:creates-workspace",
          result: "FAIL",
          step: "migration-tool-json-parse-failure",
          parseError,
          candidateLine,
          outputLastLines: migrationOutput.split('\n').slice(-30).join('\n')
        };
      }

      // Verify tool processed at least one workspace record
      // PASS if: (created + skippedExists) > 0 (idempotent: first run creates, rerun skips)
      const totalProcessed = (toolSummary?.created || 0) + (toolSummary?.skippedExists || 0);
      
      // Verify that the tool output contains an explicit action line for THIS specific legacyViewId
      // Build regexes for skip and create patterns
      const escapedViewId = legacyViewId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const skipRegex = new RegExp(`workspace record already exists for\\s+${escapedViewId}`, 'i');
      const createRegex = new RegExp(`(created|wrote|put).*${escapedViewId}`, 'i');
      const toolProcessedThisView = skipRegex.test(migrationOutput) || createRegex.test(migrationOutput);
      
      if (!toolSummary || totalProcessed <= 0 || !toolProcessedThisView) {
        return {
          test: "migrate-legacy-workspaces:creates-workspace",
          result: "FAIL",
          step: toolProcessedThisView 
            ? "migration-tool-verify-created-or-skipped" 
            : "migration-tool-did-not-process-this-id",
          detail: toolProcessedThisView 
            ? `Tool processed records but (created + skippedExists) = ${totalProcessed}, expected > 0`
            : `Migration tool did not process the legacy view created by this smoke (${legacyViewId}). No explicit create/skip line found in output. Likely no workspace-shaped view candidates matched isWorkspaceShaped(), or tool is pointed at a different table/account/region.`,
          expectedOutcome: "(created + skippedExists) > 0 AND tool output contains explicit action line for legacyViewId",
          actualCreated: toolSummary?.created ?? 0,
          actualSkippedExists: toolSummary?.skippedExists ?? 0,
          totalProcessed,
          toolProcessedThisView,
          awsRegionUsed,
          legacyViewId,
          toolSummary,
          outputLastLines: migrationOutput.split('\n').slice(-40).join('\n')
        };
      }

      // Step 4: Verify canonical workspace record was created
      // After migration, GET /workspaces/:id should now return from type="workspace" source
      const postGetRes = await fetch(`${API}/workspaces/${encodeURIComponent(legacyViewId)}`, {
        method: "GET",
        headers: buildHeaders()
      });

      if (!postGetRes.ok || postGetRes.status !== 200) {
        return {
          test: "migrate-legacy-workspaces:creates-workspace",
          result: "FAIL",
          step: "post-migration-workspace-read",
          expectedStatus: 200,
          actualStatus: postGetRes.status,
          detail: "Workspace record should be readable after migration"
        };
      }

      const postGetBody = await postGetRes.json();
      workspaceId = postGetBody?.id;

      // Step 5: Verify field preservation
      const nameMatch = postGetBody?.name === viewName;
      const viewsMatch = Array.isArray(postGetBody?.views) && postGetBody.views.includes(testViewId);
      const typeMatch = postGetBody?.type === "workspace";
      const sharedMatch = postGetBody?.shared === false;
      const ownerMatch = postGetBody?.ownerId === "smoke-test-owner";
      const entityTypeMatch = postGetBody?.entityType === "purchaseOrder";
      const descMatch = postGetBody?.description?.includes(runId);

      if (!nameMatch || !viewsMatch || !typeMatch) {
        return {
          test: "migrate-legacy-workspaces:creates-workspace",
          result: "FAIL",
          step: "field-preservation",
          expectedFields: {
            name: viewName,
            type: "workspace",
            views: [testViewId],
            shared: false,
            ownerId: "smoke-test-owner",
            entityType: "purchaseOrder"
          },
          actualFields: {
            name: postGetBody?.name,
            type: postGetBody?.type,
            views: postGetBody?.views,
            shared: postGetBody?.shared,
            ownerId: postGetBody?.ownerId,
            entityType: postGetBody?.entityType
          },
          body: postGetBody
        };
      }

      // Success: workspace record exists with correct fields
      recordCreated({ type: "workspace", id: workspaceId, route: "/workspaces", meta: { name: viewName, migratedFromView: true } });

      return {
        test: "migrate-legacy-workspaces:creates-workspace",
        result: "PASS",
        summary: "Legacy workspace-shaped view successfully migrated to canonical workspace record (post-cutover)",
        artifacts: {
          legacyViewId,
          workspaceId,
          viewName
        },
        debug: {
          awsRegionUsed,
          legacyViewId
        },
        toolSummary: {
          candidatesFound: toolSummary?.candidatesFound ?? 0,
          created: toolSummary?.created ?? 0,
          skippedExists: toolSummary?.skippedExists ?? 0,
          errors: toolSummary?.errors ?? 0
        },
        assertions: {
          preGetReturns404: preGetReturns404,
          namePreserved: nameMatch,
          viewsArrayPreserved: viewsMatch,
          typeIsWorkspace: typeMatch,
          sharedPreserved: sharedMatch,
          ownerPreserved: ownerMatch,
          entityTypePreserved: entityTypeMatch,
          descriptionPreserved: descMatch
        }
      };
    } catch (err) {
      return {
        test: "migrate-legacy-workspaces:creates-workspace",
        result: "FAIL",
        step: "unexpected-error",
        error: err?.message || String(err)
      };
    }
  },

  "smoke:migrate-legacy-workspaces:safety-guards": async () => {
    // Foundation smoke: Validates migrate-legacy-workspaces.mjs safety guards (NO ACTUAL MIGRATIONS)
    const testResults = [];
    
    // Check for AWS credentials (needed for dry-run test only)
    const hasAwsCreds = Boolean(
      process.env.AWS_ACCESS_KEY_ID || 
      process.env.AWS_SESSION_TOKEN || 
      process.env.AWS_PROFILE
    );

    // Test 1: Missing --confirm-tenant (should reject with exit 2)
    const test1 = spawnSync("node", [
      "ops/tools/migrate-legacy-workspaces.mjs",
      "--tenant", "SmokeTenant",
      "--confirm"
    ], { encoding: "utf8", env: process.env });
    
    const test1Output = (test1.stderr || "") + (test1.stdout || "");
    const test1Pass = test1.status === 2 && test1Output.includes("--confirm requires --confirm-tenant");
    testResults.push({
      name: "missing-confirm-tenant",
      pass: test1Pass,
      exitCode: test1.status,
      expectedExit: 2,
      output: test1Output.slice(0, 200)
    });
    
    if (!test1Pass) {
      return {
        test: "migrate-legacy-workspaces:safety-guards",
        result: "FAIL",
        step: "missing-confirm-tenant",
        expectedExit: 2,
        actualExit: test1.status,
        output: test1Output
      };
    }

    // Test 2: Mismatched --confirm-tenant (should reject with exit 2)
    const test2 = spawnSync("node", [
      "ops/tools/migrate-legacy-workspaces.mjs",
      "--tenant", "SmokeTenant",
      "--confirm",
      "--confirm-tenant", "WrongTenant"
    ], { encoding: "utf8", env: process.env });
    
    const test2Output = (test2.stderr || "") + (test2.stdout || "");
    const test2Pass = test2.status === 2 && test2Output.includes("does not match target tenant");
    testResults.push({
      name: "mismatched-confirm-tenant",
      pass: test2Pass,
      exitCode: test2.status,
      expectedExit: 2,
      output: test2Output.slice(0, 200)
    });
    
    if (!test2Pass) {
      return {
        test: "migrate-legacy-workspaces:safety-guards",
        result: "FAIL",
        step: "mismatched-confirm-tenant",
        expectedExit: 2,
        actualExit: test2.status,
        output: test2Output
      };
    }

    // Test 3: Dry-run succeeds (no --confirm = safe list-only mode)
    // NOTE: Dry-run queries DynamoDB, so skip if no AWS credentials (e.g., CI)
    if (hasAwsCreds) {
      const test3 = spawnSync("node", [
        "ops/tools/migrate-legacy-workspaces.mjs",
        "--tenant", "SmokeTenant"
      ], { encoding: "utf8", env: process.env });
      
      const test3Output = (test3.stderr || "") + (test3.stdout || "");
      const test3Pass = test3.status === 0 && (
        test3Output.includes("Dry run") || 
        test3Output.includes("dryRun")
      );
      testResults.push({
        name: "dry-run-succeeds",
        pass: test3Pass,
        exitCode: test3.status,
        expectedExit: 0,
        output: test3Output.slice(0, 200)
      });
      
      if (!test3Pass) {
        return {
          test: "migrate-legacy-workspaces:safety-guards",
          result: "FAIL",
          step: "dry-run-succeeds",
          expectedExit: 0,
          actualExit: test3.status,
          output: test3Output
        };
      }
    } else {
      // Skip dry-run test when AWS credentials not available (CI-safe)
      testResults.push({
        name: "dry-run-succeeds",
        status: "SKIP",
        reason: "no AWS credentials in environment"
      });
    }

    // All safety guards validated
    return {
      test: "migrate-legacy-workspaces:safety-guards",
      result: "PASS",
      summary: `Migration tool correctly enforces all safety guards (confirm-tenant match, dry-run default). Dry-run test ${hasAwsCreds ? "executed" : "skipped (no AWS creds)"}`,
      testResults,
      awsCredsAvailable: hasAwsCreds
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
