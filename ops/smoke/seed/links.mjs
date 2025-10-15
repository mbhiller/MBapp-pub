import { api } from "../core.mjs";
export default async function seedLinks({ ownerPartyId, animalPartyId }) {
  if (!ownerPartyId || !animalPartyId) return null;
  return api("/objects/partyLink", {
    method:"POST",
    body:{ type:"partyLink", aPartyId: ownerPartyId, bPartyId: animalPartyId, kind:"owns" }
  }).catch(()=>null);
}
