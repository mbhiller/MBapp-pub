#!/usr/bin/env node
// Usage: node ops/tools/seed-epc-map.mjs --epc=EPC123 --item-id=ITEM-001 --yes [--tenant=T] [--base=https://api] [--status=approved,submitted]
//    or: node ops/tools/seed-epc-map.mjs --epc=EPC123 --po-id=PO123 [--line-id=L1] --yes [--tenant=T] [--base=https://api] [--status=approved,submitted]
//    or: node ops/tools/seed-epc-map.mjs --list-pos [--tenant=T] [--base=https://api] [--status=approved,submitted]
//    or: node ops/tools/seed-epc-map.mjs --epc=EPC123 --pick-po --yes [--tenant=T] [--base=https://api] [--status=approved,submitted]
// Defaults: tenant from MBAPP_TENANT_ID|MBAPP_SMOKE_TENANT_ID, base from MBAPP_API_BASE
import process from "process";

function parseArgs(argv) {
  const opts = { yes: false };
  for (const arg of argv) {
    if (arg === "--yes") opts.yes = true;
    else if (arg.startsWith("--epc=")) opts.epc = arg.split("=")[1];
    else if (arg.startsWith("--item-id=")) opts.itemId = arg.split("=")[1];
    else if (arg.startsWith("--po-id=")) opts.poId = arg.split("=")[1];
    else if (arg.startsWith("--line-id=")) opts.lineId = arg.split("=")[1];
    else if (arg === "--list-pos") opts.listPos = true;
    else if (arg === "--pick-po") opts.pickPo = true;
    else if (arg.startsWith("--tenant=")) opts.tenant = arg.split("=")[1];
    else if (arg.startsWith("--base=")) opts.base = arg.split("=")[1];
    else if (arg.startsWith("--status=")) opts.status = arg.split("=")[1];
  }
  return opts;
}

function usage() {
  console.error("Usage:");
  console.error("  node ops/tools/seed-epc-map.mjs --epc=EPC --item-id=ITEM --yes [--tenant=T] [--base=URL] [--status=approved,submitted]");
  console.error("  node ops/tools/seed-epc-map.mjs --epc=EPC --po-id=PO --yes [--line-id=L1] [--tenant=T] [--base=URL] [--status=approved,submitted]");
  console.error("  node ops/tools/seed-epc-map.mjs --list-pos [--tenant=T] [--base=URL] [--status=approved,submitted]");
  console.error("  node ops/tools/seed-epc-map.mjs --epc=EPC --pick-po --yes [--tenant=T] [--base=URL] [--status=approved,submitted]");
}

const argv = parseArgs(process.argv.slice(2));
const BASE = (argv.base || process.env.MBAPP_API_BASE || "https://ki8kgivz1f.execute-api.us-east-1.amazonaws.com").replace(/\/$/, "");
const TENANT = argv.tenant || process.env.MBAPP_TENANT_ID || process.env.MBAPP_SMOKE_TENANT_ID || "";
const BEARER = process.env.MBAPP_BEARER || process.env.DEV_API_TOKEN || "";
const DEFAULT_STATUS = ["approved", "submitted", "partially-received"];
const STATUS_LIST = (argv.status ? argv.status.split(",") : DEFAULT_STATUS)
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
const STATUS_SET = new Set(STATUS_LIST);

if (!argv.listPos && !argv.pickPo && (!argv.epc || (!argv.itemId && !argv.poId))) {
  console.error("[seed-epc-map] Missing --epc and either --item-id or --po-id (unless using --list-pos)");
  usage();
  process.exit(1);
}
if (!argv.listPos && !argv.pickPo && !argv.yes) {
  console.error("[seed-epc-map] Refusing to write without --yes");
  usage();
  process.exit(1);
}
if (!TENANT) {
  console.error("[seed-epc-map] Missing tenant (set MBAPP_TENANT_ID or MBAPP_SMOKE_TENANT_ID or pass --tenant)");
  process.exit(1);
}
if (!BEARER) {
  console.error("[seed-epc-map] Missing bearer token (set MBAPP_BEARER or DEV_API_TOKEN)");
  process.exit(1);
}

