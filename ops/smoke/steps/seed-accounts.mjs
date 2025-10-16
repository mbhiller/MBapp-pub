import { api } from "../core.mjs";
export async function run({ customerPartyId, vendorPartyId }) {
  const ca = await api(`/objects/customerAccount`, { method:"POST", body:{ type:"customerAccount", partyId: customerPartyId, accountNumber: "C-SMOKE-001" } }).catch(() => null);
  const va = await api(`/objects/vendorAccount`,   { method:"POST", body:{ type:"vendorAccount",   partyId: vendorPartyId,   accountNumber: "V-SMOKE-001" } }).catch(() => null);
  return { customerAccountId: ca?.id, vendorAccountId: va?.id };
}
