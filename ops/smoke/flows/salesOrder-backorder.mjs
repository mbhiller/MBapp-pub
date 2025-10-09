// ops/smoke/flows/salesOrder-backorder.mjs
import { rid, withTag, createObject, api } from "../core.mjs";
import * as Inventory from "../modules/inventory-smoke.mjs";
import * as Vendors from "../modules/vendors-smoke.mjs";

async function loadSO(id) {
  return api(`/objects/salesOrder/${encodeURIComponent(id)}`, { method: "GET" });
}

export async function run({ stock = 1, qty = 3, code = "sobk" } = {}) {
  stock = Number(stock) || 1;
  qty   = Number(qty)   || 1;
  const tag = String(code || "sobk");

  // 1) Seed an item; receive limited stock via your inventory helper path
  const { created: [itemId] } = await Inventory.createMany({ each: 1, code: tag });
  await Vendors.createMany({ each: 1, code: tag }).catch(() => null);

  // Try a PO-based receive if your helper exposes it; otherwise let your
  // inventory-smoke handle it internally based on 'stock' argument.
  if (stock > 0 && Inventory.receive) {
    await Inventory.receive(itemId, stock, tag).catch(() => null);
  }

  // 2) Create a product (optional) and an SO that demands more than stock
  const prodId = rid("prod");
  await createObject("product", {
    type: "product", id: prodId, name: withTag("Backorder Product", tag),
    kind: "good", status: "active", defaultItemId: itemId,
  });

  const so = await createObject("salesOrder", {
    type: "salesOrder", id: rid("so"), customerName: withTag("Backorder Customer", tag),
    status: "draft", lines: [{ id: "L1", itemId, qty, qtyFulfilled: 0, note: `prod=${prodId}` }],
  });

  await api(`/sales/so/${so.id}:submit`, { method: "POST", body: { id: so.id } });

  // 3) Non-strict commit (should not 409)
  const commit = await api(`/sales/so/${so.id}:commit`, { method: "POST" })
    .catch(e => ({ error: true, status: e?.status || 500, body: e?.response }));

  const shortages = commit?.shortages || commit?.body?.shortages || [];
  // 4) Infer backordered if API doesn't return it
  let inferredBackordered = null;
  try {
    const fresh = await loadSO(so.id);
    const line = (fresh?.lines || []).find(l => String(l.id) === "L1");
    const ordered = Number(line?.qty ?? 0);
    const fulfilled = Number(line?.qtyFulfilled ?? 0);
    const reservedMap = fresh?.metadata?.reservedMap || {};
    const reserved = Number(reservedMap["L1"] ?? 0);
    inferredBackordered = Math.max(0, ordered - fulfilled - reserved);
  } catch {}

  const ok = !commit.error;
  return {
    test: "salesOrder:backorder",
    result: ok ? "PASS" : "FAIL",
    soId: so.id, itemId, requested: qty, stock,
    shortages,
    backordered: inferredBackordered,
  };
}
