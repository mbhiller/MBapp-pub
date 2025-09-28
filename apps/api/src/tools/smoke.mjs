// apps/api/src/tools/smoke.mjs
// Node 18+ required. Run: `node apps/api/src/tools/smoke.mjs`
//
// Fast e2e checks:
// 1) auth (optional login or preset token)
// 2) /objects/product/list works
// 3) Views CRUD (create -> get -> patch -> delete)
// 4) Workspaces CRUD (create -> get -> patch -> delete)

const API_BASE =
  process.env.MBAPP_API_BASE ||
  process.env.EXPO_PUBLIC_API_BASE ||
  process.env.MB_API_BASE ||
  "http://localhost:8787";

const TENANT_ID =
  process.env.MBAPP_TENANT_ID ||
  process.env.EXPO_PUBLIC_TENANT_ID ||
  process.env.MB_TENANT_ID ||
  "DemoTenant";

const DEV_EMAIL = process.env.MBAPP_DEV_EMAIL || process.env.DEV_EMAIL || "";
const DEV_PASSWORD =
  process.env.MBAPP_DEV_PASSWORD || process.env.DEV_PASSWORD || "password";

const PRESET_JWT = process.env.MB_JWT || process.env.TOKEN || "";

function log(...args) {
  console.log("[smoke]", ...args);
}

async function auth() {
  if (PRESET_JWT) {
    log("Using preset token from env.");
    return PRESET_JWT;
  }
  if (!DEV_EMAIL) {
    log("No MB_JWT and no MBAPP_DEV_EMAIL provided; trying anonymous smoke where possible.");
    return "";
  }
  const r = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-tenant-id": TENANT_ID },
    body: JSON.stringify({ email: DEV_EMAIL, password: DEV_PASSWORD }),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`Login failed ${r.status}: ${t}`);
  }
  const j = await r.json();
  const token = j.token || j.jwt || j.access_token || "";
  if (!token) throw new Error("Login response missing token/jwt");
  log("Authenticated via /auth/login");
  return token;
}

async function api(path, method = "GET", body, token) {
  const headers = {
    "x-tenant-id": TENANT_ID,
    "content-type": "application/json",
  };
  if (token) headers.authorization = `Bearer ${token}`;

  const r = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (r.status === 204) return { ok: true, status: 204 };
  const text = await r.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { _raw: text };
  }
  if (!r.ok) {
    const msg = json?.message || json?.error || r.statusText;
    throw new Error(`${method} ${path} -> ${r.status} ${msg}`);
  }
  return json;
}

async function run() {
  log(`API_BASE=${API_BASE} TENANT_ID=${TENANT_ID}`);
  const token = await auth();
  const results = { ok: true, steps: [] };

  // 1) policy (if token available)
  if (token) {
    const policy = await api(`/auth/policy`, "GET", null, token);
    results.steps.push({ step: "policy", ok: true, roles: policy.roles || [] });
  } else {
    results.steps.push({ step: "policy", ok: true, note: "skipped (no token)" });
  }

  // 2) list products
  const list = await api(`/objects/product/list`, "GET", null, token);
  if (!list || !Array.isArray(list.items)) throw new Error("product list invalid");
  results.steps.push({ step: "product_list", ok: true, count: list.items.length });

  // 3) Views CRUD
  const viewPayload = {
    type: "view",
    moduleKey: "inventory",
    name: `SmokeView-${Date.now()}`,
    queryJSON: { type: "product", filter: {}, sort: [{ field: "name", dir: "asc" }] },
    shared: true,
    isDefault: false,
  };
  const vCreate = await api(`/views`, "POST", viewPayload, token);
  const vGet = await api(`/views/${encodeURIComponent(vCreate.id)}`, "GET", null, token);
  const vPatch = await api(`/views/${encodeURIComponent(vCreate.id)}`, "PATCH", { name: `${viewPayload.name}-v2` }, token);
  const vDelete = await api(`/views/${encodeURIComponent(vCreate.id)}`, "DELETE", null, token);
  results.steps.push({ step: "views_crud", ok: true });

  // 4) Workspaces CRUD
  const wsPayload = {
    type: "workspace",
    name: `SmokeWS-${Date.now()}`,
    shared: true,
    tiles: [{ moduleKey: "inventory", inlineQuery: { type: "product" }, layout: { w: 12, h: 4, x: 0, y: 0 } }],
  };
  const wsCreate = await api(`/workspaces`, "POST", wsPayload, token);
  const wsGet = await api(`/workspaces/${encodeURIComponent(wsCreate.id)}`, "GET", null, token);
  const wsPatch = await api(`/workspaces/${encodeURIComponent(wsCreate.id)}`, "PATCH", { name: `${wsPayload.name}-v2` }, token);
  const wsDelete = await api(`/workspaces/${encodeURIComponent(wsCreate.id)}`, "DELETE", null, token);
  results.steps.push({ step: "workspaces_crud", ok: true });

  log("Smoke OK ✅", JSON.stringify(results, null, 2));
  return 0;
}

run().then(
  () => process.exit(0),
  (e) => {
    console.error("[smoke] ERROR:", e?.message || e);
    process.exit(1);
  }
);
