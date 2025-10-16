// ops/smoke/smoke.mjs — MBapp smoke test runner (auth-aware, objects-based)
import process from "node:process";

const API    = (process.env.MBAPP_API_BASE   ?? "http://localhost:3000").replace(/\/+$/,"");
const TENANT =  process.env.MBAPP_TENANT_ID  ?? "DemoTenant";
const EMAIL  =  process.env.MBAPP_DEV_EMAIL  ?? "dev@example.com";

async function ensureBearer() {
  if (process.env.MBAPP_BEARER) return;
  // Try dev-login if enabled on the API
  try {
    const r = await fetch(API + "/auth/dev-login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Tenant-Id": TENANT },
      body: JSON.stringify({ email: EMAIL, tenantId: TENANT }),
    });
    if (r.ok) {
      const j = await r.json().catch(()=> ({}));
      if (j?.token) {
        process.env.MBAPP_BEARER = j.token;
        return;
      }
    }
  } catch {}
}

function baseHeaders() {
  const h = {
    "accept": "application/json",
    "Content-Type": "application/json",
    "X-Tenant-Id": TENANT,
  };
  const bearer = process.env.MBAPP_BEARER || process.env.MBAPP_API_KEY;
  if (bearer) {
    h["Authorization"] = `Bearer ${bearer}`;
  }
  return h;
}

async function get(path) {
  const res = await fetch(API + path, { headers: baseHeaders() });
  const body = await res.json().catch(()=> ({}));
  return { ok: res.ok, status: res.status, body };
}
async function post(path, body, headers={}) {
  const res = await fetch(API + path, {
    method: "POST",
    headers: { ...baseHeaders(), ...headers },
    body: JSON.stringify(body ?? {}),
  });
  const j = await res.json().catch(()=> ({}));
  return { ok: res.ok, status: res.status, body: j };
}
async function put(path, body, headers={}) {
  const res = await fetch(API + path, {
    method: "PUT",
    headers: { ...baseHeaders(), ...headers },
    body: JSON.stringify(body ?? {}),
  });
  const j = await res.json().catch(()=> ({}));
  return { ok: res.ok, status: res.status, body: j };
}

/**
 * IMPORTANT: Your index.ts exposes /objects/:type endpoints.
 * For Parties we’ll assume type "party".
 * If your spec uses a different name, set SMOKE_PARTY_TYPE, e.g. "parties" or "Party".
 */
const PARTY_TYPE = process.env.SMOKE_PARTY_TYPE ?? "party";

/** Minimal happy paths aligned to your current API */
const tests = {
  // Sanity check the gateway without auth
  "smoke:ping": async () => {
    const r = await fetch(API + "/ping");
    const text = await r.text();
    return { test: "ping", result: r.ok ? "PASS" : "FAIL", status: r.status, text };
  },

  // Parties via /objects/:type (create -> search -> update role field)
  "smoke:parties:happy": async () => {
    await ensureBearer();
    // Create a party object (fields are flexible; we use kind/name/roles[])
    const create = await post(`/objects/${encodeURIComponent(PARTY_TYPE)}`, {
      kind: "person",
      name: "Smoke Test User",
      roles: ["customer"],
    });
    // Search (your API expects POST /objects/:type/search)
    const search = await post(`/objects/${encodeURIComponent(PARTY_TYPE)}/search`, { q: "Smoke Test User" });

    // Optional: update to prove write path (if you want)
    let update = { ok: true, status: 200, body: {} };
    if (create.ok && create.body?.id) {
      update = await put(`/objects/${encodeURIComponent(PARTY_TYPE)}/${encodeURIComponent(create.body.id)}`, {
        notes: "updated by smoke",
      });
    }

    const pass = create.ok && search.ok && update.ok;
    return { test: "parties-happy", result: pass ? "PASS" : "FAIL", create, search, update };
  },
};

const cmd = process.argv[2] ?? "list";
if (cmd === "list") {
  console.log(Object.keys(tests));
  process.exit(0);
}

const fn = tests[cmd];
if (!fn) {
  console.error("Unknown command:", cmd);
  process.exit(1);
}

ensureBearer()
  .then(fn)
  .then((r) => {
    console.log(JSON.stringify(r, null, 2));
    process.exit(r?.result === "PASS" ? 0 : 1);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
