#!/usr/bin/env node
import assert from "assert";
import { api } from "../core.mjs";

async function verifyRegistration() {
  const reg = await api("/objects/registration", { method:"POST", body:{ lines:[{classId:"class-101",qty:1},{classId:"class-201",qty:2}] }});
  await api(`/objects/registration/${reg.id}`, { method:"PUT", body:{ lines:[{ id: reg.lines[0].id, classId: reg.lines[0].classId, qty:3 }] }});
  const got = await api(`/objects/registration/${reg.id}`, { method:"GET" });
  assert.equal(got.lines.length, 1); assert.equal(got.lines[0].qty, 3);
}

async function verifySO() {
  const so = await api("/objects/salesOrder", { method:"POST", body:{ status:"draft", lines:[{itemId:"sku-001",qty:1},{itemId:"sku-002",qty:2}] }});
  await api(`/objects/salesOrder/${so.id}`, { method:"PUT", body:{ lines:[{ id: so.lines[0].id, itemId: so.lines[0].itemId, qty:3 }] }});
  const got = await api(`/objects/salesOrder/${so.id}`, { method:"GET" });
  assert.equal(got.lines.length, 1); assert.equal(got.lines[0].qty, 3);
}

async function verifyPO() {
  const po = await api("/objects/purchaseOrder", { method:"POST", body:{ status:"draft", lines:[{itemId:"sku-001",qty:5},{itemId:"sku-002",qty:6}] }});
  await api(`/objects/purchaseOrder/${po.id}`, { method:"PUT", body:{ lines:[{ id: po.lines[0].id, itemId: po.lines[0].itemId, qty:9 }] }});
  const got = await api(`/objects/purchaseOrder/${po.id}`, { method:"GET" });
  assert.equal(got.lines.length, 1); assert.equal(got.lines[0].qty, 9);
}

export async function run() {
  await verifyRegistration(); await verifySO(); await verifyPO();
  return { test:"verify:edits", result:"PASS" };
}
export default { run };
