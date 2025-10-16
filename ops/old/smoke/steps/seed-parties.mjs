// ops/smoke/steps/seed-parties.mjs
import { api, normalizePage } from "../core.mjs";
import { setTimeout as wait } from "node:timers/promises";

// ---- helpers ----
async function findPartyByName(name) {
  try {
    const page = await api(`/objects/party/search`, {
      method: "POST",
      body: { q: name, limit: 25, fields: ["id","displayName","kind","status"] },
    });
    const { items } = normalizePage(page);
    return items.find(p => (p.displayName === name));
  } catch (_e) { return null; }
}

async function getOrCreateParty(name, kind = "organization") {
  const existing = await findPartyByName(name);
  if (existing?.id) return existing;
  return api(`/objects/party`, {
    method:"POST",
    body:{ type:"party", kind, displayName: name, status:"active" }
  });
}

/**
 * Ensure a partyRole exists and is visible.
 * 1) Look for an existing role via search.
 * 2) If not found, create it; capture returned id.
 * 3) Poll GET /objects/partyRole/{id} until it reads back (strongest consistency we can get).
 */
export async function ensureRole(partyId, role) {
  // STEP 1: try find by search (tenant-wide list)
  try {
    const page = await api(`/objects/partyRole/search`, {
      method: "POST",
      body: { q: partyId, limit: 50, fields: ["id","partyId","role","active"] },
    });
    const { items } = normalizePage(page);
    const hit = items.find(r => r.partyId === partyId && r.role === role && (r.active ?? true));
    if (hit?.id) {
      // One tiny settle just in case (helps when SO/PO validate immediately after)
      await wait(150);
      return hit.id;
    }
  } catch (_) {}

  // STEP 2: create role
  const created = await api(`/objects/partyRole`, {
    method:"POST",
    body:{ type:"partyRole", partyId, role, active:true }
  });
  const rid = created?.id;
  if (!rid) {
    // No id? fallback settle
    await wait(300);
    return null;
  }

  // STEP 3: poll GET-by-id until visible
  for (let i = 0; i < 8; i++) { // up to ~1.2s
    await wait(150);
    try {
      const r = await api(`/objects/partyRole/${encodeURIComponent(rid)}`, { method:"GET" });
      if (r?.id === rid && r?.active !== false) {
        // extra settle to be extra safe for the validator's scan
        await wait(120);
        return rid;
      }
    } catch (_) {}
  }

  // Final small backoff before giving up
  await wait(200);
  return rid;
}

export async function run() {
  // Reuse stable parties across runs so roles persist
  const customer = await getOrCreateParty("SMOKE Customer Org", "organization");
  const vendor   = await getOrCreateParty("SMOKE Vendor Org",   "organization");

  await ensureRole(customer.id, "customer");
  await ensureRole(vendor.id,   "vendor");

  return { customerPartyId: customer.id, vendorPartyId: vendor.id };
}
