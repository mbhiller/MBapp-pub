#!/usr/bin/env node
import process from "process";

const BASE = (process.env.MBAPP_API_BASE || "https://ki8kgivz1f.execute-api.us-east-1.amazonaws.com").replace(/\/$/, "");
const TENANT = process.env.MBAPP_TENANT_ID || process.env.MBAPP_SMOKE_TENANT_ID || "";
const BEARER = process.env.MBAPP_BEARER || process.env.DEV_API_TOKEN || "";

function parseArgs(argv) {
  const opts = { dryRun: false, yes: false, maxPages: 50, sleepMs: 150 };
  for (const arg of argv) {
    if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--yes") opts.yes = true;
    else if (arg.startsWith("--max-pages=")) opts.maxPages = Number(arg.split("=")[1]) || opts.maxPages;
    else if (arg.startsWith("--sleep-ms=")) opts.sleepMs = Number(arg.split("=")[1]) || opts.sleepMs;
  }
  return opts;
}

function usage() {
  console.error("Usage: node ops/tools/backfill-workspaces.mjs [--dry-run] [--yes] [--max-pages=N] [--sleep-ms=MS]");
}

const OPTIONS = parseArgs(process.argv.slice(2));

if (!TENANT) {
  console.error("[backfill-workspaces] Missing MBAPP_TENANT_ID (or MBAPP_SMOKE_TENANT_ID).");
  process.exit(1);
}
if (!BEARER) {
  console.error("[backfill-workspaces] Missing MBAPP_BEARER (or DEV_API_TOKEN).");
  process.exit(1);
}

if (!OPTIONS.dryRun && !OPTIONS.yes) {
  console.error("[backfill-workspaces] Refusing to run writes without --yes. Use --dry-run to preview.");
  usage();
  process.exit(1);
}

console.log(`[backfill-workspaces] tenant=${TENANT} base=${BASE} dryRun=${OPTIONS.dryRun} maxPages=${OPTIONS.maxPages} sleepMs=${OPTIONS.sleepMs}`);

const headers = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${BEARER}`,
  "X-Tenant-Id": TENANT,
};

async function getJson(path, { method = "GET", body } = {}) {
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

async function sleep(ms) {
  if (ms > 0) {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}

async function getJsonThrottled(path, opts) {
  const res = await getJson(path, opts);
  await sleep(OPTIONS.sleepMs);
  return res;
}

async function listViewsAll() {
  const items = [];
  let cursor = undefined;
  let pages = 0;
  while (pages < OPTIONS.maxPages) {
    const sep = cursor ? `?limit=200&cursor=${encodeURIComponent(cursor)}` : "?limit=200";
    const { resp, json } = await getJsonThrottled(`/views${sep}`);
    if (!resp.ok) {
      throw new Error(`list views failed status=${resp.status}`);
    }
    const pageItems = Array.isArray(json?.items) ? json.items : [];
    items.push(...pageItems);
    const next = json?.next ?? json?.pageInfo?.nextCursor ?? null;
    if (!next) break;
    cursor = next;
    pages += 1;
  }
  return items;
}

function isWorkspaceLike(view) {
  // Heuristic: legacy workspace projections stored as views usually carry a views[] membership array.
  // Only treat records with array views as workspace candidates to avoid polluting workspaces with normal views.
  return Array.isArray(view?.views);
}

function buildPayload(view) {
  const views = Array.isArray(view?.views) ? view.views : [];
  return {
    name: view?.name || view?.id,
    entityType: view?.entityType,
    description: view?.description,
    shared: typeof view?.shared === "boolean" ? view.shared : false,
    ownerId: view?.ownerId,
    views,
  };
}

async function upsertWorkspace(id, payload) {
  let attempt = 0;
  let last = null;
  while (attempt < 3) {
    const { resp, json } = await getJson(`/workspaces/${encodeURIComponent(id)}`, { method: "PUT", body: payload });
    await sleep(OPTIONS.sleepMs + attempt * 50);
    last = { ok: resp.ok, status: resp.status, body: json };
    if (resp.ok) return last;
    if (resp.status === 429 || resp.status >= 500) {
      attempt += 1;
      continue;
    }
    break;
  }
  return last;
}

async function main() {
  const legacy = await listViewsAll();
  let scanned = 0;
  let candidates = 0;
  let upserts = 0;
  let wouldUpsert = 0;
  let skipped = 0;
  const errors = [];
  const dryRunSample = [];

  for (const v of legacy) {
    scanned += 1;
    const id = v?.id;
    if (!id) continue;

    if (!isWorkspaceLike(v)) {
      continue; // skip non-workspace views
    }
    candidates += 1;

    // Check if a true workspace already exists
    const existing = await getJsonThrottled(`/workspaces/${encodeURIComponent(id)}`);
    if (existing.resp.ok && existing.json?.type === "workspace") {
      skipped += 1;
      continue;
    }

    const payload = buildPayload(v);
    if (OPTIONS.dryRun) {
      wouldUpsert += 1;
      if (dryRunSample.length < 10) dryRunSample.push(id);
      continue;
    }

    const result = await upsertWorkspace(id, payload);
    if (result?.ok) {
      upserts += 1;
    } else {
      errors.push({ id, status: result?.status ?? 0, body: result?.body });
    }
  }

  console.log(JSON.stringify({ tenant: TENANT, base: BASE, scanned, candidates, skippedExisting: skipped, upserts, wouldUpsert, errors: errors.length, sample: OPTIONS.dryRun ? dryRunSample : undefined }, null, 2));
  if (errors.length) {
    console.error("[backfill-workspaces] sample errors:", errors.slice(0, 5));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[backfill-workspaces] fatal", err);
  process.exit(1);
});
