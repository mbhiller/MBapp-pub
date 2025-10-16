/* ops/smoke/flows/events-flow.mjs */
import { withTag, createObject, updateObject, getObject, nowIso } from "../core.mjs";

function addHours(h) { return new Date(Date.now() + h*3600000).toISOString(); }

export async function run({ code = "ev", capacity = 50 } = {}) {
  const tag = String(code || "ev");
  const created = await createObject("event", {
    name: withTag("Smoke Event", tag),
    status: "draft",
    startsAt: nowIso(),
    endsAt: addHours(2),
    capacity
  });

  // publish/open -> capacity bump -> archive
  await updateObject("event", created.id, { status: "open", publishedAt: nowIso() });
  await updateObject("event", created.id, { capacity: capacity + 25 });
  const read = await getObject("event", created.id);
  await updateObject("event", created.id, { status: "archived" });

  return { flow: "events", id: created.id, name: read.name, capacityAfter: read.capacity, result: "PASS" };
}
