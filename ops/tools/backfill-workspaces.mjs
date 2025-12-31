#!/usr/bin/env node
import process from "process";

const BASE = (process.env.MBAPP_API_BASE || "https://ki8kgivz1f.execute-api.us-east-1.amazonaws.com").replace(/\/$/, "");
const TENANT = process.env.MBAPP_TENANT_ID || process.env.MBAPP_SMOKE_TENANT_ID || "";
const BEARER = process.env.MBAPP_BEARER || process.env.DEV_API_TOKEN || "";

if (!TENANT) {
  console.error("[backfill-workspaces] Missing MBAPP_TENANT_ID (or MBAPP_SMOKE_TENANT_ID).");
  process.exit(1);
}
if (!BEARER) {
  console.error("[backfill-workspaces] Missing MBAPP_BEARER (or DEV_API_TOKEN).");
  process.exit(1);
}

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

async function listViewsAll() {
  const items = [];
  let cursor = undefined;
  let pages = 0;
  while (pages < 50) {
    const sep = cursor ? `?limit=200&next=${encodeURIComponent(cursor)}` : "?limit=200";
    const { resp, json } = await getJson(`/views${sep}`);
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
    filters: view?.filters,
    columns: view?.columns,
  };
}

async function upsertWorkspace(id, payload) {
  const { resp, json } = await getJson(`/workspaces/${encodeURIComponent(id)}`, { method: "PUT", body: payload });
  return { ok: resp.ok, status: resp.status, body: json };
}

async function main() {
  const legacy = await listViewsAll();
  let scanned = 0;
  let candidates = 0;
  let upserts = 0;
  let skipped = 0;
  const errors = [];

  for (const v of legacy) {
    scanned += 1;
    const id = v?.id;
    if (!id) continue;

    if (!isWorkspaceLike(v)) {
      continue; // skip non-workspace views
    }
    candidates += 1;

    // Check if a true workspace already exists
    const existing = await getJson(`/workspaces/${encodeURIComponent(id)}`);
    if (existing.resp.ok) {
      skipped += 1;
      continue;
    }

    const payload = buildPayload(v);
    const result = await upsertWorkspace(id, payload);
    if (result.ok) {
      upserts += 1;
    } else {
      errors.push({ id, status: result.status, body: result.body });
    }
  }

  console.log(JSON.stringify({ tenant: TENANT, base: BASE, scanned, candidates, upserts, skipped, errors: errors.length }, null, 2));
  if (errors.length) {
    console.error("[backfill-workspaces] sample errors:", errors.slice(0, 5));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[backfill-workspaces] fatal", err);
  process.exit(1);
});
