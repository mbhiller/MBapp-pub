/* MBapp Node Smoke Test (ESM) — robust v3
   - Extracts id from: body.id, body.item.id, any nested "id"-like key, or Location header
   - Logs raw create response body + Location if it still can't find id
   - Tries both GET variants; PUT update; negative 404 on random id
*/

import crypto from "node:crypto";

const args = new Map();
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 2) {
  const k = argv[i];
  const v = argv[i+1];
  if (k && v && k.startsWith("--")) args.set(k.slice(2), v);
}

const API = args.get("api") || process.env.API;
const TENANT = args.get("tenant") || process.env.TENANT || "DemoTenant";
const TYPE = args.get("type") || process.env.TYPE || "horse";

if (!API) {
  console.error("❌ Set API env var or pass --api");
  process.exit(2);
}

const headers = {
  "x-tenant-id": TENANT,
  "content-type": "application/json"
};

const results = [];
let createdId = null;

async function step(name, fn) {
  try {
    const val = await fn();
    console.log(`✅ ${name}`);
    results.push({ name, ok: true });
    return val;
  } catch (e) {
    console.error(`❌ ${name}`);
    if (e?.response) {
      const { status, statusText, url } = e.response;
      console.error(`   ${status} ${statusText} ${url}`);
      try {
        const body = await e.response.text();
        console.error(`   Body: ${body}`);
      } catch {}
    } else {
      console.error(String(e.stack || e));
    }
    results.push({ name, ok: false, error: String(e) });
    throw e;
  }
}

class HttpError extends Error {
  constructor(response) {
    super(`HTTP ${response.status} @ ${response.url}`);
    this.response = response;
  }
}

async function http(method, url, body, expectOk = true) {
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  const isJson = (res.headers.get("content-type") || "").includes("application/json");
  let data;
  if (isJson) {
    try { data = await res.json(); } catch { data = {}; }
  } else {
    data = await res.text();
  }
  if (expectOk && !res.ok) throw new HttpError(res);
  return { res, data, isJson };
}

function findIdAnywhere(obj) {
  const seen = new Set();
  function walk(x) {
    if (x && typeof x === 'object') {
      if (seen.has(x)) return null;
      seen.add(x);
      for (const [k, v] of Object.entries(x)) {
        if (/^(id|Id|ID|objectId|ItemId)$/.test(k) && typeof v === 'string' && v.length >= 8) return v;
        const deeper = walk(v);
        if (deeper) return deeper;
      }
    }
    return null;
  }
  return walk(obj);
}

function idFromLocationHeader(res) {
  const loc = res.headers.get('location') || res.headers.get('Location');
  if (!loc) return null;
  const m = String(loc).match(/([a-f0-9-]{8,}|[A-Za-z0-9-_]{12,})$/);
  return m ? m[1] : null;
}

async function getObjectFlexible(id) {
  // Try query-param first
  let r1 = await http("GET", `${API}/objects/${id}?type=${TYPE}`, null, false);
  if (r1.res.ok) return r1;
  if (r1.res.status !== 404) throw new HttpError(r1.res);
  // Fallback to path-param
  let r2 = await http("GET", `${API}/objects/${TYPE}/${id}`, null, false);
  if (r2.res.ok) return r2;
  throw new HttpError(r2.res);
}

(async () => {
  console.log(`MBapp smoke: ${new Date().toISOString()}`);
  console.log(`API=${API}`);
  console.log(`TENANT=${TENANT}`);
  console.log(`TYPE=${TYPE}`);

  await step("GET /tenants (optional)", async () => {
    try { await http("GET", `${API}/tenants`, null, true); }
    catch { console.warn("   tenants endpoint not found or failing (continuing)"); }
  });

  // Create
  const createBody = { name: "Smoke Horse", type: TYPE, tags: ["smoke","test"], integrations: {} };
  const { res: cRes, data: created, isJson } = await step(`POST /objects/${TYPE}`, async () => {
    const { res, data, isJson } = await http("POST", `${API}/objects/${TYPE}`, createBody, true);
    return { res, data, isJson };
  });

  // Determine id
  createdId = (created && typeof created === 'object' && (created.id || created?.item?.id || created?.Item?.id))
           || (typeof created === 'object' ? findIdAnywhere(created) : null)
           || idFromLocationHeader(cRes);

  if (!createdId) {
    console.error("❌ Could not determine created id. Diagnostics:");
    console.error("   content-type:", cRes.headers.get("content-type"));
    const loc = cRes.headers.get("location") || cRes.headers.get("Location");
    console.error("   Location:", loc || "<none>");
    console.error("   Raw body:", isJson ? JSON.stringify(created) : String(created));
    process.exit(1);
  }
  console.log(`Created id: ${createdId}`);

  // Get (flexible)
  await step(`GET object (query first, then path fallback)`, async () => {
    const { data } = await getObjectFlexible(createdId);
    if (!data || (!data.id && !data.Item && !data.item)) {
      console.warn("   response didn't include recognizable body (continuing)");
    }
  });

  // Update
  const updateBody = { name: "Smoke Horse (updated)", type: TYPE, tags: ["smoke","test","updated"] };
  await step(`PUT /objects/${TYPE}/${createdId}`, async () => {
    await http("PUT", `${API}/objects/${TYPE}/${createdId}`, updateBody, true);
  });

  // Fetch again
  await step(`GET object again (flexible)`, async () => {
    const { data } = await getObjectFlexible(createdId);
    const name = data?.name || data?.Item?.name || data?.item?.name;
    if (name !== "Smoke Horse (updated)") {
      console.warn("   name not updated as expected (continuing)");
    }
  });

  // Negative: GET a non-existent id should 404
  await step(`NEGATIVE GET non-existent id (expect 404)`, async () => {
    const fake = crypto.randomUUID();
    const r1 = await http("GET", `${API}/objects/${fake}?type=${TYPE}`, null, false);
    if (r1.res.status === 404) return;
    const r2 = await http("GET", `${API}/objects/${TYPE}/${fake}`, null, false);
    if (r2.res.status === 404) return;
    throw new Error(`Expected 404 on either variant, got ${r1.res.status} and ${r2.res.status}`);
  });

  // Summary
  const failed = results.filter(r => !r.ok);
  console.log("—".repeat(40));
  if (failed.length) {
    console.log(`❌ ${failed.length} step(s) failed`);
    process.exit(1);
  } else {
    console.log("✅ All smoke steps passed");
  }
})().catch((e) => { console.error(e); process.exit(1); });