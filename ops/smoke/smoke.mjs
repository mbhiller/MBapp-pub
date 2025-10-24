#!/usr/bin/env node
import process from "node:process";
import assert from "node:assert/strict";
import { baseGraph } from "./seed/routing.ts";
import { seedParties, seedVendor } from "./seed/parties.ts";

const API=(process.env.MBAPP_API_BASE??"http://localhost:3000").replace(/\/+$/,"");
const TENANT=process.env.MBAPP_TENANT_ID??"DemoTenant";
const EMAIL=process.env.MBAPP_DEV_EMAIL??"dev@example.com";

/* ---------- Auth & HTTP ---------- */
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
function qs(params){
  if (!params) return "";
  const u = new URLSearchParams();
  for (const [k,v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    u.set(k, String(v));
  }
  const s = u.toString();
  return s ? `?${s}` : "";
}
function idem() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}
async function get(p, params){
  const r=await fetch(API + p + qs(params), {headers:baseHeaders()});
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

/* ---------- Helpers ---------- */
async function onhand(itemId){
  return await get(`/inventory/${encodeURIComponent(itemId)}/onhand`);
}
async function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }
async function waitForStatus(type, id, wanted, { tries=10, delayMs=120 } = {}) {
  for (let i=0;i<tries;i++){
    const po = await get(`/objects/${encodeURIComponent(type)}/${encodeURIComponent(id)}`);
    const s = po?.body?.status;
    if (wanted.includes(s)) return { ok:true, po };
    await sleep(delayMs);
  }
  const last = await get(`/objects/${encodeURIComponent(type)}/${encodeURIComponent(id)}`);
  return { ok:false, lastStatus:last?.body?.status, po:last };
}

/** Try multiple movement payload shapes until on-hand increases. */
const MV_TYPE=process.env.SMOKE_MOVEMENT_TYPE??"inventoryMovement";
async function ensureOnHand(itemId, qty){
  // 1) { type: 'receive' }
  let r1 = await post(`/objects/${MV_TYPE}`, { itemId, type:"receive", qty });
  let oh1 = await onhand(itemId);
  if (r1.ok && oh1.ok && (oh1.body?.items?.[0]?.onHand ?? 0) >= qty) {
    return { ok:true, variant:"type", receive:r1, onhand:oh1 };
  }
  // 2) { action: 'receive' }
  let r2 = await post(`/objects/${MV_TYPE}`, { itemId, action:"receive", qty });
  let oh2 = await onhand(itemId);
  if (r2.ok && oh2.ok && (oh2.body?.items?.[0]?.onHand ?? 0) >= qty) {
    return { ok:true, variant:"action", receive:r2, onhand:oh2 };
  }
  // 3) both keys
  let r3 = await post(`/objects/${MV_TYPE}`, { itemId, type:"receive", action:"receive", qty });
  let oh3 = await onhand(itemId);
  if (r3.ok && oh3.ok && (oh3.body?.items?.[0]?.onHand ?? 0) >= qty) {
    return { ok:true, variant:"both", receive:r3, onhand:oh3 };
  }
  return { ok:false, attempts:[{r1,oh1},{r2,oh2},{r3,oh3}] };
}

/** objects helpers */
const ITEM_TYPE=process.env.SMOKE_ITEM_TYPE??"inventory"; // safer default matches your endpoints
async function createProduct(body) {
  return await post(`/objects/product`, { type:"product", kind:"good", name:`${body?.name ?? "Prod"}-${Date.now()}`, sku:`SKU-${Math.random().toString(36).slice(2,7)}`, ...body });
}
async function createInventoryForProduct(productId, name = "Item") {
  return await post(`/objects/inventory`, { type:"inventory", name:`${name}-${Date.now()}`, productId, uom:"ea" });
}
/* minimal api wrapper so seeders can call /objects/<type> consistently */
const api = {
  async post(path, body) { return await post(path, body, { "Idempotency-Key": idem() }); },
  async get(path, params) { return await get(path, params); },
  async put(path, body) { return await put(path, body); }
};

const PARTY_TYPE="party";

