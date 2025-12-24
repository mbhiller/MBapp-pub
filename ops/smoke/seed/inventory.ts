// ops/smoke/seed/inventory.ts
// Seeds a product + inventory item + a small receive movement.
export async function seedInventory(api: { post: Function }) {
  const rid = process.env.SMOKE_RUN_ID || `smk-${Date.now()}`;
  const prod = await api.post(`/objects/product`, {
    type: "product",
    name: `${rid}-Seed Product`,
    sku: `${rid}-SEED-${Math.random().toString(36).slice(2, 7)}`,
  });
  if (!prod.ok) return { ok: false, step: "product", res: prod };

  const productId = prod.body?.id;

  const item = await api.post(`/objects/inventory`, {
    type: "inventory",
    name: `${rid}-Seed Item`,
    productId,
    uom: "ea",
  });
  if (!item.ok) return { ok: false, step: "inventory", res: item };

  const itemId = item.body?.id;

  const mv = await api.post(`/objects/inventoryMovement`, {
    type: "inventoryMovement",
    itemId,
    action: "receive",
    qty: 10,
  });
  if (!mv.ok) return { ok: false, step: "movement", res: mv };

  return { ok: true, productId, itemId };
}
