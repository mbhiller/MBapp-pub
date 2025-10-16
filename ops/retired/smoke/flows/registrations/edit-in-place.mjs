#!/usr/bin/env node
import assert from "assert";
import { api } from "../../core.mjs";

export async function run() {
  const reg = await api("/objects/registration", { method:"POST", body:{ lines:[{classId:"class-101",qty:1},{classId:"class-201",qty:2}] }});
  await api(`/objects/registration/${reg.id}`, { method:"PUT", body:{ lines:[{ id: reg.lines[0].id, classId: reg.lines[0].classId, qty:3 }] }});
  const got = await api(`/objects/registration/${reg.id}`, { method:"GET" });
  assert.equal(got.lines.length, 1); assert.equal(got.lines[0].qty, 3);
  return { test:"registrations:edit-in-place", result:"PASS", id: reg.id };
}
export default { run };