const headers = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${BEARER}`,
  "X-Tenant-Id": TENANT,
};

async function getJson(path) {
  const resp = await fetch(`${BASE}${path}`, { headers });
  const text = await resp.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { resp, body };
}

async function getJsonWithQuery(path, query) {
  const qs = query
    ? "?" + Object.entries(query).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&")
    : "";
  return getJson(`${path}${qs}`);
}

function remainingForLine(line) {
  const qty = Number(line?.qty ?? line?.orderedQty ?? 0);
  const received = Number(line?.receivedQty ?? 0);
  return Math.max(0, qty - received);
}

function statusAllowed(po) {
  const status = String(po?.status ?? "").toLowerCase();
  return STATUS_SET.size === 0 || STATUS_SET.has(status);
}

function pickLine(po, preferredLineId) {
  const lines = Array.isArray(po?.lines) ? po.lines : [];
  if (!lines.length) throw new Error("PO has no lines");
  if (preferredLineId) {
    const found = lines.find((ln) => String(ln?.id ?? ln?.lineId ?? "") === String(preferredLineId));
    if (!found) throw new Error(`Line ${preferredLineId} not found on PO`);
    return found;
  }
  const withRemaining = lines.filter((ln) => remainingForLine(ln) > 0);
  if (!withRemaining.length) throw new Error("No lines with remaining qty on PO");
  return withRemaining[0];
}

async function resolveItemId() {
  if (argv.itemId) return argv.itemId;
  if (argv.pickPo && !argv.poId) {
    const picked = await pickPoFromList();
    argv.poId = picked?.id;
    if (!argv.poId) throw new Error("Failed to pick a PO");
  }
  if (!argv.poId) throw new Error("poId required when item-id is absent");
  const { body, pathTried } = await fetchPoWithFallback(argv.poId);
  const line = pickLine(body, argv.lineId);
  const itemId = line?.itemId;
  if (!itemId) throw new Error("Selected line has no itemId");
  const remaining = remainingForLine(line);
  console.log(`[seed-epc-map] Using PO line ${line.id ?? line.lineId} itemId=${itemId} remaining=${remaining}`);
  return itemId;
}

async function fetchPoWithFallback(poId) {
  const primary = `/purchasing/po/${encodeURIComponent(poId)}`;
  const fallback = `/objects/purchaseOrder/${encodeURIComponent(poId)}`;
  const first = await getJson(primary);
  if (first.resp.ok) return { body: first.body, pathTried: primary };
  const second = await getJson(fallback);
  if (second.resp.ok) return { body: second.body, pathTried: fallback };
  throw new Error(`Failed to fetch PO ${poId} tenant=${TENANT} base=${BASE} paths=[${primary},${fallback}] status=[${first.resp.status},${second.resp.status}]`);
}

async function listPurchaseOrders(limit = 10) {
  const { resp, body } = await getJsonWithQuery(`/objects/purchaseOrder`, { limit, sort: "desc" });
  if (!resp.ok) throw new Error(`List POs failed status=${resp.status}`);
  const items = Array.isArray(body?.items) ? body.items : [];
  return items.filter((po) => statusAllowed(po));
}

async function pickPoFromList() {
  const items = await listPurchaseOrders(25);
  if (!items.length) {
    console.log(`[seed-epc-map] No POs found matching status in [${STATUS_LIST.join(",") || "any"}]`);
    return null;
  }
  const chosen = items.find((po) => Array.isArray(po?.lines) && po.lines.some((ln) => remainingForLine(ln) > 0)) || items[0];
  if (chosen) {
    console.log(
      `[seed-epc-map] pick-po selected id=${chosen.id} status=${chosen.status} lines=${Array.isArray(chosen.lines) ? chosen.lines.length : 0} allowed=[${STATUS_LIST.join(",")}]`
    );
  }
  return chosen;
}

async function main() {
  if (argv.listPos) {
    const items = await listPurchaseOrders(25);
    if (!items.length) {
      console.log(`[seed-epc-map] No POs found matching status in [${STATUS_LIST.join(",") || "any"}]`);
    } else {
      items.forEach((po) => {
        const rem = Array.isArray(po?.lines)
          ? po.lines.reduce((acc, ln) => acc + remainingForLine(ln), 0)
          : 0;
        console.log(`${po.id} status=${po.status} lines=${Array.isArray(po?.lines) ? po.lines.length : 0} remaining=${rem}`);
      });
    }
    return;
  }
  if (argv.pickPo && !argv.yes) {
    console.error("[seed-epc-map] Refusing to write without --yes");
    usage();
    process.exit(1);
  }
  const itemId = await resolveItemId();
  const payload = { type: "epcMap", id: argv.epc, itemId };
  console.log(`[seed-epc-map] tenant=${TENANT}`);

  const putUrl = `${BASE}/objects/epcMap/${encodeURIComponent(argv.epc)}`;
  console.log(`[seed-epc-map] PUT ${putUrl}`);
  const putResp = await fetch(putUrl, { method: "PUT", headers, body: JSON.stringify(payload) });
  const putText = await putResp.text();
  let putBody = null;
  try { putBody = putText ? JSON.parse(putText) : null; } catch { putBody = putText; }
  console.log(`[seed-epc-map] put status=${putResp.status}`);

  if (putResp.ok) {
    console.log(`[seed-epc-map] body=`, putBody);
    return;
  }

  // Fallback: POST create (some tenants may not allow PUT for new ids)
  const postUrl = `${BASE}/objects/epcMap`;
  console.log(`[seed-epc-map] PUT failed, trying POST ${postUrl}`);
  const postResp = await fetch(postUrl, { method: "POST", headers, body: JSON.stringify(payload) });
  const postText = await postResp.text();
  let postBody = null;
  try { postBody = postText ? JSON.parse(postText) : null; } catch { postBody = postText; }
  console.log(`[seed-epc-map] post status=${postResp.status}`);
  console.log(`[seed-epc-map] body=`, postBody);
  if (!postResp.ok) process.exit(1);
}

main().catch((err) => {
  console.error("[seed-epc-map] error", err);
  process.exit(1);
});
