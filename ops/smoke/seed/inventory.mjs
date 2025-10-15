import { api } from "../core.mjs";

export default async function seedInventory({ products }) {
  const items = [];
  for (const p of products) {
    const inv = await api("/objects/inventory", {
      method:"POST",
      body: {
        type:"inventory",
        name: `${p.name} Item`,
        sku: p.sku,
        uom: "each",
        productId: p.id,
        lotTracked: false,
        status: "active",
      }
    });
    items.push(inv);
  }
  return items;
}
