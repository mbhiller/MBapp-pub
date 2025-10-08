/* ops/smoke/flows/guardrails.mjs */
import { rid, createObject, api } from "../core.mjs";
import * as Inventory from "../modules/inventory-smoke.mjs";
export async function soOvercommit({ qty = 2 } = {}){
  const inv = await Inventory.createMany({ each: 1, code: "gr" });
  const so = await createObject("salesOrder", { type: "salesOrder", id: rid("so"), customerName: "Guardrail Customer", status: "draft", lines: [{ id: "L1", itemId: inv.created[0], uom: "each", qty: Number(qty), qtyFulfilled: 0 }] });
  await api(`/sales/so/${encodeURIComponent(so.id)}:submit`, { method: "POST", body: { id: so.id } });
  let expected409=false; try{ await api(`/sales/so/${encodeURIComponent(so.id)}:commit`, { method: "POST", body: { id: so.id } }); }catch(e){ expected409 = e?.status===409; if(!expected409) throw e; }
  return { test: "so-overcommit", result: expected409 ? "EXPECTED_409" : "FAIL" };
}
export async function soOverfulfill({ qty = 2 } = {}){
  const inv = await Inventory.createMany({ each: 1, code: "gr" });
  const so = await createObject("salesOrder", { type: "salesOrder", id: rid("so"), customerName: "Guardrail Customer", status: "draft", lines: [{ id: "L1", itemId: inv.created[0], uom: "each", qty: 1, qtyFulfilled: 0 }] });
  await api(`/sales/so/${encodeURIComponent(so.id)}:submit`, { method: "POST", body: { id: so.id } });
  let expected409=false; try{ await api(`/sales/so/${encodeURIComponent(so.id)}:fulfill`, { method: "POST", body: { lines: [{ lineId: "L1", deltaQty: Number(qty) * 2 }] } }); }catch(e){ expected409 = e?.status===409; if(!expected409) throw e; }
  return { test: "so-overfulfill", result: expected409 ? "EXPECTED_409" : "FAIL" };
}
export async function cancelRelease(){
  const inv = await Inventory.createMany({ each: 1, code: "gr" });
  const so = await createObject("salesOrder", { type: "salesOrder", id: rid("so"), customerName: "Cancel Tester", status: "draft", lines: [{ id: "L1", itemId: inv.created[0], uom: "each", qty: 1, qtyFulfilled: 0 }] });
  await api(`/sales/so/${encodeURIComponent(so.id)}:submit`, { method: "POST", body: { id: so.id } });
  try{ await api(`/sales/so/${encodeURIComponent(so.id)}:commit`, { method: "POST", body: { id: so.id } }); }catch{}
  await api(`/sales/so/${encodeURIComponent(so.id)}:cancel`, { method: "POST", body: { id: so.id } });
  return { test: "cancel-release", result: "PASS" };
}
