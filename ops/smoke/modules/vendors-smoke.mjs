/* ops/smoke/modules/vendors-smoke.mjs */
import { rid, withTag, createObject, listObjects, updateObject, deleteObject } from "../core.mjs";
const TYPE = "vendor";
function scaffold(code){ const n=Date.now(); return { type: TYPE, id: rid("ven"), name: withTag(`Vendor ${n}`, code), status: "active" }; }
export async function createMany({ each = 1, code } = {}){ const ids=[]; for(let i=0;i<Number(each);i++){ const created=await createObject(TYPE, scaffold(code)); ids.push(created.id);} return { type: TYPE, created: ids }; }
export async function listAll({ limit = 50 } = {}){ const page = await listObjects(TYPE, { limit }); return { type: TYPE, count: (page.items||[]).length, items: page.items }; }
export async function updateSome({ limit = 5, code } = {}){ const page = await listObjects(TYPE, { limit }); const ids=[]; for(const it of page.items||[]){ const res=await updateObject(TYPE, it.id, { name: withTag(it.name||"Vendor", code) }); ids.push(res.id);} return { type: TYPE, updated: ids.length, ids }; }
export async function deleteAll(){ let total=0,next; do{ const page=await listObjects(TYPE,{ limit:50,next}); for(const it of page.items||[]){ await deleteObject(TYPE,it.id); total++; } next=page.next; }while(next); return { type: TYPE, deleted: total }; }
