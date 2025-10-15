#!/usr/bin/env node
import assert from "assert";
import { api } from "../core.mjs";

export async function run() {
  // make an org with NO customer role
  const party = await api("/objects/party", { method:"POST", body:{ type:"party", kind:"organization", displayName:"NonCustomer Org", status:"active" }});
  let blocked = false;
  try {
    await api("/objects/salesOrder", { method:"POST", body:{ type:"salesOrder", currency:"USD", partyId: party.id, status:"draft", lines: [] }});
  } catch { blocked = true; }
  assert.ok(blocked, "SO without customer role should be blocked");

  // grant role then succeed
  await api("/objects/partyRole", { method:"POST", body:{ type:"partyRole", partyId: party.id, role:"customer", active:true }});
  const so = await api("/objects/salesOrder", { method:"POST", body:{ type:"salesOrder", currency:"USD", partyId: party.id, status:"draft", lines: [] }});
  assert.ok(so?.id, "SO should succeed after adding customer role");
  return { test:"salesOrder:require-customer-role", result:"PASS" };
}
export default { run };
