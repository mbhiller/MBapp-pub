#!/usr/bin/env node
// apps/api/src/tools/smoke-dev.mjs
const API     = process.env.MBAPP_API_BASE;
const TENANT  = process.env.MBAPP_TENANT_ID;
const BEARER  = process.env.MBAPP_BEARER;
const PROFILE = process.env.AWS_PROFILE || "";

function fail(msg) { console.error(msg); process.exit(2); }

if (!API || !TENANT || !BEARER) {
  fail("Set MBAPP_API_BASE, MBAPP_TENANT_ID, MBAPP_BEARER before running.");
}
if (BEARER.length < 20) {
  fail("MBAPP_BEARER looks empty/invalid (very short). Re-mint and export it.");
}

const H = {
  "content-type": "application/json",
  "x-tenant-id": TENANT,                    // single, lowercase
  "authorization": `Bearer ${BEARER}`,      // single, lowercase
};

const j = async (r) => { try { return await r.json(); } catch { return null; } };
const uuid = () => (globalThis.crypto?.randomUUID?.() ?? require("node:crypto").randomUUID());

async function req(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: H,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await j(res);
  if (!res.ok) {
    const msg = data?.message || res.statusText || "Request failed";
    const detail = data ? JSON.stringify(data) : "";
    throw new Error(`${method} ${path} -> ${res.status} ${msg}${detail ? " :: " + detail : ""}`);
  }
  return data;
}

(async function run() {
  console.log("==== MBapp Dev Smoke ====");
  console.log({
    API,
    TENANT,
    PROFILE,
    bearerLen: BEARER.length,
  });

  // Public health: no headers
  try {
    const res = await fetch(`${API}/health`);
    console.log("health:", res.status, await j(res));
  } catch (e) {
    console.warn("health check failed:", e.message);
  }

  // Auth policy (checks token + tenant headers)
  const policy = await req("GET", "/auth/policy");
  console.log("roles:", policy.roles?.join(", ") ?? "(none)");
  console.log("perms:", policy.permissions?.slice(0, 12)?.join(", "), "...");

  // Views list first
  const vList = await req("GET", "/views");
  console.log("GET /views ok (items:", Array.isArray(vList?.items) ? vList.items.length : "?", ")");

  // Views CRUD
  const vDraft = {
    id: uuid(),
    type: "view",
    moduleKey: "inventory",
    name: `Smoke Low Stock ${Date.now()}`,
    shared: false,
    isDefault: false,
    queryJSON: { where: { qtyOnHand: { "$lte": { "$field": "reorderPoint" } } } }
  };
  const v1 = await req("POST", "/views", vDraft);
  await req("GET", `/views/${v1.id}`);
  await req("PUT", `/views/${v1.id}`, { name: v1.name + " (Updated)" });
  await req("DELETE", `/views/${v1.id}`);
  console.log("✓ views POST→GET→PUT→DELETE ok");

  // Workspaces CRUD
  const wDraft = {
    id: uuid(),
    type: "workspace",
    name: `Smoke WS ${Date.now()}`,
    shared: false,
    tiles: [{ moduleKey: "events", inlineQuery: { limit: 5 }, layout: { w: 6, h: 6, x: 0, y: 0 } }]
  };
  const w1 = await req("POST", "/workspaces", wDraft);
  await req("GET", `/workspaces/${w1.id}`);
  await req("PUT", `/workspaces/${w1.id}`, { name: w1.name + " (Updated)" });
  await req("DELETE", `/workspaces/${w1.id}`);
  console.log("✓ workspaces POST→GET→PUT→DELETE ok");

  
  // Objects sanity (non-fatal)
  try {
    const p = await req("GET", "/objects/product?limit=5");
    console.log("objects/products items:", Array.isArray(p?.items) ? p.items.length : "n/a");
  } catch (e) {
    console.warn("objects/products list skipped:", e.message);
  }

  console.log("All smokes completed ✔");
})().catch((e) => { console.error("Smoke failed:", e.message); process.exit(1); });

