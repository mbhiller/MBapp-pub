/* ops/smoke/flows/salesOrder-reserve.mjs */
import { rid, withTag, createObject, api } from "../core.mjs";
import * as Vendors from "../modules/vendors-smoke.mjs";
import * as Inventory from "../modules/inventory-smoke.mjs";

async function getOnHand(itemId) {
  try { return await api(`/inventory/${encodeURIComponent(itemId)}/onhand`, { method: "GET" }); }
  catch { return null; }
}

export async function run({ stock = 5, qty = 3, code = "res", strict = false } = {}) {
  stock = Number(stock) > 0 ? Number(stock) : 1;
  qty   = Number(qty)   > 0 ? Number(qty)   : 1;
  const tag = String(code || "res");

  // 1) create item
  const inv = await Inventory.createMany({ each: 1, code: tag });
  const itemId = inv.created[0];

  // 2) stock via PO (submit → approve → receive → close)
  const ven = await Vendors.createMany({ each: 1, code: tag });
  const po = await createObject("purchaseOrder", {
    type: "purchaseOrder",
    id: rid("po"),
    vendorId: ven.created[0],
    vendorName: withTag("Reserve Vendor", tag),
    status: "draft",
    lines: [{ id: "L1", itemId, uom: "each", qty: stock, qtyReceived: 0 }],
  });
  await api(`/purchasing/po/${po.id}:submit`,  { method: "POST", body: { id: po.id } });
  await api(`/purchasing/po/${po.id}:approve`, { method: "POST", body: { id: po.id } });
  const idem = `idem-${Date.now()}`;
  await api(`/purchasing/po/${po.id}:receive`, {
    method: "POST",
    headers: { "Idempotency-Key": idem },
    body: { idempotencyKey: idem, lines: [{ lineId: "L1", deltaQty: stock }] },
  });
  await api(`/purchasing/po/${po.id}:close`,   { method: "POST", body: { id: po.id } });

  const before = await getOnHand(itemId);

  // 3) product (optional)
  const prod = await createObject("product", {
    type: "product",
    id: rid("prod"),
    name: withTag("Reserve Product", tag),
    kind: "good",
    status: "active",
    defaultItemId: itemId,
  });

  // 4) SO using itemId
  const so = await createObject("salesOrder", {
    type: "salesOrder",
    id: rid("so"),
    customerName: withTag("Reserve Customer", tag),
    status: "draft",
    lines: [{ id: "L1", itemId, qty, qtyFulfilled: 0, note: `prod=${prod.id}` }],
  });
  await api(`/sales/so/${so.id}:submit`, { method: "POST", body: { id: so.id } });

  // 5) Reserve qty
  let first;
  try {
    const r = await api(`/sales/so/${so.id}:reserve`, {
      method: "POST",
      body: { lines: [{ lineId: "L1", deltaQty: qty }], ...(strict ? { strict: true } : {}) },
    });
    first = { ok: true, status: 200, body: r };
  } catch (e) {
    first = { ok: false, status: e?.status || 500, body: e?.response || { message: String(e) } };
  }

  // 6) Reserve +1 (expect 409 if strict; else 200 no-op)
  let second;
  try {
    const r = await api(`/sales/so/${so.id}:reserve`, {
      method: "POST",
      body: { lines: [{ lineId: "L1", deltaQty: 1 }], ...(strict ? { strict: true } : {}) },
    });
    second = { ok: true, status: 200, body: r };
  } catch (e) {
    second = { ok: false, status: e?.status || 500, body: e?.response || { message: String(e) } };
  }

  const after = await getOnHand(itemId);

  return {
    flow: "salesOrder:reserve",
    itemId, productId: prod.id, soId: so.id, tag,
    stock, qty,
    counters: { before, after },
    attempts: { first, second },
  };
}
