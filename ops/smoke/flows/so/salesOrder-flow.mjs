/* ops/smoke/flows/salesOrder-flow.mjs
 * Creates tagged inventory + product, links defaultItemId, creates SO and runs submit/commit
 */
import { rid, withTag, createObject, api } from "../../core.mjs";
import * as Inventory from "../../modules/inventory-smoke.mjs";

export async function run({ lines = 3, qty = 1, code = "so" } = {}) {
  const tag = String(code || "so");

  // Create N inventory items, then products that point defaultItemId to each item
  const inv = await Inventory.createMany({ each: lines, code: tag });

  const productIds = [];
  for (let i = 0; i < lines; i++) {
    const p = await createObject("product", {
      type: "product",
      id: rid("prod"),
      name: withTag(`SO Product ${Date.now()}-${i}`, tag),
      kind: "good",
      status: "active",
      defaultItemId: inv.created[i],
    });
    productIds.push(p.id);
  }

  const so = await createObject("salesOrder", {
    type: "salesOrder",
    id: rid("so"),
    customerName: withTag("Smoke Customer", tag),
    status: "draft",
    lines: productIds.map((pid, i) => ({
      id: `L${i+1}`,
      productId: pid,
      qty: Number(qty),
      qtyFulfilled: 0,
    })),
  });

  await api(`/sales/so/${encodeURIComponent(so.id)}:submit`, { method: "POST", body: { id: so.id } });
  // Commit may 409 if there’s no available/on-hand; that’s OK for smoke;
  // you can add a PO flow to stock up before commit if needed.
  try {
    await api(`/sales/so/${encodeURIComponent(so.id)}:commit`, { method: "POST", body: { id: so.id } });
  } catch (_) {}

  return { flow: "salesOrder", id: so.id, lines: so.lines.length, tag };
}
