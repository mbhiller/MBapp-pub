/* ops/smoke/flows/seed-all.mjs */
import { rid, withTag, createObject, updateObject, api } from "../core.mjs";
import * as Inventory from "../modules/inventory-smoke.mjs";
import * as Products from "../modules/products-smoke.mjs";
import * as Vendors from "../modules/vendors-smoke.mjs";
import * as Clients from "../modules/clients-smoke.mjs";
import * as Employees from "../modules/employees-smoke.mjs";
import * as GR from "../modules/goodsReceipts-smoke.mjs";
import * as SF from "../modules/salesFulfillments-smoke.mjs";
import * as Resources from "../modules/resources-smoke.mjs";

function nowIso() { return new Date().toISOString(); }

export async function run({ code = "seed", lines = 2, qty = 3 } = {}) {
  const tag = String(code || "seed");

  // 1) Core actors
  const ven = await Vendors.createMany({ each: 1, code: tag });
  const cli = await Clients.createMany({ each: 1, code: tag });
  const emp = await Employees.createMany({ each: 1, code: tag });

  // 2) Inventory + Products (linked defaultItemId, price/tax/status/notes filled)
  const inv = await Inventory.createMany({ each: lines, code: tag });
  const pro = await Products.createMany({ each: lines, code: tag });

  // Link defaultItemId on each product to a corresponding inventory item
  for (let i = 0; i < lines; i++) {
    const productId = pro.created[i];
    const itemId = inv.ids[i];
    await updateObject("product", productId, {
      defaultItemId: itemId,
      price: 19.99 + i,
      taxCode: "TAX-STD",
      kind: "good",
      status: "active",
      notes: withTag("Seeded product", tag),
    });
  }

  // 3) Purchase Order -> Receive (Goods Receipt)
  const po = await createObject("purchaseOrder", {
    type: "purchaseOrder",
    id: rid("po"),
    vendorId: ven.ids[0],
    status: "submitted",
    notes: withTag("Seed PO", tag),
    attachments: [],
    lines: inv.ids.slice(0, lines).map((itemId, idx) => ({
      id: `L${idx+1}`, itemId, qtyOrdered: qty, qtyReceived: 0, uom: "each",
    })),
  });

  const grRes = await api(`/purchasing/po/${po.id}:receive`, {
    method: "POST",
    body: {
      lines: inv.ids.slice(0, lines).map((_, idx) => ({
        lineId: `L${idx+1}`, deltaQty: qty, locationId: "MAIN", lot: withTag("LOT", tag),
      })),
      ts: nowIso(),
      notes: withTag("Seed receipt", tag),
    }
  });

  // 4) Sales Order -> Reserve/Commit -> Fulfill (Sales Fulfillment)
  const so = await createObject("salesOrder", {
    type: "salesOrder",
    id: rid("so"),
    customerId: cli.ids[0],
    status: "submitted",
    notes: withTag("Seed SO", tag),
    attachments: [],
    lines: inv.ids.slice(0, lines).map((itemId, idx) => ({
      id: `L${idx+1}`, itemId, qtyOrdered: qty, qtyCommitted: 0, qtyFulfilled: 0, uom: "each",
    })),
  });

  await api(`/sales/so/${so.id}:reserve`, { method: "POST", body: { lines: [{ lineId: "L1", deltaQty: qty }] } });
  await api(`/sales/so/${so.id}:commit`,  { method: "POST", body: {} });

  const sfRes = await api(`/sales/so/${so.id}:fulfill`, {
    method: "POST",
    body: {
      lines: [{ lineId: "L1", deltaQty: qty, locationId: "MAIN", lot: withTag("LOT", tag) }],
      ts: nowIso(),
      notes: withTag("Seed fulfillment", tag),
    }
  });

  // 5) Ledger checks (goods receipts + fulfillments exist)
  const receipts = await GR.listAll({ limit: 50 });
  const fulfills = await SF.listAll({ limit: 50 });

  //6 Resources
  const res = await Resources.createMany({ each: 2, code: tag, kind: "stall" });
    const resHold = await api(`/reservations:hold`, {
    method: "POST",
    body: {
        idempotencyKey: rid("idem"),
        resourceId: res.ids[0],
        startsAt: nowIso(),
        endsAt: new Date(Date.now() + 2 * 3600_000).toISOString(),
        notes: withTag("Seed reservation", tag),
    }
    });
const resConfirm = await api(`/reservations/${resHold.id}:confirm`, { method: "POST", body: {} });
  return {
    flow: "seed-all",
    tag,
    vendorId: ven.ids[0],
    clientId: cli.ids[0],
    employeeId: emp.ids[0],
    productIds: pro.created,
    inventoryIds: inv.ids,
    poId: po.id, soId: so.id,
    grRes, sfRes,
    ledgers: { goodsReceipts: receipts.length, salesFulfillments: fulfills.length },
    reservations: { created: [resHold.id], confirmed: [resConfirm?.id || resHold.id] },
    resourceIds: res.ids,
  };
}