/* ---------- Tests ---------- */
const tests = {
  "list": async ()=>Object.keys(tests),

  "smoke:ping": async ()=>{
    const r = await fetch(API+"/ping");
    const t = await r.text();
    return { test:"ping", result:r.ok?"PASS":"FAIL", status:r.status, text:t };
  },

  "smoke:parties:happy": async ()=>{
    await ensureBearer();
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
    const onhandR = await get(`/inventory/${encodeURIComponent(id)}/onhand`);
    const pass = rec.ok && onhandR.ok && Array.isArray(onhandR.body?.items) && ((onhandR.body.items[0]?.onHand ?? 0) >= 3);
    return { test:"inventory-onhand", result:pass?"PASS":"FAIL", item, rec, onhand:onhandR };
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

    const { partyId } = await seedParties(api);

    const itemA = await post(`/objects/${ITEM_TYPE}`, { productId:"prod-ITEM_A" });
    const itemB = await post(`/objects/${ITEM_TYPE}`, { productId:"prod-ITEM_B" });
    if (!itemA.ok || !itemB.ok) return { test:"sales-happy", result:"FAIL", itemA, itemB };

    const idA = itemA.body?.id;
    const idB = itemB.body?.id;

    const recvA = await ensureOnHand(idA, 5);
    const recvB = await ensureOnHand(idB, 3);
    if (!recvA.ok || !recvB.ok) {
      return { test:"sales-happy", result:"FAIL", reason:"onhand-not-updated", recvA, recvB };
    }

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

    const ohA = await onhand(idA);
    const ohB = await onhand(idB);

    const commit  = await post(`/sales/so/${encodeURIComponent(id)}:commit`, {}, { "Idempotency-Key": idem() });
    if (!submit.ok || !commit.ok) return { test: "sales-happy", result: "FAIL", submit, commit, onhand:{ohA, ohB} };

    const reserve = await post(`/sales/so/${encodeURIComponent(id)}:reserve`, { lines: [{ lineId: "L1", deltaQty: 2 }] }, { "Idempotency-Key": idem() });
    if (!reserve.ok) return { test: "sales-happy", result: "FAIL", reserve };

    const fulfill1 = await post(`/sales/so/${encodeURIComponent(id)}:fulfill`, { lines: [{ lineId: "L1", deltaQty: 1 }] }, { "Idempotency-Key": idem() });
    if (!fulfill1.ok) return { test: "sales-happy", result: "FAIL", fulfill1 };

    await post(`/sales/so/${encodeURIComponent(id)}:close`, {}, { "Idempotency-Key": idem() });

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

    const scarceItem = await post(`/objects/${ITEM_TYPE}`, { productId:"prod-ITEM_G" });
    if (!scarceItem.ok) return { test:"sales-guards", result:"FAIL", scarceItem };
    const scarceItemId = scarceItem.body?.id;

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

    await post(`/sales/so/${encodeURIComponent(id)}:reserve`, { lines: [{ lineId: "X1", deltaQty: 2 }] }, { "Idempotency-Key": idem() });
    const cancelBlocked = await post(`/sales/so/${encodeURIComponent(id)}:cancel`, {}, { "Idempotency-Key": idem() });
    const cancelGuard = !cancelBlocked.ok || cancelBlocked.status >= 400;

    const release = await post(`/sales/so/${encodeURIComponent(id)}:release`,
      { lines: [{ lineId: "X1", deltaQty: 2, reason: "test" }] },
      { "Idempotency-Key": idem() }
    );
    const cancel = await post(`/sales/so/${encodeURIComponent(id)}:cancel`, {}, { "Idempotency-Key": idem() });
    const cancelled = cancel.ok && (cancel.body?.status === "cancelled");

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

    const approved = await waitForStatus("purchaseOrder", id, ["approved"]);
    if (!approved.ok) return { test:"purchasing-happy", result:"FAIL", reason:"not-approved-yet", approved };

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

    const approveEarly = await post(`/purchasing/po/${encodeURIComponent(id)}:approve`, {}, { "Idempotency-Key": idem() });
    const approveGuard = !approveEarly.ok || approveEarly.status >= 400;

    const submit  = await post(`/purchasing/po/${encodeURIComponent(id)}:submit`, {}, { "Idempotency-Key": idem() });
    const approve = await post(`/purchasing/po/${encodeURIComponent(id)}:approve`, {}, { "Idempotency-Key": idem() });

    const approved = await waitForStatus("purchaseOrder", id, ["approved"]);
    if (!approved.ok) return { test:"purchasing-guards", result:"FAIL", reason:"not-approved-yet", approved };

    const over = await post(`/purchasing/po/${encodeURIComponent(id)}:receive`, { lines:[{ lineId:"G1", deltaQty:3 }] }, { "Idempotency-Key": idem() });
    const overGuard = !over.ok || over.status === 409;

    const cancel = await post(`/purchasing/po/${encodeURIComponent(id)}:cancel`, {}, { "Idempotency-Key": idem() });
    const cancelGuard = !cancel.ok || cancel.status >= 400;

    const pass = approveGuard && overGuard && cancelGuard;
    return { test: "purchasing-guards", result: pass ? "PASS" : "FAIL", approveEarly, over, cancel };
  },

  "smoke:po:save-from-suggest": async ()=>{
    await ensureBearer();
    let draft;
    try {
      const sugg = await post(`/purchasing/suggest-po`, { requests: [{ productId: "prod-demo", qty: 1 }] }, { "Idempotency-Key": idem() });
      draft = sugg.body?.draft ?? sugg.body?.drafts?.[0];
    } catch {}
    if (!draft) {
      draft = { vendorId: "vendor_demo", status: "draft", lines: [{ itemId: "ITEM_SMOKE", qty: 1 }] };
    }
    const r = await post(`/purchasing/po:create-from-suggestion`, { draft }, { "Idempotency-Key": idem() });
    const id = r.body?.id ?? r.body?.ids?.[0];
    const got = id ? await get(`/objects/purchaseOrder/${encodeURIComponent(id)}`) : { ok:false, status:0, body:{} };
    const pass = r.ok && !!id && got.ok && got.body?.status === "draft";
    return { test:"po:save-from-suggest", result:pass?"PASS":"FAIL", create:r, get:got };
  },

  "smoke:po:quick-receive": async ()=>{
    await ensureBearer();
    const { vendorId } = await seedVendor(api);
    const create = await post(`/objects/purchaseOrder`, {
      type:"purchaseOrder", status:"draft", vendorId,
      lines:[{ id:"P1", itemId:"ITEM_QR", uom:"ea", qty:2 }]
    });
    const id = create.body?.id;
    const submit  = await post(`/purchasing/po/${encodeURIComponent(id)}:submit`, {}, { "Idempotency-Key": idem() });
    const approve = await post(`/purchasing/po/${encodeURIComponent(id)}:approve`, {}, { "Idempotency-Key": idem() });
    if(!submit.ok || !approve.ok) return { test:"po:quick-receive", result:"FAIL", submit, approve };
    const approved = await waitForStatus("purchaseOrder", id, ["approved"]);
    if (!approved.ok) return { test:"po:quick-receive", result:"FAIL", reason:"not-approved-yet", approved };
    const po = await get(`/objects/purchaseOrder/${encodeURIComponent(id)}`);
    const lines = (po.body?.lines ?? []).map((ln)=>({ lineId:String(ln.id ?? ln.lineId), deltaQty:Math.max(0,(ln.qty||0)-(ln.receivedQty||0))})).filter(l=>l.deltaQty>0);
    const rec = await post(`/purchasing/po/${encodeURIComponent(id)}:receive`, { lines }, { "Idempotency-Key": idem() });
    const pass = create.ok && rec.ok;
    return { test:"po:quick-receive", result: pass?"PASS":"FAIL", create, rec };
  },

  "smoke:po:receive-line": async ()=>{
    await ensureBearer();
    const { vendorId } = await seedVendor(api);
    const prod = await createProduct({ name:"RecvLine" });
    const inv  = await createInventoryForProduct(prod.body.id, "RecvLineItem");
    if(!inv.ok) return { test:"po-receive-line", result:"FAIL", inv };
    const create = await post(`/objects/purchaseOrder`, {
      type:"purchaseOrder", status:"draft", vendorId,
      lines:[{ id:"RL1", itemId: inv.body.id, uom:"ea", qty:3 }]
    });
    if(!create.ok) return { test:"po-receive-line", result:"FAIL", create };
    const id = create.body.id;
    await post(`/purchasing/po/${encodeURIComponent(id)}:submit`, {}, { "Idempotency-Key": idem() });
    await post(`/purchasing/po/${encodeURIComponent(id)}:approve`, {}, { "Idempotency-Key": idem() });
    const approved = await waitForStatus("purchaseOrder", id, ["approved"]);
    if (!approved.ok) return { test:"po-receive-line", result:"FAIL", reason:"not-approved-yet", approved };
    const recv = await post(`/purchasing/po/${encodeURIComponent(id)}:receive`, {
      lines:[{ lineId:"RL1", deltaQty:2, lot:"LOT-ABC", locationId:"LOC-A1" }]
    }, { "Idempotency-Key": idem() });
    const ok1 = recv.ok && (recv.body?.status === "partially_fulfilled");
    const retry = await post(`/purchasing/po/${encodeURIComponent(id)}:receive`, {
      lines:[{ lineId:"RL1", deltaQty:2, lot:"LOT-ABC", locationId:"LOC-A1" }]
    }, { "Idempotency-Key": "HARDKEY-TEST-RL1" });
    const retry2 = await post(`/purchasing/po/${encodeURIComponent(id)}:receive`, {
      lines:[{ lineId:"RL1", deltaQty:2, lot:"LOT-ABC", locationId:"LOC-A1" }]
    }, { "Idempotency-Key": "HARDKEY-TEST-RL1" });
    const idemOk = retry.ok && retry2.ok;
    return { test:"po-receive-line", result: (ok1 && idemOk) ? "PASS" : "FAIL", create, recv, retry, retry2 };
  },

  "smoke:po:receive-line-batch": async ()=>{
    await ensureBearer();
    const { vendorId } = await seedVendor(api);
    const prodA = await createProduct({ name:"RecvBatchA" });
    const prodB = await createProduct({ name:"RecvBatchB" });
    const invA  = await createInventoryForProduct(prodA.body.id, "RecvBatchItemA");
    const invB  = await createInventoryForProduct(prodB.body.id, "RecvBatchItemB");
    if(!invA.ok || !invB.ok) return { test:"po-receive-line-batch", result:"FAIL", invA, invB };
    const create = await post(`/objects/purchaseOrder`, {
      type:"purchaseOrder", status:"draft", vendorId,
      lines:[{ id:"BL1", itemId: invA.body.id, uom:"ea", qty:2 }, { id:"BL2", itemId: invB.body.id, uom:"ea", qty:4 }]
    });
    if(!create.ok) return { test:"po-receive-line-batch", result:"FAIL", create };
    const id = create.body.id;
    await post(`/purchasing/po/${encodeURIComponent(id)}:submit`, {}, { "Idempotency-Key": idem() });
    await post(`/purchasing/po/${encodeURIComponent(id)}:approve`, {}, { "Idempotency-Key": idem() });
    const approved = await waitForStatus("purchaseOrder", id, ["approved"]);
    if (!approved.ok) return { test:"po-receive-line-batch", result:"FAIL", reason:"not-approved-yet", approved };
    const recv1 = await post(`/purchasing/po/${encodeURIComponent(id)}:receive`, {
      lines:[
        { lineId:"BL1", deltaQty:2, lot:"LOT-1", locationId:"A1" },
        { lineId:"BL2", deltaQty:1, lot:"LOT-2", locationId:"B1" }
      ]
    }, { "Idempotency-Key": idem() });
    const recv2 = await post(`/purchasing/po/${encodeURIComponent(id)}:receive`, {
      lines:[{ lineId:"BL2", deltaQty:3, lot:"LOT-2", locationId:"B1" }]
    }, { "Idempotency-Key": idem() });
    const ok = recv1.ok && recv2.ok && (recv2.body?.status === "fulfilled");
    return { test:"po-receive-line-batch", result: ok ? "PASS" : "FAIL", create, recv1, recv2 };
  },

  // Same payload, different Idempotency-Key -> should be idempotent via payload signature
  "smoke:po:receive-line-idem-different-key": async () => {
    await ensureBearer();
    const { vendorId } = await seedVendor(api);

    const prod = await createProduct({ name: "RecvSamePayload" });
    const inv  = await createInventoryForProduct(prod.body.id, "RecvSamePayloadItem");
    if (!inv.ok) return { test:"po-receive-line-idem-different-key", result:"FAIL", inv };

    const create = await post(`/objects/purchaseOrder`, {
      type: "purchaseOrder", status: "draft", vendorId,
      lines: [{ id: "RL1", itemId: inv.body.id, uom: "ea", qty: 3 }]
    });
    if (!create.ok) return { test:"po-receive-line-idem-different-key", result: "FAIL", create };
    const id = create.body.id;

    await post(`/purchasing/po/${encodeURIComponent(id)}:submit`,  {}, { "Idempotency-Key": idem() });
    await post(`/purchasing/po/${encodeURIComponent(id)}:approve`, {}, { "Idempotency-Key": idem() });
    const approved = await waitForStatus("purchaseOrder", id, ["approved"]);
    if (!approved.ok) return { test:"po-receive-line-idem-different-key", result:"FAIL", reason:"not-approved-yet", approved };

    const KEY_A = `kA-${Math.random().toString(36).slice(2)}`;
    const payload = { lines: [{ lineId: "RL1", deltaQty: 2, lot: "LOT-X", locationId: "A1" }] };
    const recv1 = await post(`/purchasing/po/${encodeURIComponent(id)}:receive`, payload, { "Idempotency-Key": KEY_A });
    const ok1 = recv1.ok && (recv1.body?.status === "partially_fulfilled");

    const KEY_B = `kB-${Math.random().toString(36).slice(2)}`;
    const recv2 = await post(`/purchasing/po/${encodeURIComponent(id)}:receive`, payload, { "Idempotency-Key": KEY_B });
    const ok2 = recv2.ok && (recv2.body?.status === "partially_fulfilled");

    const finish = await post(`/purchasing/po/${encodeURIComponent(id)}:receive`, {
      lines: [{ lineId:"RL1", deltaQty: 1, lot: "LOT-X", locationId:"A1" }]
    }, { "Idempotency-Key": idem() });
    const ok3 = finish.ok && (finish.body?.status === "fulfilled");

    return {
      test: "po-receive-line-idem-different-key",
      result: (ok1 && ok2 && ok3) ? "PASS" : "FAIL",
      create, recv1, recv2, finish
    };
  },

  // === Sprint I: cursor pagination on objects list ===
  "smoke:objects:list-pagination": async () => {
    await ensureBearer();
    const first = await get(`/objects/purchaseOrder`, { limit: 2, sort: "desc" });
    if (!first.ok) return { test: "objects:list-pagination", result: "FAIL", first };
    const items1 = Array.isArray(first.body?.items) ? first.body.items : [];
    const next   = first.body?.pageInfo?.nextCursor ?? first.body?.next ?? null;
    if (!next) {
      return { test: "objects:list-pagination", result: "PASS", firstCount: items1.length, note: "single page" };
    }
    const second = await get(`/objects/purchaseOrder`, { limit: 2, next, sort: "desc" });
    if (!second.ok) return { test: "objects:list-pagination", result: "FAIL", second };
    const items2 = Array.isArray(second.body?.items) ? second.body.items : [];
    return { test: "objects:list-pagination", result: "PASS", firstCount: items1.length, secondCount: items2.length };
  },

  // === Sprint I: movements filters (refId + poLineId) — strengthened ===
  "smoke:movements:filter-by-poLine": async () => {
    await ensureBearer();
    const { vendorId } = await seedVendor(api);

    // Create product + inventory item
    const prod = await createProduct({ name: "MovFilter" });
    const inv  = await createInventoryForProduct(prod.body.id, "MovFilterItem");
    if (!inv.ok) return { test: "movements:filter-by-poLine", result: "FAIL", inv };

    // Create PO with one line, submit + approve
    const lineId = "MF1";
    const create = await post(`/objects/purchaseOrder`, {
      type: "purchaseOrder",
      status: "draft",
      vendorId,
      lines: [{ id: lineId, itemId: inv.body.id, uom: "ea", qty: 3 }],
    });
    if (!create.ok) return { test: "movements:filter-by-poLine", result: "FAIL", create };
    const poId = create.body.id;

    await post(`/purchasing/po/${encodeURIComponent(poId)}:submit`,  {}, { "Idempotency-Key": idem() });
    await post(`/purchasing/po/${encodeURIComponent(poId)}:approve`, {}, { "Idempotency-Key": idem() });

    // Receive 1 to generate a movement tied to (poId, lineId)
    const lot = "LOT-MF";
    const locationId = "LOC-MF";
    const recv = await post(`/purchasing/po/${encodeURIComponent(poId)}:receive`, {
      lines: [{ lineId, deltaQty: 1, lot, locationId }]
    }, { "Idempotency-Key": idem() });
    if (!recv.ok) return { test: "movements:filter-by-poLine", result: "FAIL", recv };

    // Fetch movements filtered by both refId + poLineId
    const list = await get(`/inventory/${encodeURIComponent(inv.body.id)}/movements?refId=${encodeURIComponent(poId)}&poLineId=${encodeURIComponent(lineId)}&limit=50&sort=desc`);
    if (!list.ok) return { test: "movements:filter-by-poLine", result: "FAIL", list };

    const rows = Array.isArray(list.body?.items) ? list.body.items : [];
    const count = rows.length;

    // Strengthened assertions:
    const okRef = count > 0 && rows.every(r => r.refId === poId);
    const okLn  = count > 0 && rows.every(r => r.poLineId === lineId);

    // Also verify the movement captured lot/location
    const hasLot = rows.some(r => r.lot === lot);
    const hasLoc = rows.some(r => r.locationId === locationId);

    const pass  = okRef && okLn && hasLot && hasLoc;
    return {
      test: "movements:filter-by-poLine",
      result: pass ? "PASS" : "FAIL",
      count,
      hasMore: Boolean(list.body?.pageInfo?.nextCursor ?? list.body?.next ?? null),
      sample: rows[0]
    };
  },

  /* ===================== Sprint II: Guardrails + Events + Pagination ===================== */
  "smoke:po:vendor-guard:on": async ()=>{
    await ensureBearer();
    const { vendorId } = await seedVendor(api);
    const { partyId: nonVendorId } = await seedParties(api); // non-vendor party

    const draft1 = await post(`/objects/purchaseOrder`, {
      type:"purchaseOrder", status:"draft", vendorId,
      lines:[{ id:"N1", itemId:"ITEM_N1", uom:"ea", qty:1 }]
    });
    if(!draft1.ok) return { test:"po:vendor-guard:on", result:"FAIL", reason:"draft1", draft1 };
    const cleared = await put(`/objects/purchaseOrder/${encodeURIComponent(draft1.body.id)}`, { vendorId: null });
    if(!cleared.ok) return { test:"po:vendor-guard:on", result:"FAIL", reason:"clearVendorId", cleared };
    const subMissing = await post(
      `/purchasing/po/${encodeURIComponent(draft1.body.id)}:submit`,
      {},
      { "Idempotency-Key": idem() }
    );
    const missingOk = subMissing.status === 400 && (subMissing.body?.code === "VENDOR_REQUIRED");

    const draft2 = await post(`/objects/purchaseOrder`, {
      type:"purchaseOrder", status:"draft", vendorId,
      lines:[{ id:"N2", itemId:"ITEM_N2", uom:"ea", qty:1 }]
    });
    if(!draft2.ok) return { test:"po:vendor-guard:on", result:"FAIL", reason:"draft2", draft2 };
    const setWrongRole = await put(`/objects/purchaseOrder/${encodeURIComponent(draft2.body.id)}`, { vendorId: nonVendorId });
    if(!setWrongRole.ok) return { test:"po:vendor-guard:on", result:"FAIL", reason:"setWrongRole", setWrongRole };
    const subWrongRole = await post(
      `/purchasing/po/${encodeURIComponent(draft2.body.id)}:submit`,
      {},
      { "Idempotency-Key": idem() }
    );
    const roleOk = subWrongRole.status === 400 && (subWrongRole.body?.code === "VENDOR_ROLE_MISSING");

    const pass = missingOk && roleOk;
    return { test:"po:vendor-guard:on", result: pass?"PASS":"FAIL", subMissing, subWrongRole };
  },

  "smoke:po:vendor-guard:off": async ()=>{
    await ensureBearer();
    const { vendorId } = await seedVendor(api);
    const HDR = { "Idempotency-Key": idem(), "X-Feature-Enforce-Vendor": "0" };
    const draft = await post(`/objects/purchaseOrder`, {
      type:"purchaseOrder", status:"draft", vendorId,
      lines:[{ id:"X1", itemId:"ITEM_X1", uom:"ea", qty:2 }]
    });
    if(!draft.ok) return { test:"po:vendor-guard:off", result:"FAIL", draft };
    const id = draft.body.id;
    const cleared = await put(`/objects/purchaseOrder/${encodeURIComponent(id)}`, { vendorId: null });
    if(!cleared.ok) return { test:"po:vendor-guard:off", result:"FAIL", reason:"clearVendorId", cleared };
    const submit  = await post(`/purchasing/po/${encodeURIComponent(id)}:submit`,  {}, HDR);
    const approve = await post(`/purchasing/po/${encodeURIComponent(id)}:approve`, {}, HDR);
    if(!submit.ok || !approve.ok) return { test:"po:vendor-guard:off", result:"FAIL", submit, approve };
    const approved = await waitForStatus("purchaseOrder", id, ["approved"]);
    if (!approved.ok) return { test:"po:vendor-guard:off", result:"FAIL", reason:"not-approved-yet", approved };
    const po = await get(`/objects/purchaseOrder/${encodeURIComponent(id)}`);
    const lines = (po.body?.lines ?? [])
      .map(ln => ({ lineId:String(ln.id ?? ln.lineId), deltaQty:Math.max(0,(ln.qty||0)-(ln.receivedQty||0)) }))
      .filter(l => l.deltaQty>0);
    const recv = await post(`/purchasing/po/${encodeURIComponent(id)}:receive`, { lines }, HDR);
    const pass = submit.ok && approve.ok && recv.ok;
    return { test:"po:vendor-guard:off", result: pass?"PASS":"FAIL", submit, approve, recv };
  },

  "smoke:po:emit-events": async ()=>{
    await ensureBearer();
    const { vendorId } = await seedVendor(api);
    const create = await post(`/objects/purchaseOrder`, {
      type:"purchaseOrder", status:"draft", vendorId,
      lines:[{ id:"E1", itemId:"ITEM_EVT", uom:"ea", qty:1 }]
    });
    if(!create.ok) return { test:"po:emit-events", result:"FAIL", create };
    const id = create.body.id;
    await post(`/purchasing/po/${encodeURIComponent(id)}:submit`,  {}, { "Idempotency-Key": idem() });
    await post(`/purchasing/po/${encodeURIComponent(id)}:approve`, {}, { "Idempotency-Key": idem() });
    const approved = await waitForStatus("purchaseOrder", id, ["approved"]);
    if (!approved.ok) return { test:"po:emit-events", result:"FAIL", reason:"not-approved-yet", approved };
    const po = await get(`/objects/purchaseOrder/${encodeURIComponent(id)}`);
    const lines = (po.body?.lines ?? [])
      .map(ln => ({ lineId:String(ln.id ?? ln.lineId), deltaQty:Math.max(0,(ln.qty||0)-(ln.receivedQty||0)) }))
      .filter(l => l.deltaQty>0);
    const recv = await post(
      `/purchasing/po/${encodeURIComponent(id)}:receive`,
      { lines },
      { "Idempotency-Key": idem(), "X-Feature-Events-Simulate":"1" }
    );
    const emitted = recv.ok && recv.body?._dev?.emitted === true;
    const pass = !!emitted;
    return { test:"po:emit-events", result: pass?"PASS":"FAIL", recv };
  },

  "smoke:objects:pageInfo-present": async ()=>{
    await ensureBearer();
    const first = await get(`/objects/purchaseOrder`, { limit:2 });
    if(!first.ok) return { test:"objects:pageInfo-present", result:"FAIL", first };
    const hasItems   = Array.isArray(first.body?.items);
    const hasPageInfo = typeof first.body?.pageInfo !== "undefined";
    const hasLegacy   = typeof first.body?.next !== "undefined";
    const pass = hasItems && (hasPageInfo || hasLegacy);
    return { test:"objects:pageInfo-present", result: pass?"PASS":"FAIL", hasItems, hasPageInfo, hasLegacy, sample:first.body?.pageInfo };
  },

  "smoke:epc:resolve": async ()=>{
    await ensureBearer();
    const r = await get(`/epc/resolve`, { epc:`EPC-NOT-FOUND-${Date.now()}` });
    const pass = r.status === 404;
    return { test:"epc-resolve", result: pass?"PASS":"FAIL", status:r.status, body:r.body };
  }
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
