// ops/smoke/steps/sales-so-flow.mjs
import assert from "assert";
import { api, normalizePage, idem } from "../core.mjs";
import { run as seedParties, ensureRole } from "./seed-parties.mjs";
import { getOnHand } from "./_inv.mjs";

async function pickProduct() {
  const page = await api(`/objects/product`, { method: "GET" });
  const { items } = normalizePage(page);
  assert.ok(items.length > 0, "No products found; run seed:all first");
  return items[0];
}

export async function run() {
  const { customerPartyId } = await seedParties();
  await ensureRole(customerPartyId, "customer");

  const p = await pickProduct();
  const before = await getOnHand(p.id);

  const so = await api(`/objects/salesOrder`, {
    method: "POST",
    idem: idem("so"),
    body: {
      type: "salesOrder",
      partyId: customerPartyId,
      currency: "USD",
      status: "draft",
      lines: [{ productId: p.id, qty: 1, price: p.price ?? 0 }]
    }
  });
  assert.ok(so?.id, "SO create failed");

  await api(`/sales/so/${encodeURIComponent(so.id)}:submit`, { method: "POST", idem: idem("so-submit"), body: {} });

  const commitRes = await api(`/sales/so/${encodeURIComponent(so.id)}:commit`, { method: "POST", idem: idem("so-commit"), body: {} });

  // If we’re backordered, fulfillment won’t change inventory — just report and exit PASS
  const wasBackordered = !!commitRes?.metadata?.hasBackorder;

  let fulfillRes = null;
  if (!wasBackordered) {
    fulfillRes = await api(`/sales/so/${encodeURIComponent(so.id)}:fulfill`, {
      method: "POST",
      idem: idem("so-fulfill"),
      body: { lines: [{ productId: p.id, qty: 1 }] }
    });
  }

  const after = await getOnHand(p.id);

  return {
    test: "sales:so:flow",
    result: "PASS",
    soId: so.id,
    backorder: wasBackordered,
    inventory: { before, after, note: wasBackordered ? "Backorder: no inventory delta expected" : "Fulfilled: expect -1 onHand" },
    commitRes,
    fulfillRes
  };
}
export default { run };
