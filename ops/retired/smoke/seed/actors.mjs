import { safeCreate, uniqueName, uniqueEmail } from "./util.mjs";

export default async function seedActors({ customers=2, vendors=1 } = {}) {
  const out = { customers: [], vendors: [] };
  for (let i=0;i<customers;i++) {
    const name = uniqueName("Client");
    out.customers.push(await safeCreate("client", {
      type:"client", name, email: uniqueEmail(name), phone: `555-${1000+Math.floor(Math.random()*9000)}`, status:"active"
    }, (b)=>({ ...b, name: uniqueName("Client"), email: uniqueEmail(uniqueName("Client")) })));
  }
  for (let i=0;i<vendors;i++) {
    const name = uniqueName("Vendor");
    out.vendors.push(await safeCreate("vendor", {
      type:"vendor", name, email: uniqueEmail(name), phone: `555-${1000+Math.floor(Math.random()*9000)}`, status:"active"
    }, (b)=>({ ...b, name: uniqueName("Vendor"), email: uniqueEmail(uniqueName("Vendor")) })));
  }
  return out;
}
