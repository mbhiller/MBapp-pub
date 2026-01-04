#!/usr/bin/env node
// Backorders audit + optional auto-ignore of orphans
// Usage:
//   MBAPP_API_BASE=... MBAPP_TENANT_ID=... MBAPP_BEARER=... node ops/tools/backorders-audit.mjs [--fix=ignore-orphans] [--limit=N]

import process from "process";

const BASE = (process.env.MBAPP_API_BASE || "https://ki8kgivz1f.execute-api.us-east-1.amazonaws.com").replace(/\/$/, "");
const TENANT = process.env.MBAPP_TENANT_ID || process.env.MBAPP_SMOKE_TENANT_ID || "";
const BEARER = process.env.MBAPP_BEARER || process.env.DEV_API_TOKEN || "";

function parseArgs(argv) {
  const opts = { fixMode: "none", limit: Infinity };
  for (const arg of argv) {
    if (arg.startsWith("--fix=")) opts.fixMode = arg.split("=")[1] || "none";
    else if (arg.startsWith("--limit=")) opts.limit = Number(arg.split("=")[1]) || opts.limit;
  }
  return opts;
}

const OPTIONS = parseArgs(process.argv.slice(2));

if (!TENANT) {
  console.error("[backorders-audit] Missing MBAPP_TENANT_ID (or MBAPP_SMOKE_TENANT_ID).");
  process.exit(1);
}
if (!BEARER) {
  console.error("[backorders-audit] Missing MBAPP_BEARER (or DEV_API_TOKEN).");
  process.exit(1);
}

const headers = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${BEARER}`,
  "X-Tenant-Id": TENANT,
};

async function fetchJson(path, { method = "GET", body } = {}) {
  const resp = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await resp.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { resp, json };
}

const counters = {
  scanned: 0,
  valid: 0,
  missingSo: 0,
  missingLine: 0,
  missingInventory: 0,
  fixedIgnored: 0,
};

function lineMatches(lines, target) {
  if (!target) return false;
  const arr = Array.isArray(lines) ? lines : [];
  return arr.some((ln) => {
    if (!ln || typeof ln !== "object") return false;
    const ids = [ln.id, ln.lineId, ln._key, ln.cid].filter(Boolean);
    return ids.includes(target);
  });
}

async function resolveSalesOrder(soId) {
  const { resp, json } = await fetchJson(`/objects/salesOrder/${encodeURIComponent(soId)}`);
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(`SO fetch failed status=${resp.status}`);
  return json;
}

async function resolveInventory(itemId) {
  // Try inventoryItem, then legacy inventory
  const tryPath = async (type) => {
    const { resp, json } = await fetchJson(`/objects/${type}/${encodeURIComponent(itemId)}`);
    return { resp, json };
  };
  let res = await tryPath("inventoryItem");
  if (res.resp.status === 404) {
    res = await tryPath("inventory");
  }
  if (res.resp.status === 404) return null;
  if (!res.resp.ok) throw new Error(`Inventory fetch failed status=${res.resp.status}`);
  return res.json;
}

async function listBackorders() {
  const items = [];
  let next = null;
  do {
    const body = { limit: 200, next: next || undefined };
    const { resp, json } = await fetchJson(`/objects/backorderRequest/search`, { method: "POST", body });
    if (!resp.ok) throw new Error(`Search failed status=${resp.status}`);
    const pageItems = Array.isArray(json?.items) ? json.items : [];
    items.push(...pageItems);
    next = json?.next || null;
    if (items.length >= OPTIONS.limit) break;
  } while (next);
  return items.slice(0, OPTIONS.limit);
}

async function ignoreBackorder(id) {
  const { resp, json } = await fetchJson(`/objects/backorderRequest/${encodeURIComponent(id)}:ignore`, { method: "POST" });
  if (!resp.ok) throw new Error(`ignore failed status=${resp.status}`);
  return json;
}

(async function main() {
  console.log(`[backorders-audit] tenant=${TENANT} base=${BASE} fixMode=${OPTIONS.fixMode} limit=${OPTIONS.limit}`);
  const backorders = await listBackorders();
  console.log(`[backorders-audit] fetched backorderRequests=${backorders.length}`);

  for (const bo of backorders) {
    counters.scanned++;
    const soId = bo?.soId;
    const soLineId = bo?.soLineId;
    const itemId = bo?.itemId;

    let so = null;
    let inv = null;
    let lineFound = false;

    try { so = soId ? await resolveSalesOrder(soId) : null; } catch (err) { console.warn("[audit] SO fetch error", soId, err?.message); }
    try { inv = itemId ? await resolveInventory(itemId) : null; } catch (err) { console.warn("[audit] inventory fetch error", itemId, err?.message); }
    if (so) {
      lineFound = lineMatches(so.lines, soLineId);
      if (!lineFound && Array.isArray(so?.lineItems)) lineFound = lineMatches(so.lineItems, soLineId);
    }

    const missingSo = !so;
    const missingLine = !!so && !lineFound;
    const missingInventory = !inv;

    if (!missingSo && !missingLine && !missingInventory) counters.valid++; else {
      if (missingSo) counters.missingSo++;
      if (missingLine) counters.missingLine++;
      if (missingInventory) counters.missingInventory++;

      if (OPTIONS.fixMode === "ignore-orphans" && bo?.status === "open") {
        try {
          await ignoreBackorder(bo.id);
          counters.fixedIgnored++;
          console.log(`[fix] ignored backorderRequest id=${bo.id} soId=${soId} itemId=${itemId}`);
        } catch (err) {
          console.error(`[fix] failed to ignore backorderRequest id=${bo.id}:`, err?.message || err);
        }
      }
    }
  }

  console.log("[backorders-audit] summary", counters);
  if (OPTIONS.fixMode === "ignore-orphans") {
    console.log(`[backorders-audit] fixedIgnored=${counters.fixedIgnored}`);
  }
})();
