#!/usr/bin/env node
import assert from "assert";
import { api } from "../core.mjs";

export async function run() {
  const party = await api("/objects/party", { method:"POST", body:{ type:"party", kind:"organization", displayName:"NonVendor Org", status:"active" }});
  let blocked = false;
  try {
    await api("/objects/purchaseOrder", { method:"POST", body:{ type:"purchaseOrder", currency:"USD", partyId: party.id, status:"draft", lines: [] }});
  } catch { blocked = true; }
  assert.ok(blocked, "PO without vendor role should be blocked");

  await api("/objects/partyRole", { method:"POST", body:{ type:"partyRole", partyId: party.id, role:"vendor", active:true }});
  const po = await api("/objects/purchaseOrder", { method:"POST", body:{ type:"purchaseOrder", currency:"USD", partyId: party.id, status:"draft", lines: [] }});
  assert.ok(po?.id, "PO should succeed after adding vendor role");
  return { test:"purchaseOrder:require-vendor-role", result:"PASS" };
}
export default { run };
