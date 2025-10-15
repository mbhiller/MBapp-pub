import { api } from "../core.mjs";

export default function seedRegistrations({ eventId, partyId, clientId, clientName, qty=1 }) {
  return api("/objects/registration", {
    method:"POST",
    body:{
      type:"registration",
      eventId,
      partyId,     // new canonical
      clientId,    // legacy (optional)
      clientName,
      qty,
      status:"confirmed",
    }
  });
}
