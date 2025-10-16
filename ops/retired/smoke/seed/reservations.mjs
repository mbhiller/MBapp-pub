import { api } from "../core.mjs";
const addMinutes = (iso, m) => new Date(new Date(iso).getTime()+m*60000).toISOString();

export default function seedReservations({ resourceId, partyId, clientId, clientName }) {
  const start = new Date().toISOString();
  const end   = addMinutes(start, 90);
  return api("/objects/reservation", {
    method:"POST",
    body:{
      type:"reservation",
      resourceId,
      partyId,     // new canonical
      clientId,    // legacy (optional)
      clientName,
      startsAt: start,
      endsAt:   end,
      status: "confirmed",
    }
  });
}
