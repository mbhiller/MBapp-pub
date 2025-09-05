#!/usr/bin/env node
// scripts/smoke-robust-v3-20250904-164502.mjs
// Robust smoke test for MBapp Objects API without external fetch deps.

import assert from "node:assert";
import { randomUUID } from "node:crypto";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v];
  })
);

const API    = args.api;
const TENANT = args.tenant;
const TYPE   = args.type;

if (!API || !TENANT || !TYPE) {
  console.error("Usage: --api <url> --tenant <id> --type <objectType>");
  process.exit(1);
}

const headers = {
  "Content-Type": "application/json",
  "x-tenant-id": TENANT,
};

async function main() {
  // Prefer native fetch; fall back to node-fetch only if required.
  // (On Node 18+, fetch is global.)
  const fetcher = globalThis.fetch ?? (await import("node-fetch")).default;

  console.log(`MBapp smoke: ${new Date().toISOString()}`);
  console.log(`API=${API}`);
  console.log(`TENANT=${TENANT}`);
  console.log(`TYPE=${TYPE}`);

  // 1. GET /tenants (optional)
  {
    const r = await fetcher(`${API}/tenants`, { headers });
    assert(r.ok, `GET /tenants failed: ${r.status}`);
    console.log("✅ GET /tenants (optional)");
  }

  // 2. POST /objects/:type
  let id;
  {
    const body = { name: "Test Object", createdAt: Date.now() };
    const r = await fetcher(`${API}/objects/${TYPE}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    assert(r.ok, `POST failed: ${r.status}`);
    const json = await r.json();
    id = json.id;
    assert(id, "Missing id from POST response");
    console.log("✅ POST /objects/%s\nCreated id: %s", TYPE, id);
  }

  // 3. GET object (query first, then path fallback)
  {
    let r = await fetcher(`${API}/objects/${TYPE}?id=${id}`, { headers });
    if (r.status === 404) {
      r = await fetcher(`${API}/objects/${TYPE}/${id}`, { headers });
    }
    assert(r.ok, `GET by id failed: ${r.status}`);
    console.log("✅ GET object (query first, then path fallback)");
  }

  // 4. PUT /objects/:type/:id
  {
    const body = { name: "Updated Object", updatedAt: Date.now() };
    const r = await fetcher(`${API}/objects/${TYPE}/${id}`, {
      method: "PUT",
      headers,
      body: JSON.stringify(body),
    });
    assert(r.ok, `PUT failed: ${r.status}`);
    console.log("✅ PUT /objects/%s/%s", TYPE, id);
  }

  // 5. GET object again (flexible)
  {
    const r = await fetcher(`${API}/objects/${TYPE}/${id}`, { headers });
    assert(r.ok, `GET after update failed: ${r.status}`);
    const json = await r.json();
    assert.equal(json.name, "Updated Object");
    console.log("✅ GET object again (flexible)");
  }

  // 6. NEGATIVE GET non-existent id (expect 404)
  {
    const bogusId = randomUUID();
    const r = await fetcher(`${API}/objects/${TYPE}/${bogusId}`, { headers });
    assert.equal(r.status, 404, `Expected 404, got ${r.status}`);
    console.log("✅ NEGATIVE GET non-existent id (expect 404)");
  }

  console.log("————————————————————————————————————————");
  console.log("✅ All smoke steps passed");
}

main().catch((err) => {
  console.error("Smoke test failed:", err);
  process.exit(1);
});
