import { api } from "../core.mjs";
const money = (n) => Math.round(n*100)/100;

export default function seedSO({ partyId, items, customerName, customerId }) {
  return api("/objects/salesOrder", {
    method:"POST",
    body:{
      type:"salesOrder",
      currency:"USD",
      partyId,            // new canonical
      customerId, 
      customerName,
      status:"draft",
      lines: items.slice(0,3).map((it,i)=>({
        itemId: it.id,
        productId: it.productId ?? null,
        description: it.name,
        uom: it.uom || "each",
        qty: (i+1),
        qtyCommitted: 0,
        qtyFulfilled: 0,
        unitPrice: money(10 + i*1.25),
      })),
    }
  });
}
