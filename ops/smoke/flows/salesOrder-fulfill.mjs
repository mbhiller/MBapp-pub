/* ops/smoke/flows/salesOrder-fulfill.mjs
 * Flow:
 * 1) Create item + stock via PO
 * 2) Create SO (line uses itemId), submit
 * 3) Reserve qty -> expect 200
 * 4) Commit (idempotent; allowed from submitted/committed/partially_fulfilled)
 * 5) Fulfill qty-1 -> expect 200 (SO -> partially_fulfilled)
 * 6) Try to over-fulfill (remaining + 1) -> expect 409 (exceeds remaining) if remaining > 0
 * 7) Fulfill the last remaining (if any) -> expect 200 (SO -> fulfilled)
 * 8) Return counters across checkpoints via /inventory/{id}/onhand
 */
import { rid, withTag, createObject, api } from "../core.mjs";
import * as Vendors from "../modules/vendors-smoke.mjs";
import * as Inventory from "../modules/inventory-smoke.mjs";

async function getOnHand(itemId) {
  try { return await api(`/inventory/${encodeURIComponent(itemId)}/onhand`, { method: "GET" }); }
  catch { return null; }
}

function remainingFromSoBody(body, lineId = "L1") {
  const lines = Array.isArray(body?.lines) ? body.lines : [];
  const l = lines.find(x => String(x.id) === String(lineId)) || {};
  const ordered = Number(l.qty ?? 0);
  const fulfilled = Number(l.qtyFulfilled ?? 0);
  return Math.max(0, ordered - fulfilled);
}

export async function run({ stock = 5, qty = 3, code = "ful", strict = false } = {}) {
  stock = Number(stock) > 0 ? Number(stock) : 1;
  qty   = Number(qty)   > 0 ? Number(qty)   : 1;
  const tag = String(code || "ful");

  // 1) item + stock via PO
  const inv = await Inventory.createMany({ each: 1, code: tag });
  const itemId = inv.created[0];

  const ven = await Vendors.createMany({ each: 1, code: tag });
  const po = await createObject("purchaseOrder", {
    type: "purchaseOrder",
    id: rid("po"),
    vendorId: ven.created[0],
    vendorName: withTag("Fulfill Vendor", tag),
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

  // 2) SO (line uses itemId) + submit
  const so = await createObject("salesOrder", {
    type: "salesOrder",
    id: rid("so"),
    customerName: withTag("Fulfill Customer", tag),
    status: "draft",
    lines: [{ id: "L1", itemId, qty, qtyFulfilled: 0 }],
  });
  await api(`/sales/so/${so.id}:submit`, { method: "POST", body: { id: so.id } });

  // 3) Reserve qty
  let reserve;
  try {
    const r = await api(`/sales/so/${so.id}:reserve`, {
      method: "POST",
      body: { lines: [{ lineId: "L1", deltaQty: qty }], ...(strict ? { strict: true } : {}) },
    });
    reserve = { ok: true, status: 200, body: r };
  } catch (e) {
    reserve = { ok: false, status: e?.status || 500, body: e?.response || { message: String(e) } };
  }

  const afterReserve = await getOnHand(itemId);

  // 4) Commit (safe if already committed/partially_fulfilled per your backend change)
  await api(`/sales/so/${so.id}:commit`, { method: "POST", body: { id: so.id } });

  // 5) Fulfill qty-1 (keep some remaining so we can test over-fulfill)
  const firstDelta = Math.max(1, qty - 1);
  let fulfillPart;
  try {
    const r = await api(`/sales/so/${so.id}:fulfill`, {
      method: "POST",
      body: { lines: [{ lineId: "L1", deltaQty: firstDelta }], ...(strict ? { strict: true } : {}) },
    });
    fulfillPart = { ok: true, status: 200, body: r };
  } catch (e) {
    fulfillPart = { ok: false, status: e?.status || 500, body: e?.response || { message: String(e) } };
  }

  const afterFulfillPart = await getOnHand(itemId);

  // compute remaining from the last SO body we have
  const remaining = remainingFromSoBody(fulfillPart?.body, "L1");

  // 6) Over-fulfill (remaining + 1) — only meaningful if there is remaining
  let over = null;
  if (remaining > 0) {
    try {
      const r = await api(`/sales/so/${so.id}:fulfill`, {
        method: "POST",
        body: { lines: [{ lineId: "L1", deltaQty: remaining + 1 }], ...(strict ? { strict: true } : {}) },
      });
      over = { ok: true, status: 200, body: r };
    } catch (e) {
      over = { ok: false, status: e?.status || 500, body: e?.response || { message: String(e) } };
    }
  }

  const afterOver = await getOnHand(itemId);

  // 7) Finalize: fulfill the last remaining (if any)
  let fulfillFinal = null;
  if (remaining > 0) {
    try {
      const r = await api(`/sales/so/${so.id}:fulfill`, {
        method: "POST",
        body: { lines: [{ lineId: "L1", deltaQty: Math.min(1, remaining) }], ...(strict ? { strict: true } : {}) },
      });
      fulfillFinal = { ok: true, status: 200, body: r };
    } catch (e) {
      fulfillFinal = { ok: false, status: e?.status || 500, body: e?.response || { message: String(e) } };
    }
  }

  const afterFinal = await getOnHand(itemId);

  return {
    flow: "salesOrder:fulfill",
    itemId, soId: so.id, tag, stock, qty,
    counters: { before, afterReserve, afterFulfillPart, afterOver, afterFinal },
    reserve,
    fulfillPart,
    over,
    fulfillFinal
  };
}
