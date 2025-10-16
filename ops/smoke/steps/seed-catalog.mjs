// ops/smoke/steps/seed-catalog.mjs
import { api, normalizePage, nowTag } from "../core.mjs";

/**
 * If a product with the exact SKU exists, reuse it.
 * Otherwise create it. This avoids 409/500 collisions across tenants/environments.
 */
async function getOrCreateProductBySku(def) {
  // Prefer exact match via search
  try {
    const page = await api(`/objects/product/search`, {
      method: "POST",
      body: { q: def.sku, limit: 10, fields: ["sku", "id", "name", "inventoryItemId"] },
    });
    const { items } = normalizePage(page);
    const hit = items.find((p) => p?.sku === def.sku);
    if (hit) return hit;
  } catch (_) {
    // fallback: ignore and try create
  }

  // Create if not found
  return api(`/objects/product`, {
    method: "POST",
    body: { type: "product", ...def, status: "active" },
  });
}

/**
 * Ensure there is an inventoryItem tied to this product.
 * Returns the inventoryItem (existing or newly created).
 */
async function ensureInventoryItem(productId) {
  // try to find one
  try {
    const page = await api(`/objects/inventoryItem/search`, {
      method: "POST",
      body: { q: productId, limit: 10, fields: ["productId", "id", "onHand"] },
    });
    const { items } = normalizePage(page);
    const hit = items.find((r) => r?.productId === productId);
    if (hit) return hit;
  } catch (_) {}

  // create if missing (best-effort)
  try {
    return await api(`/objects/inventoryItem`, {
      method: "POST",
      body: { type: "inventoryItem", productId, onHand: 10 },
    });
  } catch (_) {
    return null;
  }
}

export async function run() {
  const PREFIX = process.env.SMOKE_SKU_PREFIX || "SMK";
  const TAG = nowTag(); // e.g., 20251015HHMMSS UTC
  const defs = [
    { sku: `${PREFIX}-${TAG}-001`, name: "Smoke Widget", uom: "each", price: 9.99 },
    { sku: `${PREFIX}-${TAG}-002`, name: "Smoke Thing",  uom: "each", price: 19.99 },
  ];

  const created = [];
  for (const d of defs) {
    const prod = await getOrCreateProductBySku(d);
    const inv = await ensureInventoryItem(prod.id);

    // Link product → inventoryItemId so handlers & smokes resolve the SAME item
    if (inv?.id && prod?.id && prod?.inventoryItemId !== inv.id) {
      try {
        await api(`/objects/product/${encodeURIComponent(prod.id)}`, {
          method: "PUT",               // your objects/update supports partial body
          body: { inventoryItemId: inv.id },
        });
        // also reflect link in our local object for return payload
        prod.inventoryItemId = inv.id;
      } catch (_) {
        // non-fatal in smoke; continue
      }
    }

    created.push(prod);
  }

  return { products: created.map((p) => ({ id: p.id, sku: p.sku })) };
}
