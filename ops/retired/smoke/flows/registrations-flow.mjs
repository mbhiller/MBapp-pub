/* ops/smoke/flows/registrations-flow.mjs */
import { withTag, createObject, updateObject, api, nowIso } from "../core.mjs";

function addHours(h) { return new Date(Date.now() + h*3600000).toISOString(); }

export async function run({ code = "reg" } = {}) {
  const tag = String(code || "reg");
  // event + client scaffolds
  const ev = await createObject("event", {
    name: withTag("Reg Event", tag),
    status: "open",
    startsAt: nowIso(),
    endsAt: addHours(1),
    capacity: 25
  });
  const client = await createObject("client", { name: withTag("Reg Client", tag) });

  // register -> checkin -> checkout -> cancel
  const reg = await createObject("registration", {
    eventId: ev.id, clientId: client.id, clientName: client.name, qty: 1, status: "pending"
  });

  const checkin  = await api(`/events/registration/${encodeURIComponent(reg.id)}:checkin`,  { method: "POST", body: {} });
  const checkout = await api(`/events/registration/${encodeURIComponent(reg.id)}:checkout`, { method: "POST", body: {} });
  const cancel   = await api(`/events/registration/${encodeURIComponent(reg.id)}:cancel`,   { method: "POST", body: {} });

  const ok = !!(checkin && checkout && cancel);
  return { flow: "registrations", eventId: ev.id, registrationId: reg.id, result: ok ? "PASS" : "ERROR" };
}
