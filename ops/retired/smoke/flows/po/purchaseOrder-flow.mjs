/* ops/smoke/flows/purchaseOrder-flow.mjs */
import { rid, withTag, createObject, api } from "../../core.mjs";
import * as Inventory from "../../modules/inventory-smoke.mjs";
import * as Vendors from "../../modules/vendors-smoke.mjs";
export async function run({ lines = 3, qty = 2, code = "po" } = {}) {
  const tag = String(code || "po");
  const inv = await Inventory.createMany({ each: lines, code: tag });
  const ven = await Vendors.createMany({ each: 1, code: tag });
  const po = await createObject("purchaseOrder", {
    type: "purchaseOrder",
    id: rid("po"),
    vendorId: ven.created[0],
    vendorName: withTag("Smoke Vendor", tag),
    status: "draft",
    lines: inv.created.map((itemId, i) => ({ id: `L${i+1}`, itemId, uom: "each", qty: Number(qty), qtyReceived: 0 })),
  });
  await api(`/purchasing/po/${encodeURIComponent(po.id)}:submit`, { method: "POST", body: { id: po.id } });
  await api(`/purchasing/po/${encodeURIComponent(po.id)}:approve`, { method: "POST", body: { id: po.id } });
  const idem = `idem-${Date.now()}`;
  await api(`/purchasing/po/${encodeURIComponent(po.id)}:receive`, {
    method: "POST",
    headers: { "Idempotency-Key": idem },
    body: { idempotencyKey: idem, lines: po.lines.map(l => ({ lineId: l.id, deltaQty: l.qty })) },
  });
  await api(`/purchasing/po/${encodeURIComponent(po.id)}:close`, { method: "POST", body: { id: po.id } });
  return { flow: "purchaseOrder", id: po.id, lines: po.lines.length, tag };
}
