#!/usr/bin/env node
import process from "node:process";
import assert from "node:assert/strict";
import { baseGraph } from "./seed/routing.ts";
import { seedParties, seedVendor } from "./seed/parties.ts";

const API=(process.env.MBAPP_API_BASE??"http://localhost:3000").replace(/\/+$/,"");
const TENANT=process.env.MBAPP_TENANT_ID??"DemoTenant";
const EMAIL=process.env.MBAPP_DEV_EMAIL??"dev@example.com";

async function ensureBearer(){
  if(process.env.MBAPP_BEARER) return;
  try{
    const r=await fetch(API+"/auth/dev-login",{
      method:"POST",
      headers:{"Content-Type":"application/json","X-Tenant-Id":TENANT},
      body:JSON.stringify({email:EMAIL,tenantId:TENANT})
    });
    if(r.ok){
      const j=await r.json().catch(()=>({}));
      if(j?.token) process.env.MBAPP_BEARER=j.token;
    }
  }catch{}
}
function baseHeaders(){
  const h={"accept":"application/json","Content-Type":"application/json","X-Tenant-Id":TENANT};
  const b=process.env.MBAPP_BEARER||process.env.MBAPP_API_KEY;
  if(b) h["Authorization"]=`Bearer ${b}`;
  return h;
}

