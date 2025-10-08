/* ops/smoke/flows/scanner-flow.mjs */
import { api } from "../core.mjs";
function randomEpc(){ return ("E200" + Math.random().toString(16).slice(2).padEnd(20, "A")).toUpperCase(); }
export async function basic({ count = 3 } = {}){
  await api("/scanner/simulate", { method: "POST", body: { count } }).catch(()=>null);
  const probe = await api(`/epc/resolve?epc=${encodeURIComponent(randomEpc())}`, { method: "GET" }).catch(e => ({ status: e.status||500 }));
  const status = probe?.status || 200;
  const pass = status === 200 || status === 404;
  return { test: "scanner:basic", result: pass ? "PASS" : "FAIL", status };
}
