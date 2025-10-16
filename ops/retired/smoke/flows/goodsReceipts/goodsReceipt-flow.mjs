/* ops/smoke/flows/goodsReceipt-flow.mjs */
import { rid, withTag, createObject, api } from "../../core.mjs";
import * as Inventory from "../../modules/inventory-smoke.mjs";
import * as Vendors from "../../modules/vendors-smoke.mjs";

async function getOnHand(itemId) {
  try { return await api(`/inventory/${encodeURIComponent(itemId)}/onhand`, { method: "GET" }); }
  catch { return null; }
}

export async function run({ qty = 3, code = "gr" } = {}) {
  const tag = String(code || "gr");
  // 1) Item + Vendor
  const inv = await Inventory.createMany({ each: 1, code: tag });
  const itemId = inv.ids[0];
  const ven = await Vendors.createMany({ each: 1, code: tag });
  const vendorId = ven.ids[0];

  // 2) Create PO with one line
  const po = await createObject("purchaseOrder", {
    type: "purchaseOrder",
    id: rid("po"),
    vendorId,
    status: "submitted",
    lines: [{ id: "L1", itemId, qtyOrdered: qty, qtyReceived: 0, uom: "each" }],
    notes: `PO for ${withTag("seed", tag)}`,
  });

  const before = await getOnHand(itemId);

  // 3) Receive all
  const receipt = await api(`/purchasing/po/${po.id}:receive`, {
    method: "POST",
    body: { lines: [{ lineId: "L1", deltaQty: qty, locationId: "MAIN", lot: withTag("LOT", tag) }] }
  });

  const after = await getOnHand(itemId);

  return {
    flow: "purchaseOrder:receive",
    tag, poId: po.id, itemId, vendorId,
    before, after, receipt,
  };
}
