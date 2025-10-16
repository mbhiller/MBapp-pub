#!/usr/bin/env node
import assert from "assert";
import { api } from "../../core.mjs";

export async function run() {
  const event = await api("/events", { method: "POST", body: { name: "Cap Test", status: "open", capacity: 1 } });
  await api("/registrations", { method: "POST", body: { eventId: event.id, lines: [{ classId: "class-101", qty: 1 }] } });
  let blocked = false;
  try {
    await api("/registrations", { method: "POST", body: { eventId: event.id, lines: [{ classId: "class-101", qty: 1 }] } });
  } catch {
    blocked = true;
  }
  assert.ok(blocked, "second registration should be blocked by capacity");
  return { test: "events:capacity-guard", result: "PASS", eventId: event.id };
}
export default { run };
