// ops/smoke/flows/salesOrder-release.mjs
import { rid, withTag, createObject, api } from "../../core.mjs";
import * as Inventory from "../../modules/inventory-smoke.mjs";
import * as Vendors from "../../modules/vendors-smoke.mjs";

async function onhand(itemId) {
  try { return await api(`/inventory/${encodeURIComponent(itemId)}/onhand`, { method:"GET" }); }
  catch { return null; }
}

// Seed stock reliably using your existing PO actions
async function seedStockViaPO({ itemId, qty, tag }) {
  await Vendors.createMany({ each: 1, code: tag }).catch(() => null);
  const po = await createObject("purchaseOrder", {
    type: "purchaseOrder", id: rid("po"),
    vendorName: withTag("Smoke Vendor", tag),
    status: "draft",
    lines: [{ id: "P1", itemId, qty }],
  });
  await api(`/purchasing/po/${po.id}:submit`,  { method: "POST", body: { id: po.id } });
  await api(`/purchasing/po/${po.id}:approve`, { method: "POST", body: { id: po.id } });
  await api(`/purchasing/po/${po.id}:receive`, { method: "POST", body: { lines: [{ lineId: "P1", deltaQty: qty }] } });
}

export async function run({ stock = 5, qty = 3, release = 2, code = "sorel" } = {}) {
  stock = Number(stock) || 5;
  qty = Number(qty) || 3;
  release = Number(release) || 2;

  const tag = String(code || "sorel");
  const { created: [itemId] } = await Inventory.createMany({ each: 1, code: tag });

  // 1) Seed stock
  await seedStockViaPO({ itemId, qty: stock, tag });

  // 2) Create SO and submit
  const so = await createObject("salesOrder", {
    type: "salesOrder", id: rid("so"), customerName: withTag("Release Customer", tag),
    status: "draft", lines: [{ id: "L1", itemId, qty, qtyFulfilled: 0 }],
  });
  await api(`/sales/so/${so.id}:submit`, { method: "POST", body: { id: so.id } });

  // 3) Reserve full qty, then capture counters
  await api(`/sales/so/${so.id}:reserve`, { method:"POST", body:{ lines:[{ lineId:"L1", deltaQty: qty }] } });
  const afterReserve = await onhand(itemId);

  // 4) Release a portion, then capture counters
  await api(`/sales/so/${so.id}:release`, { method:"POST", body:{ lines:[{ lineId:"L1", deltaQty: release }] } });
  const afterRelease = await onhand(itemId);

  // PASS if reserved went down after release
  const ok = !!(afterReserve && afterRelease) && Number(afterRelease.reserved) < Number(afterReserve.reserved);

  return {
    test: "salesOrder:release",
    result: ok ? "PASS" : "FAIL",
    soId: so.id,
    itemId,
    stock,
    reservedAfterReserve: afterReserve?.reserved,
    reservedAfterRelease: afterRelease?.reserved,
  };
}
