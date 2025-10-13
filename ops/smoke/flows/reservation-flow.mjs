/* Create resources -> hold -> confirm a reservation; checks conflicts optionally */
import { rid, withTag, api } from "../core.mjs";
import * as Resources from "../modules/resources-smoke.mjs";
import * as Clients from "../modules/clients-smoke.mjs";

function isoOffset(minutes) { return new Date(Date.now() + minutes * 60_000).toISOString(); }

export async function run({ kind = "stall", code = "resv", durationMin = 120 } = {}) {
  const tag = String(code || "resv");
  const res = await Resources.createMany({ each: 1, code: tag, kind });
  const cli = await Clients.createMany({ each: 1, code: tag });

  const resourceId = res.ids[0];
  const startsAt = isoOffset(5);
  const endsAt = isoOffset(5 + durationMin);

  // HOLD
  const hold = await api(`/reservations:hold`, {
    method: "POST",
    body: {
      idempotencyKey: rid("idem"),
      resourceId, startsAt, endsAt,
      clientId: cli.ids[0],
      notes: withTag("seed hold", tag),
    }
  });

  // CONFIRM
  const confirm = await api(`/reservations/${hold.id}:confirm`, { method: "POST", body: {} });

  // Optional: try conflicting hold to ensure guardrail (expect 409 if enforced)
  let conflict;
  try {
    conflict = await api(`/reservations:hold`, {
      method: "POST",
      body: {
        idempotencyKey: rid("idem"),
        resourceId,
        startsAt: isoOffset(10),
        endsAt: isoOffset(10 + durationMin),
        clientId: cli.ids[0],
        notes: withTag("conflict test", tag),
      }
    });
  } catch (e) {
    conflict = { expected: "409 or rejection", message: e?.message || String(e) };
  }

  return { flow: "reservations", tag, resourceId, reservationId: hold.id, confirm, conflict };
}