function idem() {
  // short, unique-ish key per request; good enough for smokes
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

async function get(p){
  const r=await fetch(API+p,{headers:baseHeaders()});
  const b=await r.json().catch(()=>({}));
  return {ok:r.ok,status:r.status,body:b};
}
async function post(p,body,h={}){
  const r=await fetch(API+p,{method:"POST",headers:{...baseHeaders(),...h},body:JSON.stringify(body??{})});
  const j=await r.json().catch(()=>({}));
  return {ok:r.ok,status:r.status,body:j};
}
async function put(p,body,h={}){
  const r=await fetch(API+p,{method:"PUT",headers:{...baseHeaders(),...h},body:JSON.stringify(body??{})});
  const j=await r.json().catch(()=>({}));
  return {ok:r.ok,status:r.status,body:j};
}

async function onhand(itemId){
  return await get(`/inventory/${encodeURIComponent(itemId)}/onhand`);
}

/** Try multiple movement payload shapes until on-hand increases. */
async function ensureOnHand(itemId, qty){
  // 1) Try { type: 'receive' }
  let r1 = await post(`/objects/${MV_TYPE}`, { itemId, type:"receive", qty });
  let oh1 = await onhand(itemId);
  if (r1.ok && oh1.ok && (oh1.body?.items?.[0]?.onHand ?? 0) >= qty) {
    return { ok:true, variant:"type", receive:r1, onhand:oh1 };
  }

  // 2) Try { action: 'receive' }
  let r2 = await post(`/objects/${MV_TYPE}`, { itemId, action:"receive", qty });
  let oh2 = await onhand(itemId);
  if (r2.ok && oh2.ok && (oh2.body?.items?.[0]?.onHand ?? 0) >= qty) {
    return { ok:true, variant:"action", receive:r2, onhand:oh2 };
  }

  // 3) As a last resort, try both keys (some handlers normalize one)
  let r3 = await post(`/objects/${MV_TYPE}`, { itemId, type:"receive", action:"receive", qty });
  let oh3 = await onhand(itemId);
  if (r3.ok && oh3.ok && (oh3.body?.items?.[0]?.onHand ?? 0) >= qty) {
    return { ok:true, variant:"both", receive:r3, onhand:oh3 };
  }

  return { ok:false, attempts:[{r1,oh1},{r2,oh2},{r3,oh3}] };
}


/* minimal api wrapper so seeders can call /objects/<type> consistently */
const api = {
  async post(path, body) {
    // seeders expect { ok, status, body }
    return await post(path, body, { "Idempotency-Key": idem() });
  },
  async get(path) {
    return await get(path);
  },
  async put(path, body) {
    return await put(path, body);
  }
};

const PARTY_TYPE="party"; // relationships doc: single Party type + PartyRole object
const ITEM_TYPE=process.env.SMOKE_ITEM_TYPE??"inventoryItem";
const MV_TYPE=process.env.SMOKE_MOVEMENT_TYPE??"inventoryMovement";

const tests = {
  "list": async ()=>Object.keys(tests),

  "smoke:ping": async ()=>{
    const r = await fetch(API+"/ping");
    const t = await r.text();
    return { test:"ping", result:r.ok?"PASS":"FAIL", status:r.status, text:t };
  },

  "smoke:parties:happy": async ()=>{
    await ensureBearer();
    // direct object create + search + update on Party
    const create = await post(`/objects/${encodeURIComponent(PARTY_TYPE)}`, { kind:"person", name:"Smoke Test User", roles:["customer"] });
    const search = await post(`/objects/${encodeURIComponent(PARTY_TYPE)}/search`, { q:"Smoke Test User" });
    let update = { ok:true, status:200, body:{} };
    if (create.ok && create.body?.id) {
      update = await put(`/objects/${encodeURIComponent(PARTY_TYPE)}/${encodeURIComponent(create.body.id)}`, { notes:"updated by smoke" });
    }
    const pass = create.ok && search.ok && update.ok;
    return { test:"parties-happy", result:pass?"PASS":"FAIL", create, search, update };
  },

  "smoke:inventory:onhand": async ()=>{
    await ensureBearer();
    const item = await post(`/objects/${ITEM_TYPE}`, { productId:"prod-smoke" });
    if (!item.ok) return { test:"inventory-onhand", result:"FAIL", item };
    const id = item.body?.id;
    const rec = await post(`/objects/${MV_TYPE}`, { itemId:id, type:"receive", qty:3 });
    const onhand = await get(`/inventory/${encodeURIComponent(id)}/onhand`);
    const pass = rec.ok && onhand.ok && Array.isArray(onhand.body?.items) && ((onhand.body.items[0]?.onHand ?? 0) >= 3);
    return { test:"inventory-onhand", result:pass?"PASS":"FAIL", item, rec, onhand };
  },

  "smoke:inventory:guards": async ()=>{
    await ensureBearer();
    const item = await post(`/objects/${ITEM_TYPE}`, { productId:"prod-smoke" });
    if (!item.ok) return { test:"inventory-guards", result:"FAIL", item };
    const id = item.body?.id;
    const rec = await post(`/objects/${MV_TYPE}`, { itemId:id, type:"receive", qty:1 });
    const resv = await post(`/objects/${MV_TYPE}`, { itemId:id, type:"reserve", qty:2 });
    const guardOk = rec.ok && (!resv.ok || resv.status >= 400);
    return { test:"inventory-guards", result:guardOk?"PASS":"FAIL", item, rec, resv };
  },

  "smoke:inventory:onhand-batch": async ()=>{
    await ensureBearer();
    const a = await post(`/objects/${ITEM_TYPE}`, { productId:"prod-a" });
    const b = await post(`/objects/${ITEM_TYPE}`, { productId:"prod-b" });
    if (!a.ok || !b.ok) return { test:"inventory-onhand-batch", result:"FAIL", a, b };
    const recA = await post(`/objects/${MV_TYPE}`, { itemId:a.body?.id, action:"receive", qty:5 });
    const recB = await post(`/objects/${MV_TYPE}`, { itemId:b.body?.id, action:"receive", qty:7 });
    const batch = await post(`/inventory/onhand:batch`, { itemIds:[a.body?.id, b.body?.id] });
    const ok = batch.ok
      && Array.isArray(batch.body?.items)
      && batch.body.items.length===2
      && (batch.body.items.find(i=>i.itemId===a.body?.id)?.onHand ?? 0) >= 5
      && (batch.body.items.find(i=>i.itemId===b.body?.id)?.onHand ?? 0) >= 7;
    return { test:"inventory-onhand-batch", result:ok?"PASS":"FAIL", a, b, recA, recB, batch };
  },

  "smoke:inventory:list-movements": async ()=>{
    await ensureBearer();
    const item = await post(`/objects/${ITEM_TYPE}`, { productId:"prod-smoke" });
    if (!item.ok) return { test:"inventory-list-movements", result:"FAIL", item };
    const id = item.body?.id;
    await post(`/objects/${MV_TYPE}`, { itemId:id, action:"receive", qty:3 });
    await post(`/objects/${MV_TYPE}`, { itemId:id, action:"reserve", qty:1 });
    await post(`/objects/${MV_TYPE}`, { itemId:id, action:"receive", qty:2 });
    await post(`/objects/${MV_TYPE}`, { itemId:id, action:"reserve", qty:1 });
    const mv = await get(`/inventory/${encodeURIComponent(id)}/movements`);
    const ok = mv.ok && Array.isArray(mv.body?.items);
    return { test:"inventory-list-movements", result:ok?"PASS":"FAIL", item, mv };
  },

  /* ===================== Sales Orders ===================== */
  "smoke:sales:happy": async ()=>{
    await ensureBearer();

    // Seed Party (person) + PartyRole(customer)
    const { partyId } = await seedParties(api);

    // Create two inventory items
    const itemA = await post(`/objects/${ITEM_TYPE}`, { productId:"prod-ITEM_A" });
    const itemB = await post(`/objects/${ITEM_TYPE}`, { productId:"prod-ITEM_B" });
    if (!itemA.ok || !itemB.ok) return { test:"sales-happy", result:"FAIL", itemA, itemB };

    const idA = itemA.body?.id;
    const idB = itemB.body?.id;

    // Ensure on-hand exists by probing movement payload styles
    const recvA = await ensureOnHand(idA, 5);
    const recvB = await ensureOnHand(idB, 3);
    if (!recvA.ok || !recvB.ok) {
      return { test:"sales-happy", result:"FAIL", reason:"onhand-not-updated", recvA, recvB };
    }

    // Create DRAFT SO with the actual item IDs
    const create = await post(`/objects/salesOrder`, {
      type: "salesOrder",
      status: "draft",
      partyId,
      customerId: partyId,
      lines: [
        { id:"L1", itemId:idA, uom:"ea", qty:2 },
        { id:"L2", itemId:idB, uom:"ea", qty:1 }
      ]
    });
    if (!create.ok) return { test: "sales-happy", result: "FAIL", create };
    const id = create.body?.id;

    // sanity: verify lines use the real item IDs; if not, force-correct
    const l1 = create.body?.lines?.find(x=>x.id==="L1")?.itemId;
    const l2 = create.body?.lines?.find(x=>x.id==="L2")?.itemId;
    if (l1 !== idA || l2 !== idB) {
      const fix = await put(`/objects/salesOrder/${encodeURIComponent(id)}`, {
        lines: [
          { id:"L1", itemId:idA, uom:"ea", qty:2 },
          { id:"L2", itemId:idB, uom:"ea", qty:1 }
        ]
      });
      if (!fix.ok) return { test:"sales-happy", result:"FAIL", reason:"lines-mismatch", create, fix, expect:{idA,idB}, actual:{l1,l2} };
    }

    const submit  = await post(`/sales/so/${encodeURIComponent(id)}:submit`, {}, { "Idempotency-Key": idem() });

    // double-check on-hand *right before* commit, for clear diagnostics
    const ohA = await onhand(idA);
    const ohB = await onhand(idB);

    const commit  = await post(`/sales/so/${encodeURIComponent(id)}:commit`, {}, { "Idempotency-Key": idem() });
    if (!submit.ok || !commit.ok) return { test: "sales-happy", result: "FAIL", submit, commit, onhand:{ohA, ohB} };

    const reserve = await post(`/sales/so/${encodeURIComponent(id)}:reserve`, { lines: [{ lineId: "L1", deltaQty: 2 }] }, { "Idempotency-Key": idem() });
    if (!reserve.ok) return { test: "sales-happy", result: "FAIL", reserve };

    const fulfill1 = await post(`/sales/so/${encodeURIComponent(id)}:fulfill`, { lines: [{ lineId: "L1", deltaQty: 1 }] }, { "Idempotency-Key": idem() });
    if (!fulfill1.ok) return { test: "sales-happy", result: "FAIL", fulfill1 };

    // premature close (non-fatal)
    await post(`/sales/so/${encodeURIComponent(id)}:close`, {}, { "Idempotency-Key": idem() });

    // fulfill remaining
    const fulfill2 = await post(`/sales/so/${encodeURIComponent(id)}:fulfill`,
      { lines: [{ lineId: "L1", deltaQty: 1 }, { lineId: "L2", deltaQty: 1 }] },
      { "Idempotency-Key": idem() }
    );
    if (!fulfill2.ok) return { test: "sales-happy", result: "FAIL", fulfill2 };

    const close = await post(`/sales/so/${encodeURIComponent(id)}:close`, {}, { "Idempotency-Key": idem() });
    const closed = close.ok && (close.body?.status === "closed");
    return {
      test: "sales-happy",
      result: closed ? "PASS" : "FAIL",
      movementVariants: { itemA: recvA.variant, itemB: recvB.variant },
      onhandBeforeCommit: { ohA, ohB },
      artifacts: { itemA, itemB, create, submit, commit, reserve, fulfill1, fulfill2, close }
    };
  },



  "smoke:sales:guards": async ()=>{
    await ensureBearer();

    const { partyId } = await seedParties(api);

    // Seed an inventory item with limited stock
    const scarceItem = await post(`/objects/${ITEM_TYPE}`, { productId:"prod-ITEM_G" });
    if (!scarceItem.ok) return { test:"sales-guards", result:"FAIL", scarceItem };
    const scarceItemId = scarceItem.body?.id;

    // Receive just a small amount so guardrails trigger
    const rec = await post(`/objects/${MV_TYPE}`, { itemId:scarceItemId, action:"receive", qty:2 });
    if (!rec.ok) return { test:"sales-guards", result:"FAIL", rec };

    const create = await post(`/objects/salesOrder`, {
      type: "salesOrder",
      status: "draft",
      partyId,
      customerId: partyId,
      lines: [{ id: "X1", itemId: scarceItemId, uom: "ea", qty: 5 }]
    });
    if (!create.ok) return { test: "sales-guards", result: "FAIL", create };
    const id = create.body?.id;

    await post(`/sales/so/${encodeURIComponent(id)}:submit`, {}, { "Idempotency-Key": idem() });

    // Reserve -> cancel should be blocked
    await post(`/sales/so/${encodeURIComponent(id)}:reserve`, { lines: [{ lineId: "X1", deltaQty: 2 }] }, { "Idempotency-Key": idem() });
    const cancelBlocked = await post(`/sales/so/${encodeURIComponent(id)}:cancel`, {}, { "Idempotency-Key": idem() });
    const cancelGuard = !cancelBlocked.ok || cancelBlocked.status >= 400;

    // Release -> cancel now ok
    const release = await post(`/sales/so/${encodeURIComponent(id)}:release`,
      { lines: [{ lineId: "X1", deltaQty: 2, reason: "test" }] },
      { "Idempotency-Key": idem() }
    );
    const cancel = await post(`/sales/so/${encodeURIComponent(id)}:cancel`, {}, { "Idempotency-Key": idem() });
    const cancelled = cancel.ok && (cancel.body?.status === "cancelled");

    // Strict commit shortage scenario (brand new SO with ridiculous qty)
    const tooBigItem = await post(`/objects/${ITEM_TYPE}`, { productId:"prod-ITEM_SCARCE" });
    const tooBigItemId = tooBigItem.body?.id;
    const scarce = await post(`/objects/salesOrder`, {
      type: "salesOrder",
      status: "draft",
      partyId,
      customerId: partyId,
      lines: [{ id: "Y1", itemId: tooBigItemId, uom: "ea", qty: 9999 }]
    });
    const scarceId = scarce.body?.id;
    await post(`/sales/so/${encodeURIComponent(scarceId)}:submit`, {}, { "Idempotency-Key": idem() });
    const strictCommit = await post(`/sales/so/${encodeURIComponent(scarceId)}:commit`, { strict: true }, { "Idempotency-Key": idem() });
    const strictGuard = !strictCommit.ok || strictCommit.status === 409;

    const pass = cancelGuard && release.ok && cancelled && (strictGuard || strictCommit.body?.message);
    return { test: "sales-guards", result: pass ? "PASS" : "FAIL", rec, cancelBlocked, release, cancel, strictCommit };
  },



  /* ===================== Purchase Orders ===================== */
  "smoke:purchasing:happy": async ()=>{
    await ensureBearer();

    // Seed Party (organization) + PartyRole(vendor)
    const { vendorId } = await seedVendor(api);
    const create = await post(`/objects/purchaseOrder`, {
      type: "purchaseOrder",
      status: "draft",
      vendorId,
      lines: [
        { id:"P1", itemId:"ITEM_A", uom:"ea", qty:3 },
        { id:"P2", itemId:"ITEM_B", uom:"ea", qty:1 }
      ]
    });
    if (!create.ok) return { test: "purchasing-happy", result: "FAIL", create };
    const id = create.body?.id;

    const submit  = await post(`/purchasing/po/${encodeURIComponent(id)}:submit`,  {}, { "Idempotency-Key": idem() });
    const approve = await post(`/purchasing/po/${encodeURIComponent(id)}:approve`, {}, { "Idempotency-Key": idem() });
    if (!submit.ok || !approve.ok) return { test: "purchasing-happy", result: "FAIL", submit, approve };

    const recv1 = await post(`/purchasing/po/${encodeURIComponent(id)}:receive`, { lines:[{ lineId:"P1", deltaQty:2 }] }, { "Idempotency-Key": idem() });
    if (!recv1.ok) return { test: "purchasing-happy", result: "FAIL", recv1 };

    const recv2 = await post(`/purchasing/po/${encodeURIComponent(id)}:receive`, { lines:[{ lineId:"P1", deltaQty:1 }, { lineId:"P2", deltaQty:1 }] }, { "Idempotency-Key": idem() });
    if (!recv2.ok) return { test: "purchasing-happy", result: "FAIL", recv2 };

    const close = await post(`/purchasing/po/${encodeURIComponent(id)}:close`, {}, { "Idempotency-Key": idem() });
    const closed = close.ok && (close.body?.status === "closed");
    return { test:"purchasing-happy", result: closed ? "PASS" : "FAIL", create, submit, approve, recv1, recv2, close };
  },

  "smoke:purchasing:guards": async ()=>{
    await ensureBearer();

    const { vendorId } = await seedVendor(api);

    const create = await post(`/objects/purchaseOrder`, {
      type: "purchaseOrder",
      status: "draft",
      vendorId,
      lines: [{ id: "G1", itemId: "ITEM_Z", uom: "ea", qty: 2 }]
    });
    if (!create.ok) return { test: "purchasing-guards", result: "FAIL", create };
    const id = create.body?.id;

    // Approve before submit (should fail)
    const approveEarly = await post(`/purchasing/po/${encodeURIComponent(id)}:approve`, {}, { "Idempotency-Key": idem() });
    const approveGuard = !approveEarly.ok || approveEarly.status >= 400;

    // Submit then approve
    await post(`/purchasing/po/${encodeURIComponent(id)}:submit`, {}, { "Idempotency-Key": idem() });
    await post(`/purchasing/po/${encodeURIComponent(id)}:approve`, {}, { "Idempotency-Key": idem() });

    // Over-receive (should 409)
    const over = await post(`/purchasing/po/${encodeURIComponent(id)}:receive`, { lines:[{ lineId:"G1", deltaQty:3 }] }, { "Idempotency-Key": idem() });
    const overGuard = !over.ok || over.status === 409;

    // Cancel in approved should fail (per your server guard/model)
    const cancel = await post(`/purchasing/po/${encodeURIComponent(id)}:cancel`, {}, { "Idempotency-Key": idem() });
    const cancelGuard = !cancel.ok || cancel.status >= 400;

    const pass = approveGuard && overGuard && cancelGuard;
    return { test: "purchasing-guards", result: pass ? "PASS" : "FAIL", approveEarly, over, cancel };
  },

  /* ===================== Routing & Delivery (Sprint C) ===================== */
  "smoke:routing:shortest": async ()=>{
    await ensureBearer();
    const g = baseGraph();
    const up = await post(`/routing/graph`, { nodes:g.nodes, edges:g.edges });
    const plan = await post(`/routing/plan`, { objective:"shortest", tasks:g.tasks, graph:{ nodes:g.nodes, edges:g.edges } });
    const distance = plan.body?.summary?.distanceKm ?? 0;
    const pass = up.ok && plan.ok && distance > 0;
    return { test:"routing-shortest", result:pass?"PASS":"FAIL", up, plan };
  },

  "smoke:routing:closure": async ()=>{
    await ensureBearer();
    const g = baseGraph();
    const CLOSED = "A-B";
    const edgesClosed = (g.edges ?? []).map(e => e.id === CLOSED ? { ...e, isClosed:true } : e);
    const up = await post(`/routing/graph`, { nodes:g.nodes, edges:edgesClosed });
    const plan = await post(`/routing/plan`, {
      objective:"shortest",
      constraints:{ closures:[CLOSED] },
      tasks:g.tasks,
      graph:{ nodes:g.nodes, edges:edgesClosed }
    });
    const distance = plan.body?.summary?.distanceKm ?? 0;
    const ok = up.ok && plan.ok && distance >= 12;
    return { name:"smoke:routing:closure", ok, status: ok?"PASS":"FAIL", summary:{ distanceKm:distance, closed:["A-B"] }, artifacts:{ up, plan } };
  },
};

const cmd=process.argv[2]??"list";
if(cmd==="list"){ console.log(Object.keys(tests)); process.exit(0); }
const fn=tests[cmd];
if(!fn){ console.error("Unknown command:",cmd); process.exit(1); }

(async()=>{
  await ensureBearer();
  const r=await fn();
  console.log(JSON.stringify(r,null,2));
  process.exit(r?.result==="PASS"?0:1);
})().catch((e)=>{ console.error(e); process.exit(1); });
