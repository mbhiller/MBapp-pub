/* ops/smoke/flows/reservation-flow.mjs */
import { rid, withTag, createObject, nowIso } from "../core.mjs";
import * as Clients from "../modules/clients-smoke.mjs";
import * as Resources from "../modules/resources-smoke.mjs";
function addMinutes(dt, m){ return new Date(new Date(dt).getTime()+m*60000).toISOString(); }
export async function run({ code = "resv", durationMin = 90 } = {}) {
  const tag = String(code || "resv");
  const client = await Clients.createMany({ each: 1, code: tag });
  const resource = await Resources.createMany({ each: 1, code: tag });
  const startsAt = nowIso();
  const reservation = await createObject("reservation", {
    type: "reservation",
    id: rid("resv"),
    name: withTag("Smoke Reservation", tag),
    status: "pending",
    clientId: client.created[0],
    resourceId: resource.created[0],
    startsAt,
    endsAt: addMinutes(startsAt, Number(durationMin)||90),
  });
  return { flow: "reservation", id: reservation.id, clientId: reservation.clientId, resourceId: reservation.resourceId, tag };
}
