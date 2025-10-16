#!/usr/bin/env node
import assert from "assert";
import { api, nowIso } from "../../core.mjs";

const addMinutes = (iso, m) => new Date(new Date(iso).getTime() + m*60*1000).toISOString();

export async function run() {
  const res = await api("/resources", { method: "POST", body: { name: "Ring C", type: "arena", status: "available" }});
  const start = nowIso();
  const end = addMinutes(start, 90);

  await api("/reservations", { method: "POST", body: { resourceId: res.id, startsAt: start, endsAt: end, status: "confirmed" } });
  let blocked = false;
  try {
    await api("/reservations", { method: "POST", body: { resourceId: res.id, startsAt: start, endsAt: end, status: "confirmed" } });
  } catch {
    blocked = true;
  }
  assert.ok(blocked, "double-book should be blocked");
  return { test: "reservations:conflict-guard", result: "PASS", resourceId: res.id };
}
export default { run };
