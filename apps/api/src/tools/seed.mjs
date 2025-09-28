// apps/api/src/tools/seed.mjs
// Node 18+ required (global fetch). Run: `node apps/api/src/tools/seed.mjs`
//
// Seeds a small, safe dataset for dev/QA:
// - Products (3 demo items)
// - Views (Low Stock, By Location)
// - Workspaces (Participant, Inventory Manager)
//
// ENV it reads (with fallbacks):
//   MBAPP_API_BASE | EXPO_PUBLIC_API_BASE | MB_API_BASE
//   MBAPP_TENANT_ID | EXPO_PUBLIC_TENANT_ID | MB_TENANT_ID
//   MB_JWT | TOKEN
//   MBAPP_DEV_EMAIL | MBAPP_DEV_PASSWORD  (optional, for /auth/login)

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
  console.log("[seed]", ...args);
}

async function auth() {
  if (PRESET_JWT) {
    log("Using preset token from env.");
    return PRESET_JWT;
  }
  if (!DEV_EMAIL) {
    log("No MB_JWT and no MBAPP_DEV_EMAIL provided; seeding will call public routes only (if any).");
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

async function seedProducts(token) {
  log("Seeding Products…");
  const samples = [
    {
      type: "product",
      sku: "DEMO-WATER-001",
      name: "Water Bucket",
      status: "active",
      price: 29.99,
      location: "WH-A1",
      onHand: 40,
      reorderPoint: 10,
    },
    {
      type: "product",
      sku: "DEMO-HAY-BALE",
      name: "Hay Bale",
      status: "active",
      price: 8.5,
      location: "WH-B3",
      onHand: 120,
      reorderPoint: 40,
    },
    {
      type: "product",
      sku: "DEMO-SHAVE-ICE",
      name: "Shavings (Bag)",
      status: "active",
      price: 6.0,
      location: "WH-C2",
      onHand: 8, // low stock for view
      reorderPoint: 15,
    },
  ];

  const created = [];
  for (const p of samples) {
    const res = await api(`/objects/product`, "POST", p, token);
    created.push(res);
  }
  return created;
}

async function seedViews(token) {
  log("Seeding Views…");
  const now = Date.now();

  const payloads = [
    {
      type: "view",
      moduleKey: "inventory",
      name: "Low Stock",
      queryJSON: {
        type: "product",
        filter: { onHandLt: 10 },
        sort: [{ field: "onHand", dir: "asc" }],
        columns: ["sku", "name", "location", "onHand", "reorderPoint"],
      },
      ownerId: null,
      shared: true,
      isDefault: false,
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
    },
    {
      type: "view",
      moduleKey: "inventory",
      name: "By Location",
      queryJSON: {
        type: "product",
        filter: {},
        sort: [{ field: "location", dir: "asc" }],
        columns: ["sku", "name", "location", "onHand"],
      },
      ownerId: null,
      shared: true,
      isDefault: false,
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
    },
  ];

  const created = [];
  for (const v of payloads) {
    const res = await api(`/objects/view`, "POST", v, token);
    created.push(res);
  }
  return created;
}

async function seedWorkspaces(token, seededViews) {
  log("Seeding Workspaces…");
  const lowStock = seededViews.find((v) => v?.name === "Low Stock");
  const byLoc = seededViews.find((v) => v?.name === "By Location");

  const payloads = [
    {
      type: "workspace",
      name: "Inventory Manager",
      ownerId: null,
      shared: true,
      tiles: [
        {
          moduleKey: "inventory",
          viewId: lowStock?.id || null,
          layout: { w: 12, h: 6, x: 0, y: 0 },
        },
        {
          moduleKey: "inventory",
          viewId: byLoc?.id || null,
          layout: { w: 12, h: 6, x: 0, y: 6 },
        },
      ],
    },
    {
      type: "workspace",
      name: "Participant",
      ownerId: null,
      shared: true,
      tiles: [
        { moduleKey: "events", inlineQuery: { type: "event", mine: true }, layout: { w: 12, h: 4, x: 0, y: 0 } },
        { moduleKey: "registrations", inlineQuery: { type: "registration", mine: true }, layout: { w: 12, h: 6, x: 0, y: 4 } },
        { moduleKey: "reservations", inlineQuery: { type: "reservation", mine: true }, layout: { w: 12, h: 4, x: 0, y: 10 } },
      ],
    },
  ];

  const created = [];
  for (const ws of payloads) {
    const res = await api(`/objects/workspace`, "POST", ws, token);
    created.push(res);
  }
  return created;
}

(async () => {
  try {
    log(`API_BASE=${API_BASE} TENANT_ID=${TENANT_ID}`);
    const token = await auth();

    const policy = token ? await api(`/auth/policy`, "GET", null, token) : { roles: [], permissions: [] };
    log("Policy:", policy);

    const products = await seedProducts(token);
    log(`Products created: ${products.length}`);

    const views = await seedViews(token);
    log(`Views created: ${views.length}`);

    const workspaces = await seedWorkspaces(token, views);
    log(`Workspaces created: ${workspaces.length}`);

    log("Seed complete ✅");
    process.exit(0);
  } catch (e) {
    console.error("[seed] ERROR:", e?.message || e);
    process.exit(1);
  }
})();
