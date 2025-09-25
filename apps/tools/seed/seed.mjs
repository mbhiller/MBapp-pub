// Node 18+ (uses global fetch). Idempotent seeds for Views + Workspace.
// Env needed: MBAPP_API_BASE, MBAPP_TENANT_ID, MBAPP_TOKEN

const API = process.env.MBAPP_API_BASE || "http://localhost:3000";
const TENANT = process.env.MBAPP_TENANT_ID || "DemoTenant";
const TOKEN = process.env.MBAPP_TOKEN;

if (!TOKEN) {
  console.error("Missing MBAPP_TOKEN. Run your dev login to get a token.");
  process.exit(1);
}

const H = {
  "content-type": "application/json",
  "x-tenant-id": TENANT,
  "authorization": `Bearer ${TOKEN}`,
};

async function getJSON(url) {
  const r = await fetch(url, { headers: H });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} on ${url}`);
  return r.json();
}
async function postJSON(url, body) {
  const r = await fetch(url, { method: "POST", headers: H, body: JSON.stringify(body) });
  if (!r.ok) {
    const text = await r.text().catch(()=>"");
    throw new Error(`${r.status} ${r.statusText} on ${url} → ${text}`);
  }
  return r.json();
}
async function putJSON(url, body) {
  const r = await fetch(url, { method: "PUT", headers: H, body: JSON.stringify(body) });
  if (!r.ok) {
    const text = await r.text().catch(()=>"");
    throw new Error(`${r.status} ${r.statusText} on ${url} → ${text}`);
  }
  return r.json();
}

// ---- Views (per-module) ----
const viewSeeds = [
  {
    moduleKey: "inventory",
    name: "Low Stock",
    shared: true,
    isDefault: false,
    query: {
      filters: { lowStock: true }, // UI interprets as quantity <= minQty
      by: "updatedAt",
      sort: "asc",
      columns: ["name","sku","location","quantity","minQty","maxQty"]
    }
  },
  {
    moduleKey: "inventory",
    name: "By Location (Default)",
    shared: true,
    isDefault: true,
    query: {
      filters: { location: "barn-a" }, // adjust your default site/location
      by: "createdAt",
      sort: "asc",
      columns: ["name","sku","location","quantity"]
    }
  },
  {
    moduleKey: "events",
    name: "Upcoming 30 Days",
    shared: true,
    isDefault: true,
    query: {
      filters: { startsAtGte: "now", withinDays: 30 },
      by: "createdAt",
      sort: "asc",
      columns: ["name","startsAt","location","status"]
    }
  },
  {
    moduleKey: "events",
    name: "My Events",
    shared: true,
    isDefault: false,
    query: {
      filters: { assignedToMe: true },
      by: "updatedAt",
      sort: "asc",
      columns: ["name","startsAt","status"]
    }
  },
  {
    moduleKey: "products",
    name: "Active Catalog",
    shared: true,
    isDefault: true,
    query: {
      filters: { status: "active" },
      by: "updatedAt",
      sort: "desc",
      columns: ["name","sku","price","kind"]
    }
  },
  {
    moduleKey: "products",
    name: "Services Only",
    shared: true,
    isDefault: false,
    query: {
      filters: { kind: "service" },
      by: "createdAt",
      sort: "asc",
      columns: ["name","price"]
    }
  }
];

// ---- Workspace (cross-module) ----
const workspaceSeed = {
  name: "Participant Workspace",
  shared: true,
  tiles: [
    // If you prefer to bind tiles to a saved View, set viewId after we upsert Views.
    { moduleKey: "events", inlineQuery: { filters: { mine: true, active: true }, by: "createdAt", sort: "asc" }, layout: { w:12, h:6 } },
    { moduleKey: "registrations", inlineQuery: { filters: { meAsParticipant: true }, sort: "desc" }, layout: { w:12, h:8 } },
    { moduleKey: "reservations", inlineQuery: { filters: { meAsOwner: true, upcoming: true } }, layout: { w:12, h:6 } },
    { moduleKey: "salesOrder", inlineQuery: { filters: { meAsBuyer: true }, sort: "desc" }, layout: { w:12, h:6 } },
    { moduleKey: "documents", inlineQuery: { filters: { provider: "gdrive", mine: true } }, layout: { w:12, h:5 } }
  ]
};

async function findViewByName(moduleKey, name) {
  const url = `${API}/objects/view/search?q=${encodeURIComponent(name)}&limit=20`;
  const { items = [] } = await getJSON(url);
  return items.find(v => v?.moduleKey === moduleKey && v?.name?.toLowerCase() === name.toLowerCase());
}

async function upsertView(v) {
  const existing = await findViewByName(v.moduleKey, v.name).catch(()=>undefined);
  if (existing?.id) {
    const url = `${API}/objects/view/${existing.id}`;
    const updated = await putJSON(url, { ...existing, ...v, id: existing.id, type: "view" });
    return { id: updated.id, name: updated.name, updated: true };
  } else {
    const url = `${API}/objects/view`;
    const created = await postJSON(url, { ...v, type: "view" });
    return { id: created.id, name: created.name, created: true };
  }
}

async function findWorkspaceByName(name) {
  const url = `${API}/objects/workspace/search?q=${encodeURIComponent(name)}&limit=20`;
  const { items = [] } = await getJSON(url);
  return items.find(w => w?.name?.toLowerCase() === name.toLowerCase());
}

async function upsertWorkspace(w, viewsByName = {}) {
  // Optionally map tiles to specific viewIds if names exist in viewsByName
  const tiles = (w.tiles || []).map(t => {
    if (t.viewName && viewsByName[t.viewName]) {
      return { ...t, viewId: viewsByName[t.viewName], inlineQuery: undefined };
    }
    return t;
  });

  const existing = await findWorkspaceByName(w.name).catch(()=>undefined);
  if (existing?.id) {
    const url = `${API}/objects/workspace/${existing.id}`;
    const updated = await putJSON(url, { ...existing, ...w, tiles, id: existing.id, type: "workspace" });
    return { id: updated.id, name: updated.name, updated: true };
  } else {
    const url = `${API}/objects/workspace`;
    const created = await postJSON(url, { ...w, tiles, type: "workspace" });
    return { id: created.id, name: created.name, created: true };
  }
}

async function main() {
  console.log(`Seeding tenant "${TENANT}" via ${API} …`);

  // Upsert Views
  const viewResults = [];
  for (const v of viewSeeds) {
    const res = await upsertView(v);
    viewResults.push(res);
    console.log(`View: ${v.moduleKey} / ${v.name} → ${res.created ? "created" : "updated"} (${res.id})`);
  }

  // Map names → IDs
  const viewIdByName = {};
  for (const r of viewResults) viewIdByName[r.name] = r.id;

  // Upsert Workspace
  const wsRes = await upsertWorkspace(workspaceSeed, viewIdByName);
  console.log(`Workspace: ${wsRes.name} → ${wsRes.created ? "created" : "updated"} (${wsRes.id})`);

  console.log("✓ Seed complete.");
}

main().catch(err => {
  console.error("Seed failed:", err?.message);
  process.exit(1);
});
