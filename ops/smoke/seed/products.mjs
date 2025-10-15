import { safeCreate, uniqueSku } from "./util.mjs";

export default async function seedProducts() {
  const templates = [
    { name:"Hay Bale",  kind:"good",    price: 8.5 },
    { name:"Shavings",  kind:"good",    price: 6.25 },
    { name:"Day Stall", kind:"service", price: 35 },
  ];
  const out = [];
  for (const t of templates) {
    const body0 = { type:"product", name:t.name, kind:t.kind, sku: uniqueSku("SKU"), price: t.price, status:"active" };
    out.push(await safeCreate("product", body0, (b)=>({ ...b, sku: uniqueSku("SKU") })));
  }
  return out; // 3 per call
}
