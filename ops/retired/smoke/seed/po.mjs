import { api } from "../core.mjs";
const money = (n) => Math.round(n*100)/100;

export default function seedPO({ partyId, items, vendorName, vendorId }) {
  return api("/objects/purchaseOrder", {
    method:"POST",
    body:{
      type:"purchaseOrder",
      currency:"USD",
      partyId,           // new canonical
      vendorId,  
      vendorName,
      status:"draft",
      lines: items.slice(0,3).map((it,i)=>({
        itemId: it.id,
        productId: it.productId ?? null,
        description: it.name,
        uom: it.uom || "each",
        qty: (i+1)*5,
        qtyReceived: 0,
        unitPrice: money(5 + i*0.5),
      })),
    }
  });
}
