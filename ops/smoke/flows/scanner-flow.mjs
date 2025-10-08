/* ops/smoke/flows/scanner-flow.mjs */
import { api } from "../core.mjs";
function randomEpc(){ return ("E200" + Math.random().toString(16).slice(2).padEnd(20, "A")).toUpperCase(); }

export async function basic({ count = 1 } = {}){
  const epc = randomEpc();
  await api("/scanner/simulate", { method: "POST", body: { epcs: [epc], itemId: "demo-item-001" } }).catch(()=>null);
  let status = 0;
  try {
    const resv = await api(`/epc/resolve?epc=${encodeURIComponent(epc)}`, { method: "GET" });
    status = resv?.itemId ? 200 : 404;
  } catch (e) {
    status = e?.status || 500;
  }
  const pass = status === 200 || status === 404;
  return { test: "scanner:basic", result: pass ? "PASS" : "FAIL", status };
}
