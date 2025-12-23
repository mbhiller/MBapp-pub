#!/usr/bin/env node
import process from "node:process";
import assert from "node:assert/strict";
import { baseGraph } from "./seed/routing.ts";
import { seedParties, seedVendor } from "./seed/parties.ts";

const API=(process.env.MBAPP_API_BASE??"http://localhost:3000").replace(/\/+$/,"");
const TENANT=process.env.MBAPP_TENANT_ID??"DemoTenant";
const EMAIL=process.env.MBAPP_DEV_EMAIL??"dev@example.com";

if (!API || typeof API !== "string" || !/^https?:\/\//.test(API)) {
  console.error(`[smokes] MBAPP_API_BASE is not set or invalid. Got: "${API ?? ""}"`);
  console.error(`[smokes] Expected a full URL like https://...  Check CI secrets/env wiring or local Set-MBEnv.ps1.`);
  process.exit(2);
}
console.log(JSON.stringify({
  base: API,
  tokenVar: process.env.MBAPP_BEARER ? "MBAPP_BEARER" : (process.env.DEV_API_TOKEN ? "DEV_API_TOKEN" : null),
  hasToken: Boolean(process.env.MBAPP_BEARER || process.env.DEV_API_TOKEN)
}));

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
  const token=process.env.MBAPP_BEARER||process.env.DEV_API_TOKEN;
  if(token) h["Authorization"]=`Bearer ${token}`;
  return h;
}
// Allow per-request Authorization override: "default" | "invalid" | "none"
function buildHeaders(base = {}, auth = "default") {
  const h = { "content-type": "application/json", ...base };
  const token = process.env.MBAPP_BEARER || process.env.DEV_API_TOKEN;
  if (auth === "default") {
    if (token) h.Authorization = `Bearer ${token}`;
  } else if (auth === "invalid") {
    h.Authorization = "Bearer invalid";
  } else if (auth === "none") {
    // do not set Authorization at all
    if (h.Authorization) delete h.Authorization;
  }
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
async function get(p, params, opts){
  const headers = buildHeaders({ ...baseHeaders(), ...((opts&&opts.headers)||{}) }, (opts&&opts.auth) ?? "default");
  const r=await fetch(API + p + qs(params), {headers});
  const b=await r.json().catch(()=>({}));
  return {ok:r.ok,status:r.status,body:b};
}
async function post(p,body,h={},opts){
  const headers = buildHeaders({ ...baseHeaders(), ...h, ...((opts&&opts.headers)||{}) }, (opts&&opts.auth) ?? "default");
  const r=await fetch(API+p,{method:"POST",headers,body:JSON.stringify(body??{})});
  const j=await r.json().catch(()=>({}));
  return {ok:r.ok,status:r.status,body:j};
}
async function put(p,body,h={},opts){
  const headers = buildHeaders({ ...baseHeaders(), ...h, ...((opts&&opts.headers)||{}) }, (opts&&opts.auth) ?? "default");
  const r=await fetch(API+p,{method:"PUT",headers,body:JSON.stringify(body??{})});
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

  // === Sprint XX: filter.soId on backorderRequest list ===
  "smoke:objects:list-filter-soId": async () => {
    await ensureBearer();
    const { partyId } = await seedParties(api);

    // 1) Create a Sales Order with shortage to trigger backorder requests
    const item1 = await post(`/objects/${ITEM_TYPE}`, { productId: "prod-FILTER_TEST_A" });
    const item2 = await post(`/objects/${ITEM_TYPE}`, { productId: "prod-FILTER_TEST_B" });
    if (!item1.ok || !item2.ok) return { test: "objects:list-filter-soId", result: "FAIL", reason: "item-creation-failed", item1, item2 };

    const idA = item1.body?.id;
    const idB = item2.body?.id;

    // Ensure low on-hand to trigger backorder on reserve/commit
    const recvA = await ensureOnHand(idA, 1);
    const recvB = await ensureOnHand(idB, 1);
    if (!recvA.ok || !recvB.ok) return { test: "objects:list-filter-soId", result: "FAIL", reason: "onhand-setup-failed", recvA, recvB };

    // Create SO with lines that exceed on-hand
    const create = await post(`/objects/salesOrder`, {
      type: "salesOrder",
      status: "draft",
      partyId,
      customerId: partyId,
      lines: [
        { id: "L1", itemId: idA, uom: "ea", qty: 5 },  // 5 needed, 1 on-hand -> 4 backorder
        { id: "L2", itemId: idB, uom: "ea", qty: 3 }   // 3 needed, 1 on-hand -> 2 backorder
      ]
    });
    if (!create.ok) return { test: "objects:list-filter-soId", result: "FAIL", reason: "so-creation-failed", create };
    const soId = create.body?.id;

    // 2) Submit SO to generate backorder requests
    const submit = await post(`/sales/so/${encodeURIComponent(soId)}:submit`, {}, { "Idempotency-Key": idem() });
    if (!submit.ok) return { test: "objects:list-filter-soId", result: "FAIL", reason: "so-submit-failed", submit };

    // 3) Commit SO (which may create backorder requests if shortage exists)
    const commit = await post(`/sales/so/${encodeURIComponent(soId)}:commit`, {}, { "Idempotency-Key": idem() });
    if (!commit.ok) return { test: "objects:list-filter-soId", result: "FAIL", reason: "so-commit-failed", commit };

    // 4) Fetch ALL backorderRequest items (no filter) to validate any exist
    const allBackorders = await get(`/objects/backorderRequest`, { limit: 50 });
    if (!allBackorders.ok) return { test: "objects:list-filter-soId", result: "FAIL", reason: "all-backorders-fetch-failed", allBackorders };
    const allItems = Array.isArray(allBackorders.body?.items) ? allBackorders.body.items : [];

    if (allItems.length === 0) {
      // No backorders generated (might be okay if shortage handling is different)
      // Create manual backorder entries to test filter
      const bo1 = await post(`/objects/backorderRequest`, {
        type: "backorderRequest",
        soId,
        soLineId: "L1",
        itemId: idA,
        qty: 2,
        status: "open"
      });
      if (!bo1.ok) return { test: "objects:list-filter-soId", result: "FAIL", reason: "manual-backorder-creation-failed", bo1 };

      const bo2 = await post(`/objects/backorderRequest`, {
        type: "backorderRequest",
        soId,
        soLineId: "L2",
        itemId: idB,
        qty: 1,
        status: "open"
      });
      if (!bo2.ok) return { test: "objects:list-filter-soId", result: "FAIL", reason: "second-backorder-creation-failed", bo2 };
    }

    // 5) Test filter.soId with limit=1 (first page)
    const filtered = await get(`/objects/backorderRequest`, { "filter.soId": soId, limit: 1 });
    if (!filtered.ok) return { test: "objects:list-filter-soId", result: "FAIL", reason: "filter-request-failed", filtered };

    const filteredItems = Array.isArray(filtered.body?.items) ? filtered.body.items : [];
    if (filteredItems.length === 0) {
      return { test: "objects:list-filter-soId", result: "FAIL", reason: "filter-returned-no-items", filtered };
    }

    // 6) Verify all returned items match the soId filter
    const allMatchSoId = filteredItems.every(bo => bo.soId === soId);
    if (!allMatchSoId) {
      return { test: "objects:list-filter-soId", result: "FAIL", reason: "filter-mismatch-soId", filteredItems };
    }

    // 7) Test pagination: if next cursor exists, fetch next page and verify filter still applies
    const nextCursor = filtered.body?.pageInfo?.nextCursor ?? filtered.body?.next ?? null;
    let paginationOk = true;
    let secondPageCount = 0;

    if (nextCursor) {
      const page2 = await get(`/objects/backorderRequest`, { "filter.soId": soId, limit: 1, next: nextCursor });
      if (!page2.ok) {
        paginationOk = false;
      } else {
        const page2Items = Array.isArray(page2.body?.items) ? page2.body.items : [];
        secondPageCount = page2Items.length;
        // Verify page 2 items also match soId filter
        const page2AllMatch = page2Items.every(bo => bo.soId === soId);
        if (!page2AllMatch) {
          paginationOk = false;
        }
      }
    }

    const pass = filtered.ok && allMatchSoId && paginationOk;
    return {
      test: "objects:list-filter-soId",
      result: pass ? "PASS" : "FAIL",
      soId,
      page1Count: filteredItems.length,
      page2Count: secondPageCount,
      hasNextCursor: !!nextCursor,
      artifacts: { create, submit, commit, filtered }
    };
  },

  // === Sprint XXI: backorder status filter ===
  "smoke:objects:list-filter-status": async () => {
    await ensureBearer();
    const { partyId } = await seedParties(api);

    // 1) Create backorder requests with mixed status
    const item1 = await post(`/objects/${ITEM_TYPE}`, { productId: "prod-STATUS_TEST_A" });
    const item2 = await post(`/objects/${ITEM_TYPE}`, { productId: "prod-STATUS_TEST_B" });
    if (!item1.ok || !item2.ok) return { test: "objects:list-filter-status", result: "FAIL", reason: "item-creation-failed", item1, item2 };

    const soId = (await post(`/objects/salesOrder`, {
      type: "salesOrder",
      status: "draft",
      partyId,
      customerId: partyId,
      lines: [{ id: "L1", itemId: item1.body?.id, uom: "ea", qty: 2 }]
    })).body?.id;

    // Create backorder requests with different statuses
    const boOpen = await post(`/objects/backorderRequest`, {
      type: "backorderRequest",
      soId,
      soLineId: "L1",
      itemId: item1.body?.id,
      qty: 2,
      status: "open"
    });

    const boIgnored = await post(`/objects/backorderRequest`, {
      type: "backorderRequest",
      soId,
      soLineId: "L1",
      itemId: item2.body?.id,
      qty: 1,
      status: "ignored"
    });

    if (!boOpen.ok || !boIgnored.ok) return { test: "objects:list-filter-status", result: "FAIL", reason: "backorder-creation-failed", boOpen, boIgnored };

    // 2) Test filter.status=open
    const filteredOpen = await get(`/objects/backorderRequest`, { "filter.status": "open", limit: 50 });
    if (!filteredOpen.ok) return { test: "objects:list-filter-status", result: "FAIL", reason: "filter-open-failed", filteredOpen };

    const openItems = Array.isArray(filteredOpen.body?.items) ? filteredOpen.body.items : [];
    const allOpenMatch = openItems.every(bo => bo.status === "open");

    // 3) Test filter.status=ignored
    const filteredIgnored = await get(`/objects/backorderRequest`, { "filter.status": "ignored", limit: 50 });
    if (!filteredIgnored.ok) return { test: "objects:list-filter-status", result: "FAIL", reason: "filter-ignored-failed", filteredIgnored };

    const ignoredItems = Array.isArray(filteredIgnored.body?.items) ? filteredIgnored.body.items : [];
    const allIgnoredMatch = ignoredItems.every(bo => bo.status === "ignored");

    const pass = filteredOpen.ok && filteredIgnored.ok && allOpenMatch && allIgnoredMatch;
    return {
      test: "objects:list-filter-status",
      result: pass ? "PASS" : "FAIL",
      openCount: openItems.length,
      ignoredCount: ignoredItems.length,
      artifacts: { boOpen, boIgnored, filteredOpen, filteredIgnored }
    };
  },

  // === Sprint XXI: backorder itemId filter ===
  "smoke:objects:list-filter-itemId": async () => {
    await ensureBearer();
    const { partyId } = await seedParties(api);

    // 1) Create items and backorders
    const item1 = await post(`/objects/${ITEM_TYPE}`, { productId: "prod-ITEMID_TEST_A" });
    const item2 = await post(`/objects/${ITEM_TYPE}`, { productId: "prod-ITEMID_TEST_B" });
    if (!item1.ok || !item2.ok) return { test: "objects:list-filter-itemId", result: "FAIL", reason: "item-creation-failed", item1, item2 };

    const id1 = item1.body?.id;
    const id2 = item2.body?.id;

    // Ensure on-hand to avoid SO shortage blocking
    const recvA = await ensureOnHand(id1, 1);
    const recvB = await ensureOnHand(id2, 1);
    if (!recvA.ok || !recvB.ok) return { test: "objects:list-filter-itemId", result: "FAIL", reason: "onhand-setup-failed", recvA, recvB };

    // Create SO with 2 lines to trigger backorders
    const create = await post(`/objects/salesOrder`, {
      type: "salesOrder",
      status: "draft",
      partyId,
      customerId: partyId,
      lines: [
        { id: "L1", itemId: id1, uom: "ea", qty: 3 },
        { id: "L2", itemId: id2, uom: "ea", qty: 2 }
      ]
    });
    if (!create.ok) return { test: "objects:list-filter-itemId", result: "FAIL", reason: "so-creation-failed", create };

    const soId = create.body?.id;
    const submit = await post(`/sales/so/${encodeURIComponent(soId)}:submit`, {}, { "Idempotency-Key": idem() });
    const commit = await post(`/sales/so/${encodeURIComponent(soId)}:commit`, {}, { "Idempotency-Key": idem() });
    if (!submit.ok || !commit.ok) return { test: "objects:list-filter-itemId", result: "FAIL", reason: "so-workflow-failed", submit, commit };

    // Create manual backorders if needed
    const bo1 = await post(`/objects/backorderRequest`, {
      type: "backorderRequest",
      soId,
      soLineId: "L1",
      itemId: id1,
      qty: 1,
      status: "open"
    });

    const bo2 = await post(`/objects/backorderRequest`, {
      type: "backorderRequest",
      soId,
      soLineId: "L2",
      itemId: id2,
      qty: 1,
      status: "open"
    });

    if (!bo1.ok || !bo2.ok) return { test: "objects:list-filter-itemId", result: "FAIL", reason: "backorder-creation-failed", bo1, bo2 };

    // 2) Test filter.itemId={id1} with filter.status=open
    const filtered = await get(`/objects/backorderRequest`, { "filter.itemId": id1, "filter.status": "open", limit: 50 });
    if (!filtered.ok) return { test: "objects:list-filter-itemId", result: "FAIL", reason: "filter-request-failed", filtered };

    const filteredItems = Array.isArray(filtered.body?.items) ? filtered.body.items : [];
    if (filteredItems.length === 0) {
      return { test: "objects:list-filter-itemId", result: "FAIL", reason: "filter-returned-no-items", filtered };
    }

    // Verify all match both itemId and status
    const allMatch = filteredItems.every(bo => bo.itemId === id1 && bo.status === "open");

    const pass = filtered.ok && allMatch;
    return {
      test: "objects:list-filter-itemId",
      result: pass ? "PASS" : "FAIL",
      itemId: id1,
      matchCount: filteredItems.length,
      artifacts: { create, submit, commit, bo1, bo2, filtered }
    };
  },

  // === Sprint XXI: backorder soId + itemId combo filter ===
  "smoke:objects:list-filter-soId-itemId": async () => {
    await ensureBearer();
    const { partyId } = await seedParties(api);

    // 1) Create SO with 2 lines and trigger backorders
    const item1 = await post(`/objects/${ITEM_TYPE}`, { productId: "prod-COMBO_TEST_A" });
    const item2 = await post(`/objects/${ITEM_TYPE}`, { productId: "prod-COMBO_TEST_B" });
    if (!item1.ok || !item2.ok) return { test: "objects:list-filter-soId-itemId", result: "FAIL", reason: "item-creation-failed", item1, item2 };

    const id1 = item1.body?.id;
    const id2 = item2.body?.id;

    // Ensure on-hand
    const recvA = await ensureOnHand(id1, 1);
    const recvB = await ensureOnHand(id2, 1);
    if (!recvA.ok || !recvB.ok) return { test: "objects:list-filter-soId-itemId", result: "FAIL", reason: "onhand-setup-failed", recvA, recvB };

    // Create SO
    const create = await post(`/objects/salesOrder`, {
      type: "salesOrder",
      status: "draft",
      partyId,
      customerId: partyId,
      lines: [
        { id: "L1", itemId: id1, uom: "ea", qty: 4 },
        { id: "L2", itemId: id2, uom: "ea", qty: 3 }
      ]
    });
    if (!create.ok) return { test: "objects:list-filter-soId-itemId", result: "FAIL", reason: "so-creation-failed", create };

    const soId = create.body?.id;
    const submit = await post(`/sales/so/${encodeURIComponent(soId)}:submit`, {}, { "Idempotency-Key": idem() });
    const commit = await post(`/sales/so/${encodeURIComponent(soId)}:commit`, {}, { "Idempotency-Key": idem() });
    if (!submit.ok || !commit.ok) return { test: "objects:list-filter-soId-itemId", result: "FAIL", reason: "so-workflow-failed", submit, commit };

    // Create backorder requests
    const bo1 = await post(`/objects/backorderRequest`, {
      type: "backorderRequest",
      soId,
      soLineId: "L1",
      itemId: id1,
      qty: 2,
      status: "open"
    });

    const bo2 = await post(`/objects/backorderRequest`, {
      type: "backorderRequest",
      soId,
      soLineId: "L2",
      itemId: id2,
      qty: 1,
      status: "open"
    });

    if (!bo1.ok || !bo2.ok) return { test: "objects:list-filter-soId-itemId", result: "FAIL", reason: "backorder-creation-failed", bo1, bo2 };

    // 2) Test filter.soId={soId}&filter.itemId={id1}&filter.status=open
    const filtered = await get(`/objects/backorderRequest`, { "filter.soId": soId, "filter.itemId": id1, "filter.status": "open", limit: 1 });
    if (!filtered.ok) return { test: "objects:list-filter-soId-itemId", result: "FAIL", reason: "filter-request-failed", filtered };

    const filteredItems = Array.isArray(filtered.body?.items) ? filtered.body.items : [];
    if (filteredItems.length === 0) {
      return { test: "objects:list-filter-soId-itemId", result: "FAIL", reason: "filter-returned-no-items", filtered };
    }

    // Verify all match soId AND itemId AND status (AND logic)
    const allMatchFirst = filteredItems.every(bo => bo.soId === soId && bo.itemId === id1 && bo.status === "open");

    // 3) Test pagination: fetch second page if cursor exists
    let paginationOk = true;
    let page2Count = 0;
    const nextCursor = filtered.body?.pageInfo?.nextCursor ?? filtered.body?.next ?? null;

    if (nextCursor) {
      const page2 = await get(`/objects/backorderRequest`, { "filter.soId": soId, "filter.itemId": id1, "filter.status": "open", limit: 1, next: nextCursor });
      if (page2.ok) {
        const page2Items = Array.isArray(page2.body?.items) ? page2.body.items : [];
        page2Count = page2Items.length;
        // Verify page 2 also satisfies filters
        const page2AllMatch = page2Items.every(bo => bo.soId === soId && bo.itemId === id1 && bo.status === "open");
        if (!page2AllMatch) paginationOk = false;
      } else {
        paginationOk = false;
      }
    }

    const pass = filtered.ok && allMatchFirst && paginationOk;
    return {
      test: "objects:list-filter-soId-itemId",
      result: pass ? "PASS" : "FAIL",
      soId,
      itemId: id1,
      page1Count: filteredItems.length,
      page2Count,
      hasNextCursor: !!nextCursor,
      artifacts: { create, submit, commit, bo1, bo2, filtered }
    };
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
      { "Idempotency-Key": idem(), "X-Feature-Events-Simulate": "true", "X-Feature-Events-Enabled": "true" }
    );
    const statusOk = !recv.body?.status || ["received", "fulfilled"].includes(recv.body.status);
    const emitted = recv.ok && recv.body?._dev?.emitted === true;
    const pass = !!emitted && statusOk;
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
  },

  /* ===================== Sprint III: Views, Workspaces, Events ===================== */
  
  "smoke:views:crud": async ()=>{
    await ensureBearer();
    
    // 1) CREATE view
    const create = await post(`/views`, {
      name: "Approved POs",
      entityType: "purchaseOrder",
      filters: [{ field: "status", op: "eq", value: "approved" }],
      columns: ["id", "vendorId", "total"]
    });
    if (!create.ok || !create.body?.id) {
      return { test:"views:crud", result:"FAIL", reason:"create-failed", create };
    }
    const viewId = create.body.id;

    // 2) LIST views -> assert created view exists
    const list = await get(`/views`, { limit: 50 });
    if (!list.ok || !Array.isArray(list.body?.items)) {
      return { test:"views:crud", result:"FAIL", reason:"list-failed", list };
    }
    const found = list.body.items.find(v => v.id === viewId);
    if (!found) {
      return { test:"views:crud", result:"FAIL", reason:"view-not-in-list", list };
    }

    // 3) GET single view
    const get1 = await get(`/views/${encodeURIComponent(viewId)}`);
    if (!get1.ok || get1.body?.id !== viewId) {
      return { test:"views:crud", result:"FAIL", reason:"get-failed", get:get1 };
    }

    // 4) PUT (update) view
    const update = await put(`/views/${encodeURIComponent(viewId)}`, {
      name: "Approved POs v2",
      entityType: "purchaseOrder",
      filters: [
        { field: "status", op: "eq", value: "approved" },
        { field: "createdAt", op: "ge", value: "2025-01-01T00:00:00Z" }
      ],
      columns: ["id", "vendorId", "total", "createdAt"]
    });
    if (!update.ok || update.body?.name !== "Approved POs v2") {
      return { test:"views:crud", result:"FAIL", reason:"update-failed", update };
    }

    // 5) DELETE view
    const del = await fetch(`${API}/views/${encodeURIComponent(viewId)}`, {
      method: "DELETE",
      headers: baseHeaders()
    });
    if (!del.ok) {
      return { test:"views:crud", result:"FAIL", reason:"delete-failed", delStatus:del.status };
    }

    // 6) Verify deleted (should not be in list anymore)
    const listAfter = await get(`/views`, { limit: 50 });
    const stillThere = listAfter.ok && listAfter.body?.items?.find(v => v.id === viewId);
    if (stillThere) {
      return { test:"views:crud", result:"FAIL", reason:"view-still-in-list-after-delete" };
    }

    const pass = create.ok && list.ok && get1.ok && update.ok && del.ok && !stillThere;
    return {
      test: "views:crud",
      result: pass ? "PASS" : "FAIL",
      artifacts: { create, list, get: get1, update, delete: del, listAfter }
    };
  },

  "smoke:workspaces:list": async ()=>{
    await ensureBearer();
    
    // Sprint III: Test /workspaces filters (q, entityType)
    // Enable FEATURE_VIEWS_ENABLED via dev header for all requests
    const featureHeaders = { "X-Feature-Views-Enabled": "true" };
    const listHdr = { ...baseHeaders(), ...featureHeaders };
    
    // 1) Create two temp views with different entityTypes
    const createA = await fetch(`${API}/views`, {
      method: "POST",
      headers: listHdr,
      body: JSON.stringify({
        name: "WS Test A",
        entityType: "purchaseOrder",
        filters: [{ field: "status", op: "eq", value: "submitted" }],
        columns: ["id", "vendorId", "total"]
      })
    });
    const bodyA = await createA.json().catch(() => ({}));
    if (!createA.ok || !bodyA?.id) {
      return { test:"workspaces:list", result:"FAIL", reason:"create-view-a-failed" };
    }
    const viewIdA = bodyA.id;
    
    const createB = await fetch(`${API}/views`, {
      method: "POST",
      headers: listHdr,
      body: JSON.stringify({
        name: "WS Sample B",
        entityType: "salesOrder",
        filters: [{ field: "status", op: "eq", value: "committed" }],
        columns: ["id", "customerId", "total"]
      })
    });
    const bodyB = await createB.json().catch(() => ({}));
    if (!createB.ok || !bodyB?.id) {
      // Cleanup A before failing
      await fetch(`${API}/views/${encodeURIComponent(viewIdA)}`, {
        method: "DELETE",
        headers: listHdr
      });
      return { test:"workspaces:list", result:"FAIL", reason:"create-view-b-failed" };
    }
    const viewIdB = bodyB.id;
    
    // 2) GET /workspaces (all) - baseline
    const listAll = await fetch(`${API}/workspaces?limit=50`, { headers: listHdr });
    const allBody = await listAll.json().catch(() => ({}));
    const allItems = Array.isArray(allBody?.items) ? allBody.items : [];
    
    // 3) GET /workspaces?q=Test -> assert at least one item with "Test" in name
    const listQ = await fetch(`${API}/workspaces?q=Test&limit=50`, { headers: listHdr });
    const qBody = await listQ.json().catch(() => ({}));
    const qItems = Array.isArray(qBody?.items) ? qBody.items : [];
    const hasTest = qItems.some(item => item.name && item.name.includes("Test"));
    
    if (!hasTest) {
      // Cleanup before failing
      await fetch(`${API}/views/${encodeURIComponent(viewIdA)}`, { method: "DELETE", headers: listHdr });
      await fetch(`${API}/views/${encodeURIComponent(viewIdB)}`, { method: "DELETE", headers: listHdr });
      return { test:"workspaces:list", result:"FAIL", reason:"q-filter-no-test-items", qItems };
    }
    
    // 4) GET /workspaces?entityType=purchaseOrder -> assert all items have entityType=purchaseOrder
    const listEntity = await fetch(`${API}/workspaces?entityType=purchaseOrder&limit=50`, { headers: listHdr });
    const entityBody = await listEntity.json().catch(() => ({}));
    const entityItems = Array.isArray(entityBody?.items) ? entityBody.items : [];
    const allPO = entityItems.every(item => item.entityType === "purchaseOrder");
    
    if (!allPO) {
      // Cleanup before failing
      await fetch(`${API}/views/${encodeURIComponent(viewIdA)}`, { method: "DELETE", headers: listHdr });
      await fetch(`${API}/views/${encodeURIComponent(viewIdB)}`, { method: "DELETE", headers: listHdr });
      return { test:"workspaces:list", result:"FAIL", reason:"entityType-filter-mismatch", entityItems };
    }
    
    // 5) Cleanup: delete both temp views
    const delA = await fetch(`${API}/views/${encodeURIComponent(viewIdA)}`, {
      method: "DELETE",
      headers: listHdr
    });
    const delB = await fetch(`${API}/views/${encodeURIComponent(viewIdB)}`, {
      method: "DELETE",
      headers: listHdr
    });
    
    const pass = createA.ok && createB.ok && listAll.ok && hasTest && allPO && delA.ok && delB.ok;
    return {
      test: "workspaces:list",
      result: pass ? "PASS" : "FAIL",
      counts: {
        all: allItems.length,
        q: qItems.length,
        byEntity: entityItems.length
      }
    };
  },

  "smoke:events:enabled-noop": async ()=>{
    await ensureBearer();
    
    // Sprint III: Event dispatcher is noop by default; test flag gating
    // Enable both FEATURE_EVENT_DISPATCH_ENABLED and FEATURE_EVENT_DISPATCH_SIMULATE
    const eventHeaders = {
      "X-Feature-Events-Enabled": "true",
      "X-Feature-Events-Simulate": "true"
    };
    
    // Use an endpoint that touches events: POST /purchasing/po/{id}:receive
    // (already tested in smoke:po:emit-events, so we just verify simulation signal)
    // OR test via GET /views (simpler, doesn't require PO setup)
    
    // Simple test: GET /views with simulate flag and verify response structure
    const listReq = await fetch(`${API}/views?limit=10`, {
      headers: { ...baseHeaders(), ...eventHeaders }
    });
    
    if (!listReq.ok) {
      return { test:"events:enabled-noop", result:"FAIL", reason:"views-request-failed", status:listReq.status };
    }
    
    const listBody = await listReq.json().catch(() => ({}));
    
    // The /views endpoint itself doesn't emit events, but the dispatcher integration
    // in a real scenario would. For Sprint III v1, verify the simulation flag was accepted
    // and the feature flag headers were processed without error.
    
    // Alternative: Test via PO receive (the real emitter)
    // Create minimal PO -> receive -> check for _dev.emitted signal
    const { vendorId } = await seedVendor({ post, get, put });
    
    const poDraft = await post(`/objects/purchaseOrder`, {
      type: "purchaseOrder",
      status: "draft",
      vendorId,
      lines: [{ id: "L1", itemId: "ITEM_EVT_TEST", uom: "ea", qty: 1 }]
    });
    
    if (!poDraft.ok || !poDraft.body?.id) {
      return { test:"events:enabled-noop", result:"FAIL", reason:"po-draft-failed", poDraft };
    }
    
    const poId = poDraft.body.id;
    
    // Submit & approve PO
    await post(`/purchasing/po/${encodeURIComponent(poId)}:submit`, {}, { "Idempotency-Key": idem() });
    await post(`/purchasing/po/${encodeURIComponent(poId)}:approve`, {}, { "Idempotency-Key": idem() });
    
    // Wait for approval
    const approved = await waitForStatus("purchaseOrder", poId, ["approved"]);
    if (!approved.ok) {
      return { test:"events:enabled-noop", result:"FAIL", reason:"po-not-approved", approved };
    }
    
    // Now receive with event simulation headers
    const po = await get(`/objects/purchaseOrder/${encodeURIComponent(poId)}`);
    const lines = (po.body?.lines ?? [])
      .map(ln => ({ lineId: String(ln.id ?? ln.lineId), deltaQty: Math.max(0, (ln.qty || 0) - (ln.receivedQty || 0)) }))
      .filter(l => l.deltaQty > 0);
    
    const recv = await fetch(`${API}/purchasing/po/${encodeURIComponent(poId)}:receive`, {
      method: "POST",
      headers: { ...baseHeaders(), ...eventHeaders, "Idempotency-Key": idem() },
      body: JSON.stringify({ lines })
    });
    
    const recvBody = await recv.json().catch(() => ({}));
    
    // Check for _dev.emitted signal (only present when simulate=true)
    const hasEmitSignal = recvBody?._dev?.emitted === true;
    const hasProvider = recvBody?._dev?.provider === "noop";
    
    const pass = recv.ok && hasEmitSignal && hasProvider;
    return {
      test: "events:enabled-noop",
      result: pass ? "PASS" : "FAIL",
      status: recv.status,
      hasEmitSignal,
      hasProvider,
      devMeta: recvBody?._dev || null,
      recvBody
    };
  },

  "smoke:registrations:crud": async ()=>{
    await ensureBearer();

    // Enable FEATURE_REGISTRATIONS_ENABLED via dev header
    const regHeaders = { "X-Feature-Registrations-Enabled": "true" };

    // 1) CREATE registration
    const create = await fetch(`${API}/registrations`, {
      method: "POST",
      headers: { ...baseHeaders(), ...regHeaders, "Idempotency-Key": idem() },
      body: JSON.stringify({
        eventId: `evt_${Date.now()}`,
        partyId: `party_${Math.random().toString(36).slice(2, 7)}`,
        status: "draft",
        division: "adult",
        class: "professional",
        fees: [
          { code: "entry", amount: 50.00 },
          { code: "parking", amount: 10.00, qty: 1 }
        ],
        notes: "Smoke test registration"
      })
    });
    const createBody = await create.json().catch(() => ({}));
    if (!create.ok || !createBody?.id) {
      return { test:"registrations:crud", result:"FAIL", reason:"create-failed", create:createBody };
    }
    const regId = createBody.id;

    // Validate created registration has required fields
    if (!createBody.createdAt || !createBody.updatedAt) {
      return { test:"registrations:crud", result:"FAIL", reason:"missing-timestamps", create:createBody };
    }

    // 2) GET single registration
    const get1 = await fetch(`${API}/registrations/${encodeURIComponent(regId)}`, {
      headers: { ...baseHeaders(), ...regHeaders }
    });
    const get1Body = await get1.json().catch(() => ({}));
    if (!get1.ok || get1Body?.id !== regId) {
      return { test:"registrations:crud", result:"FAIL", reason:"get-failed", get:get1Body };
    }

    // Validate fields match
    if (get1Body.eventId !== createBody.eventId || get1Body.partyId !== createBody.partyId) {
      return { test:"registrations:crud", result:"FAIL", reason:"field-mismatch", get:get1Body, create:createBody };
    }

    // 3) PUT (update) registration - change status to confirmed
    const oldUpdatedAt = createBody.updatedAt;
    const update = await fetch(`${API}/registrations/${encodeURIComponent(regId)}`, {
      method: "PUT",
      headers: { ...baseHeaders(), ...regHeaders, "Idempotency-Key": idem() },
      body: JSON.stringify({
        eventId: createBody.eventId,
        partyId: createBody.partyId,
        status: "confirmed",
        division: "adult",
        class: "professional",
        fees: [
          { code: "entry", amount: 50.00 },
          { code: "parking", amount: 10.00, qty: 1 }
        ]
      })
    });
    const updateBody = await update.json().catch(() => ({}));
    if (!update.ok || updateBody?.status !== "confirmed") {
      return { test:"registrations:crud", result:"FAIL", reason:"update-failed", update:updateBody };
    }

    // Validate updatedAt changed
    if (updateBody.updatedAt === oldUpdatedAt) {
      return { test:"registrations:crud", result:"FAIL", reason:"updatedAt-not-changed", update:updateBody };
    }

    // 4) DELETE registration
    const del = await fetch(`${API}/registrations/${encodeURIComponent(regId)}`, {
      method: "DELETE",
      headers: { ...baseHeaders(), ...regHeaders }
    });
    if (!del.ok) {
      return { test:"registrations:crud", result:"FAIL", reason:"delete-failed", delStatus:del.status };
    }

    // 5) Verify deleted (soft-delete or not in list)
    const listAfter = await fetch(`${API}/registrations?limit=50`, {
      headers: { ...baseHeaders(), ...regHeaders }
    });
    const listAfterBody = await listAfter.json().catch(() => ({}));
    const stillThere = listAfter.ok && Array.isArray(listAfterBody?.items) && listAfterBody.items.find(r => r.id === regId);
    // Note: soft-delete means record may still exist but with deleted flag, or it may be excluded from list

    const pass = create.ok && get1.ok && update.ok && del.ok && !stillThere;
    return {
      test: "registrations:crud",
      result: pass ? "PASS" : "FAIL",
      artifacts: {
        id: regId,
        create: { ok: create.ok, status: create.status },
        get: { ok: get1.ok, status: get1.status },
        update: { ok: update.ok, status: update.status, statusChanged: updateBody?.status === "confirmed" },
        delete: { ok: del.ok, status: del.status }
      }
    };
  },

  "smoke:registrations:filters": async ()=>{
    await ensureBearer();

    // Enable FEATURE_REGISTRATIONS_ENABLED via dev header
    const regHeaders = { "X-Feature-Registrations-Enabled": "true" };

    const eventId1 = `evt_${Date.now()}`;
    const eventId2 = `evt_${Date.now() + 1}`;
    const partyId1 = `PARTY_ALPHA_${Math.random().toString(36).slice(2, 7)}`;
    const partyId2 = `PARTY_BETA_${Math.random().toString(36).slice(2, 7)}`;

    // 1) Create registrations with varied eventId, partyId, status
    const reg1 = await fetch(`${API}/registrations`, {
      method: "POST",
      headers: { ...baseHeaders(), ...regHeaders, "Idempotency-Key": idem() },
      body: JSON.stringify({
        eventId: eventId1,
        partyId: partyId1,
        status: "draft"
      })
    });
    const reg1Body = await reg1.json().catch(() => ({}));
    if (!reg1.ok || !reg1Body?.id) {
      return { test:"registrations:filters", result:"FAIL", reason:"create-reg1-failed" };
    }
    const regId1 = reg1Body.id;

    const reg2 = await fetch(`${API}/registrations`, {
      method: "POST",
      headers: { ...baseHeaders(), ...regHeaders, "Idempotency-Key": idem() },
      body: JSON.stringify({
        eventId: eventId1,
        partyId: partyId2,
        status: "confirmed"
      })
    });
    const reg2Body = await reg2.json().catch(() => ({}));
    if (!reg2.ok || !reg2Body?.id) {
      // Cleanup reg1
      await fetch(`${API}/registrations/${encodeURIComponent(regId1)}`, { method: "DELETE", headers: { ...baseHeaders(), ...regHeaders } });
      return { test:"registrations:filters", result:"FAIL", reason:"create-reg2-failed" };
    }
    const regId2 = reg2Body.id;

    const reg3 = await fetch(`${API}/registrations`, {
      method: "POST",
      headers: { ...baseHeaders(), ...regHeaders, "Idempotency-Key": idem() },
      body: JSON.stringify({
        eventId: eventId2,
        partyId: partyId1,
        status: "confirmed"
      })
    });
    const reg3Body = await reg3.json().catch(() => ({}));
    if (!reg3.ok || !reg3Body?.id) {
      // Cleanup reg1 and reg2
      await fetch(`${API}/registrations/${encodeURIComponent(regId1)}`, { method: "DELETE", headers: { ...baseHeaders(), ...regHeaders } });
      await fetch(`${API}/registrations/${encodeURIComponent(regId2)}`, { method: "DELETE", headers: { ...baseHeaders(), ...regHeaders } });
      return { test:"registrations:filters", result:"FAIL", reason:"create-reg3-failed" };
    }
    const regId3 = reg3Body.id;

    // 2) Test eventId filter
    const listByEvent = await fetch(`${API}/registrations?eventId=${encodeURIComponent(eventId1)}&limit=50`, {
      headers: { ...baseHeaders(), ...regHeaders }
    });
    const listByEventBody = await listByEvent.json().catch(() => ({}));
    const byEventItems = Array.isArray(listByEventBody?.items) ? listByEventBody.items : [];
    const allMatchEvent = byEventItems.every(r => r.eventId === eventId1);
    const byEventCount = byEventItems.length;

    if (!allMatchEvent) {
      // Cleanup all
      await fetch(`${API}/registrations/${encodeURIComponent(regId1)}`, { method: "DELETE", headers: { ...baseHeaders(), ...regHeaders } });
      await fetch(`${API}/registrations/${encodeURIComponent(regId2)}`, { method: "DELETE", headers: { ...baseHeaders(), ...regHeaders } });
      await fetch(`${API}/registrations/${encodeURIComponent(regId3)}`, { method: "DELETE", headers: { ...baseHeaders(), ...regHeaders } });
      return { test:"registrations:filters", result:"FAIL", reason:"eventId-filter-mismatch", byEventItems };
    }

    // 3) Test partyId filter
    const listByParty = await fetch(`${API}/registrations?partyId=${encodeURIComponent(partyId1)}&limit=50`, {
      headers: { ...baseHeaders(), ...regHeaders }
    });
    const listByPartyBody = await listByParty.json().catch(() => ({}));
    const byPartyItems = Array.isArray(listByPartyBody?.items) ? listByPartyBody.items : [];
    const allMatchParty = byPartyItems.every(r => r.partyId === partyId1);
    const byPartyCount = byPartyItems.length;

    if (!allMatchParty) {
      // Cleanup all
      await fetch(`${API}/registrations/${encodeURIComponent(regId1)}`, { method: "DELETE", headers: { ...baseHeaders(), ...regHeaders } });
      await fetch(`${API}/registrations/${encodeURIComponent(regId2)}`, { method: "DELETE", headers: { ...baseHeaders(), ...regHeaders } });
      await fetch(`${API}/registrations/${encodeURIComponent(regId3)}`, { method: "DELETE", headers: { ...baseHeaders(), ...regHeaders } });
      return { test:"registrations:filters", result:"FAIL", reason:"partyId-filter-mismatch", byPartyItems };
    }

    // 4) Test status filter
    const listByStatus = await fetch(`${API}/registrations?status=confirmed&limit=50`, {
      headers: { ...baseHeaders(), ...regHeaders }
    });
    const listByStatusBody = await listByStatus.json().catch(() => ({}));
    const byStatusItems = Array.isArray(listByStatusBody?.items) ? listByStatusBody.items : [];
    const allMatchStatus = byStatusItems.every(r => r.status === "confirmed");
    const byStatusCount = byStatusItems.length;

    if (!allMatchStatus) {
      // Cleanup all
      await fetch(`${API}/registrations/${encodeURIComponent(regId1)}`, { method: "DELETE", headers: { ...baseHeaders(), ...regHeaders } });
      await fetch(`${API}/registrations/${encodeURIComponent(regId2)}`, { method: "DELETE", headers: { ...baseHeaders(), ...regHeaders } });
      await fetch(`${API}/registrations/${encodeURIComponent(regId3)}`, { method: "DELETE", headers: { ...baseHeaders(), ...regHeaders } });
      return { test:"registrations:filters", result:"FAIL", reason:"status-filter-mismatch", byStatusItems };
    }

    // 5) Test q (search) filter - case-insensitive substring match on id, partyId, division, class
    const listByQ = await fetch(`${API}/registrations?q=alp&limit=50`, {
      headers: { ...baseHeaders(), ...regHeaders }
    });
    const listByQBody = await listByQ.json().catch(() => ({}));
    const byQItems = Array.isArray(listByQBody?.items) ? listByQBody.items : [];
    // All returned items should contain "alp" (case-insensitive) in id, partyId, division, or class
    const allMatchQ = byQItems.every(r => {
      const searchable = [r.id, r.partyId, r.division, r.class].filter(Boolean).join(" ").toLowerCase();
      return searchable.includes("alp");
    });
    const byQCount = byQItems.length;

    if (!allMatchQ || byQCount === 0) {
      // Cleanup all
      await fetch(`${API}/registrations/${encodeURIComponent(regId1)}`, { method: "DELETE", headers: { ...baseHeaders(), ...regHeaders } });
      await fetch(`${API}/registrations/${encodeURIComponent(regId2)}`, { method: "DELETE", headers: { ...baseHeaders(), ...regHeaders } });
      await fetch(`${API}/registrations/${encodeURIComponent(regId3)}`, { method: "DELETE", headers: { ...baseHeaders(), ...regHeaders } });
      return { test:"registrations:filters", result:"FAIL", reason:"q-filter-mismatch", byQItems };
    }

    // 6) Cleanup all temp registrations
    const del1 = await fetch(`${API}/registrations/${encodeURIComponent(regId1)}`, { method: "DELETE", headers: { ...baseHeaders(), ...regHeaders } });
    const del2 = await fetch(`${API}/registrations/${encodeURIComponent(regId2)}`, { method: "DELETE", headers: { ...baseHeaders(), ...regHeaders } });
    const del3 = await fetch(`${API}/registrations/${encodeURIComponent(regId3)}`, { method: "DELETE", headers: { ...baseHeaders(), ...regHeaders } });

    const pass = reg1.ok && reg2.ok && reg3.ok && listByEvent.ok && allMatchEvent && listByParty.ok && allMatchParty && listByStatus.ok && allMatchStatus && listByQ.ok && allMatchQ && del1.ok && del2.ok && del3.ok;
    return {
      test: "registrations:filters",
      result: pass ? "PASS" : "FAIL",
      counts: {
        created: 3,
        byEvent: byEventCount,
        byParty: byPartyCount,
        byStatus: byStatusCount,
        byQ: byQCount
      }
    };
  },

  /* ===================== Reservations: CRUD Resources ===================== */
  "smoke:resources:crud": async ()=>{
    await ensureBearer();

    const resHeaders = { "X-Feature-Reservations-Enabled": "true" };
    const name = `Resource-${Date.now()}`;
    const status = "available";

    // 1) CREATE resource
    const createRes = await fetch(`${API}/objects/resource`, {
      method: "POST",
      headers: { ...baseHeaders(), ...resHeaders, "Idempotency-Key": idem() },
      body: JSON.stringify({ type: "resource", name, status })
    });
    const createBody = await createRes.json().catch(() => ({}));
    if (!createRes.ok || !createBody?.id) {
      return { test: "resources:crud", result: "FAIL", reason: "create-failed", createRes: { status: createRes.status, body: createBody } };
    }
    const resourceId = createBody.id;

    // 2) GET resource
    const getRes = await fetch(`${API}/objects/resource/${encodeURIComponent(resourceId)}`, {
      headers: { ...baseHeaders(), ...resHeaders }
    });
    const getBody = await getRes.json().catch(() => ({}));
    if (!getRes.ok || getBody?.id !== resourceId || getBody?.name !== name) {
      await fetch(`${API}/objects/resource/${encodeURIComponent(resourceId)}`, { method: "DELETE", headers: { ...baseHeaders(), ...resHeaders } });
      return { test: "resources:crud", result: "FAIL", reason: "get-failed-or-mismatch", getRes: { status: getRes.status, body: getBody } };
    }

    // 3) UPDATE resource (change name)
    const updatedName = `Resource-Updated-${Date.now()}`;
    const updateRes = await fetch(`${API}/objects/resource/${encodeURIComponent(resourceId)}`, {
      method: "PUT",
      headers: { ...baseHeaders(), ...resHeaders },
      body: JSON.stringify({ type: "resource", name: updatedName, status: "maintenance" })
    });
    const updateBody = await updateRes.json().catch(() => ({}));
    if (!updateRes.ok || updateBody?.name !== updatedName || updateBody?.status !== "maintenance") {
      await fetch(`${API}/objects/resource/${encodeURIComponent(resourceId)}`, { method: "DELETE", headers: { ...baseHeaders(), ...resHeaders } });
      return { test: "resources:crud", result: "FAIL", reason: "update-failed-or-mismatch", updateRes: { status: updateRes.status, body: updateBody } };
    }

    // 4) DELETE resource
    const deleteRes = await fetch(`${API}/objects/resource/${encodeURIComponent(resourceId)}`, {
      method: "DELETE",
      headers: { ...baseHeaders(), ...resHeaders }
    });
    if (!deleteRes.ok) {
      return { test: "resources:crud", result: "FAIL", reason: "delete-failed", deleteRes: { status: deleteRes.status } };
    }

    // 5) Verify deleted (GET should return 404 or empty)
    const verifyRes = await fetch(`${API}/objects/resource/${encodeURIComponent(resourceId)}`, {
      headers: { ...baseHeaders(), ...resHeaders }
    });
    if (verifyRes.ok) {
      return { test: "resources:crud", result: "FAIL", reason: "resource-still-exists-after-delete", verifyRes: { status: verifyRes.status } };
    }

    return {
      test: "resources:crud",
      result: "PASS",
      resourceId,
      ops: ["create", "get", "update", "delete", "verify-deleted"]
    };
  },

  /* ===================== Reservations: CRUD Reservations ===================== */
  "smoke:reservations:crud": async ()=>{
    await ensureBearer();

    const resHeaders = { "X-Feature-Reservations-Enabled": "true" };

    // 1) Create resource first
    const createResRes = await fetch(`${API}/objects/resource`, {
      method: "POST",
      headers: { ...baseHeaders(), ...resHeaders, "Idempotency-Key": idem() },
      body: JSON.stringify({ type: "resource", name: `Resource-${Date.now()}`, status: "available" })
    });
    const createResBody = await createResRes.json().catch(() => ({}));
    if (!createResRes.ok || !createResBody?.id) {
      return { test: "reservations:crud", result: "FAIL", reason: "resource-creation-failed", createResRes: { status: createResRes.status, body: createResBody } };
    }
    const resourceId = createResBody.id;

    // 2) CREATE reservation
    const now = new Date();
    const startsAt = new Date(now.getTime() + 3600000).toISOString(); // +1 hour
    const endsAt = new Date(now.getTime() + 7200000).toISOString(); // +2 hours
    const status = "pending";

    const createRes = await fetch(`${API}/objects/reservation`, {
      method: "POST",
      headers: { ...baseHeaders(), ...resHeaders, "Idempotency-Key": idem() },
      body: JSON.stringify({ type: "reservation", resourceId, startsAt, endsAt, status })
    });
    const createBody = await createRes.json().catch(() => ({}));
    if (!createRes.ok || !createBody?.id) {
      await fetch(`${API}/objects/resource/${encodeURIComponent(resourceId)}`, { method: "DELETE", headers: { ...baseHeaders(), ...resHeaders } });
      return { test: "reservations:crud", result: "FAIL", reason: "create-reservation-failed", createRes: { status: createRes.status, body: createBody } };
    }
    const reservationId = createBody.id;

    // 3) GET reservation
    const getRes = await fetch(`${API}/objects/reservation/${encodeURIComponent(reservationId)}`, {
      headers: { ...baseHeaders(), ...resHeaders }
    });
    const getBody = await getRes.json().catch(() => ({}));
    if (!getRes.ok || getBody?.id !== reservationId || getBody?.resourceId !== resourceId) {
      await fetch(`${API}/objects/reservation/${encodeURIComponent(reservationId)}`, { method: "DELETE", headers: { ...baseHeaders(), ...resHeaders } });
      await fetch(`${API}/objects/resource/${encodeURIComponent(resourceId)}`, { method: "DELETE", headers: { ...baseHeaders(), ...resHeaders } });
      return { test: "reservations:crud", result: "FAIL", reason: "get-failed-or-mismatch", getRes: { status: getRes.status, body: getBody } };
    }

    // 4) UPDATE reservation (change status to confirmed)
    const updateRes = await fetch(`${API}/objects/reservation/${encodeURIComponent(reservationId)}`, {
      method: "PUT",
      headers: { ...baseHeaders(), ...resHeaders },
      body: JSON.stringify({ type: "reservation", resourceId, startsAt, endsAt, status: "confirmed" })
    });
    const updateBody = await updateRes.json().catch(() => ({}));
    if (!updateRes.ok || updateBody?.status !== "confirmed") {
      await fetch(`${API}/objects/reservation/${encodeURIComponent(reservationId)}`, { method: "DELETE", headers: { ...baseHeaders(), ...resHeaders } });
      await fetch(`${API}/objects/resource/${encodeURIComponent(resourceId)}`, { method: "DELETE", headers: { ...baseHeaders(), ...resHeaders } });
      return { test: "reservations:crud", result: "FAIL", reason: "update-failed-or-mismatch", updateRes: { status: updateRes.status, body: updateBody } };
    }

    // 5) DELETE reservation
    const deleteRes = await fetch(`${API}/objects/reservation/${encodeURIComponent(reservationId)}`, {
      method: "DELETE",
      headers: { ...baseHeaders(), ...resHeaders }
    });
    if (!deleteRes.ok) {
      await fetch(`${API}/objects/resource/${encodeURIComponent(resourceId)}`, { method: "DELETE", headers: { ...baseHeaders(), ...resHeaders } });
      return { test: "reservations:crud", result: "FAIL", reason: "delete-failed", deleteRes: { status: deleteRes.status } };
    }

    // 6) Cleanup resource
    const cleanupRes = await fetch(`${API}/objects/resource/${encodeURIComponent(resourceId)}`, {
      method: "DELETE",
      headers: { ...baseHeaders(), ...resHeaders }
    });
    if (!cleanupRes.ok) {
      return { test: "reservations:crud", result: "FAIL", reason: "resource-cleanup-failed", cleanupRes: { status: cleanupRes.status } };
    }

    return {
      test: "reservations:crud",
      result: "PASS",
      resourceId,
      reservationId,
      ops: ["create-resource", "create-reservation", "get", "update", "delete", "cleanup"]
    };
  },

  /* ===================== Reservations: Conflict Detection ===================== */
  "smoke:reservations:conflicts": async ()=>{
    await ensureBearer();

    const resHeaders = { "X-Feature-Reservations-Enabled": "true" };

    // 1) Create resource
    const createResRes = await fetch(`${API}/objects/resource`, {
      method: "POST",
      headers: { ...baseHeaders(), ...resHeaders, "Idempotency-Key": idem() },
      body: JSON.stringify({ type: "resource", name: `Resource-${Date.now()}`, status: "available" })
    });
    const createResBody = await createResRes.json().catch(() => ({}));
    if (!createResRes.ok || !createResBody?.id) {
      return { test: "reservations:conflicts", result: "FAIL", reason: "resource-creation-failed" };
    }
    const resourceId = createResBody.id;

    // 2) Create reservation A (pending status, time window [t0, t1])
    const now = new Date();
    const t0 = new Date(now.getTime() + 3600000); // +1 hour
    const t1 = new Date(now.getTime() + 7200000); // +2 hours
    const startsAtA = t0.toISOString();
    const endsAtA = t1.toISOString();

    const createA = await fetch(`${API}/objects/reservation`, {
      method: "POST",
      headers: { ...baseHeaders(), ...resHeaders, "Idempotency-Key": idem() },
      body: JSON.stringify({ type: "reservation", resourceId, startsAt: startsAtA, endsAt: endsAtA, status: "pending" })
    });
    const createABody = await createA.json().catch(() => ({}));
    if (!createA.ok || !createABody?.id) {
      await fetch(`${API}/objects/resource/${encodeURIComponent(resourceId)}`, { method: "DELETE", headers: { ...baseHeaders(), ...resHeaders } });
      return { test: "reservations:conflicts", result: "FAIL", reason: "reservation-A-creation-failed" };
    }
    const reservationAId = createABody.id;

    // 3) Attempt to create overlapping reservation B (pending, time window [t0+30min, t1+30min])
    const t0_30 = new Date(t0.getTime() + 1800000); // t0 + 30 min
    const t1_30 = new Date(t1.getTime() + 1800000); // t1 + 30 min
    const startsAtB = t0_30.toISOString();
    const endsAtB = t1_30.toISOString();

    const createB = await fetch(`${API}/objects/reservation`, {
      method: "POST",
      headers: { ...baseHeaders(), ...resHeaders, "Idempotency-Key": idem() },
      body: JSON.stringify({ type: "reservation", resourceId, startsAt: startsAtB, endsAt: endsAtB, status: "pending" })
    });
    const createBBody = await createB.json().catch(() => ({}));

    // Should fail with 409 conflict
    if (createB.status !== 409) {
      // Cleanup
      await fetch(`${API}/objects/reservation/${encodeURIComponent(reservationAId)}`, { method: "DELETE", headers: { ...baseHeaders(), ...resHeaders } });
      await fetch(`${API}/objects/resource/${encodeURIComponent(resourceId)}`, { method: "DELETE", headers: { ...baseHeaders(), ...resHeaders } });
      return { test: "reservations:conflicts", result: "FAIL", reason: "expected-409-got-" + createB.status, createB: { status: createB.status, body: createBBody } };
    }

    // Verify conflict response format
    if (!createBBody?.code || createBBody.code !== "conflict") {
      await fetch(`${API}/objects/reservation/${encodeURIComponent(reservationAId)}`, { method: "DELETE", headers: { ...baseHeaders(), ...resHeaders } });
      await fetch(`${API}/objects/resource/${encodeURIComponent(resourceId)}`, { method: "DELETE", headers: { ...baseHeaders(), ...resHeaders } });
      return { test: "reservations:conflicts", result: "FAIL", reason: "conflict-response-missing-code", createB: { body: createBBody } };
    }

    if (!Array.isArray(createBBody?.details?.conflicts) || createBBody.details.conflicts.length === 0) {
      await fetch(`${API}/objects/reservation/${encodeURIComponent(reservationAId)}`, { method: "DELETE", headers: { ...baseHeaders(), ...resHeaders } });
      await fetch(`${API}/objects/resource/${encodeURIComponent(resourceId)}`, { method: "DELETE", headers: { ...baseHeaders(), ...resHeaders } });
      return { test: "reservations:conflicts", result: "FAIL", reason: "conflict-details-empty", createB: { body: createBBody } };
    }

    const conflictingIds = createBBody.details.conflicts.map(c => c.id);
    const hasReservationA = conflictingIds.includes(reservationAId);
    if (!hasReservationA) {
      await fetch(`${API}/objects/reservation/${encodeURIComponent(reservationAId)}`, { method: "DELETE", headers: { ...baseHeaders(), ...resHeaders } });
      await fetch(`${API}/objects/resource/${encodeURIComponent(resourceId)}`, { method: "DELETE", headers: { ...baseHeaders(), ...resHeaders } });
      return { test: "reservations:conflicts", result: "FAIL", reason: "conflicting-reservation-A-not-in-details", conflictingIds };
    }

    // 4) Call POST /reservations:check-conflicts to verify endpoint
    const checkRes = await fetch(`${API}/reservations:check-conflicts`, {
      method: "POST",
      headers: { ...baseHeaders(), ...resHeaders },
      body: JSON.stringify({ resourceId, startsAt: startsAtB, endsAt: endsAtB })
    });
    const checkBody = await checkRes.json().catch(() => ({}));

    if (!checkRes.ok) {
      await fetch(`${API}/objects/reservation/${encodeURIComponent(reservationAId)}`, { method: "DELETE", headers: { ...baseHeaders(), ...resHeaders } });
      await fetch(`${API}/objects/resource/${encodeURIComponent(resourceId)}`, { method: "DELETE", headers: { ...baseHeaders(), ...resHeaders } });
      return { test: "reservations:conflicts", result: "FAIL", reason: "check-conflicts-endpoint-failed", checkRes: { status: checkRes.status, body: checkBody } };
    }

    if (!Array.isArray(checkBody?.conflicts) || checkBody.conflicts.length === 0) {
      await fetch(`${API}/objects/reservation/${encodeURIComponent(reservationAId)}`, { method: "DELETE", headers: { ...baseHeaders(), ...resHeaders } });
      await fetch(`${API}/objects/resource/${encodeURIComponent(resourceId)}`, { method: "DELETE", headers: { ...baseHeaders(), ...resHeaders } });
      return { test: "reservations:conflicts", result: "FAIL", reason: "check-conflicts-endpoint-empty", checkBody };
    }

    const checkConflictIds = checkBody.conflicts.map(c => c.id);
    const checkHasReservationA = checkConflictIds.includes(reservationAId);
    if (!checkHasReservationA) {
      await fetch(`${API}/objects/reservation/${encodeURIComponent(reservationAId)}`, { method: "DELETE", headers: { ...baseHeaders(), ...resHeaders } });
      await fetch(`${API}/objects/resource/${encodeURIComponent(resourceId)}`, { method: "DELETE", headers: { ...baseHeaders(), ...resHeaders } });
      return { test: "reservations:conflicts", result: "FAIL", reason: "check-conflicts-missing-reservation-A", checkConflictIds };
    }

    // 5) Call GET /resources/{id}/availability to verify availability endpoint reflects created reservation
    const fromAvail = new Date(t0.getTime() - 3600000).toISOString(); // t0 - 1 hour
    const toAvail = new Date(t1.getTime() + 3600000).toISOString();   // t1 + 1 hour
    const availRes = await fetch(`${API}/resources/${encodeURIComponent(resourceId)}/availability?from=${encodeURIComponent(fromAvail)}&to=${encodeURIComponent(toAvail)}`, {
      method: "GET",
      headers: { ...baseHeaders(), ...resHeaders }
    });
    const availBody = await availRes.json().catch(() => ({}));

    if (!availRes.ok) {
      await fetch(`${API}/objects/reservation/${encodeURIComponent(reservationAId)}`, { method: "DELETE", headers: { ...baseHeaders(), ...resHeaders } });
      await fetch(`${API}/objects/resource/${encodeURIComponent(resourceId)}`, { method: "DELETE", headers: { ...baseHeaders(), ...resHeaders } });
      return { test: "reservations:conflicts", result: "FAIL", reason: "availability-endpoint-failed", availRes: { status: availRes.status, body: availBody } };
    }

    if (!Array.isArray(availBody?.busy)) {
      await fetch(`${API}/objects/reservation/${encodeURIComponent(reservationAId)}`, { method: "DELETE", headers: { ...baseHeaders(), ...resHeaders } });
      await fetch(`${API}/objects/resource/${encodeURIComponent(resourceId)}`, { method: "DELETE", headers: { ...baseHeaders(), ...resHeaders } });
      return { test: "reservations:conflicts", result: "FAIL", reason: "availability-busy-not-array", availBody };
    }

    // Check if reservationA is in busy blocks or if any block overlaps [t0, t1]
    const busyIds = availBody.busy.map(b => b.id);
    const hasReservationInBusy = busyIds.includes(reservationAId);
    const hasOverlappingBlock = availBody.busy.some(b => {
      const blockStart = new Date(b.startsAt).getTime();
      const blockEnd = new Date(b.endsAt).getTime();
      const t0ms = t0.getTime();
      const t1ms = t1.getTime();
      return blockStart < t1ms && t0ms < blockEnd; // overlap check
    });

    if (!hasReservationInBusy && !hasOverlappingBlock) {
      await fetch(`${API}/objects/reservation/${encodeURIComponent(reservationAId)}`, { method: "DELETE", headers: { ...baseHeaders(), ...resHeaders } });
      await fetch(`${API}/objects/resource/${encodeURIComponent(resourceId)}`, { method: "DELETE", headers: { ...baseHeaders(), ...resHeaders } });
      return { test: "reservations:conflicts", result: "FAIL", reason: "availability-missing-reservation-A", busyIds };
    }

    // 6) Cleanup
    const delA = await fetch(`${API}/objects/reservation/${encodeURIComponent(reservationAId)}`, {
      method: "DELETE",
      headers: { ...baseHeaders(), ...resHeaders }
    });
    const delRes = await fetch(`${API}/objects/resource/${encodeURIComponent(resourceId)}`, {
      method: "DELETE",
      headers: { ...baseHeaders(), ...resHeaders }
    });

    const pass = delA.ok && delRes.ok;
    return {
      test: "reservations:conflicts",
      result: pass ? "PASS" : "FAIL",
      resourceId,
      reservationAId,
      conflictDetected: {
        createB409: true,
        conflictingIds,
        checkEndpointConflicts: checkConflictIds
      },
      availabilityEndpoint: {
        busyBlocks: availBody.busy?.length || 0,
        hasReservationA: hasReservationInBusy,
        hasOverlap: hasOverlappingBlock
      }
    };
  },

  /* ===================== Common: Pagination ===================== */
  "smoke:common:pagination": async () => {
    await ensureBearer();

    // Seed at least 3 views to ensure we have enough data for pagination
    const view1 = await post(`/objects/view`, {
      type: "view",
      name: `Pagination-Test-1-${Date.now()}`,
      entityType: "inventoryItem",
      columns: [{ field: "id", label: "ID" }]
    });
    const view2 = await post(`/objects/view`, {
      type: "view",
      name: `Pagination-Test-2-${Date.now()}`,
      entityType: "inventoryItem",
      columns: [{ field: "name", label: "Name" }]
    });
    const view3 = await post(`/objects/view`, {
      type: "view",
      name: `Pagination-Test-3-${Date.now()}`,
      entityType: "inventoryItem",
      columns: [{ field: "status", label: "Status" }]
    });

    if (!view1.ok || !view2.ok || !view3.ok) {
      return { test: "common:pagination", result: "FAIL", reason: "view-seeding-failed", view1, view2, view3 };
    }

    // Step 1: GET /views?limit=1 -> expect items.length === 1 and next != null
    const page1 = await get(`/views`, { limit: 1 });
    if (!page1.ok) {
      return { test: "common:pagination", result: "FAIL", reason: "page1-request-failed", page1 };
    }
    const page1Items = page1.body?.items ?? [];
    const page1Next = page1.body?.next ?? null;

    if (page1Items.length !== 1) {
      return { test: "common:pagination", result: "FAIL", reason: "page1-items-length-mismatch", expected: 1, actual: page1Items.length, page1 };
    }
    if (!page1Next) {
      return { test: "common:pagination", result: "FAIL", reason: "page1-next-null", page1 };
    }

    // Step 2: GET /views?limit=1&next=<cursor> -> expect items.length === 1
    const page2 = await get(`/views`, { limit: 1, next: page1Next });
    if (!page2.ok) {
      return { test: "common:pagination", result: "FAIL", reason: "page2-request-failed", page2 };
    }
    const page2Items = page2.body?.items ?? [];
    const page2Next = page2.body?.next ?? null;

    if (page2Items.length !== 1) {
      return { test: "common:pagination", result: "FAIL", reason: "page2-items-length-mismatch", expected: 1, actual: page2Items.length, page2 };
    }

    // Step 3: Optionally fetch a third page to ensure eventual next === null (if exists)
    let page3 = null;
    let page3Items = [];
    let page3Next = null;
    if (page2Next) {
      page3 = await get(`/views`, { limit: 1, next: page2Next });
      page3Items = page3?.body?.items ?? [];
      page3Next = page3?.body?.next ?? null;
    }

    // Step 4: Verify pagination is working correctly
    // - Each page should have unique items (no duplicates)
    const allIds = [
      page1Items[0]?.id,
      page2Items[0]?.id,
      ...(page3Items.length > 0 ? [page3Items[0]?.id] : [])
    ].filter(Boolean);
    const uniqueIds = new Set(allIds);
    if (allIds.length !== uniqueIds.size) {
      return { test: "common:pagination", result: "FAIL", reason: "duplicate-items-across-pages", allIds };
    }

    return {
      test: "common:pagination",
      result: "PASS",
      pages: {
        page1: { count: page1Items.length, hasNext: !!page1Next },
        page2: { count: page2Items.length, hasNext: !!page2Next },
        page3: page3 ? { count: page3Items.length, hasNext: !!page3Next } : null
      },
      totalFetched: allIds.length
    };
  },

  /* ===================== Common: Error Shapes ===================== */
  "smoke:common:error-shapes": async () => {
    await ensureBearer();

    // Test 1: 400 Bad Request - missing required fields (ValidationError)
    const badRequest = await post(`/registrations`, {
      // Missing eventId and partyId (required fields)
      status: "draft"
    }, { "X-Feature-Registrations-Enabled": "1" });

    if (badRequest.status !== 400) {
      return { test: "common:error-shapes", result: "FAIL", reason: "expected-400-got-" + badRequest.status, badRequest };
    }
    if (!badRequest.body?.code || !badRequest.body?.message) {
      return { test: "common:error-shapes", result: "FAIL", reason: "400-missing-code-or-message", body: badRequest.body };
    }
    // Details are optional but should be present for validation errors
    const has400Shape = typeof badRequest.body.code === "string" && typeof badRequest.body.message === "string";
    if (!has400Shape) {
      return { test: "common:error-shapes", result: "FAIL", reason: "400-invalid-shape", body: badRequest.body };
    }

    // Test 2: 401 Unauthorized - GET /views without Authorization header
    const unauthorizedReq = await fetch(`${API}/views`, {
      method: "GET",
      headers: { "content-type": "application/json", "X-Tenant-Id": TENANT }
    });
    const unauthorized = await unauthorizedReq.json().catch(() => ({}));
    if (unauthorizedReq.status !== 401) {
      return { test: "common:error-shapes", result: "FAIL", reason: "expected-401-got-" + unauthorizedReq.status, unauthorized: { status: unauthorizedReq.status, body: unauthorized } };
    }
    if (!unauthorized?.code || !unauthorized?.message) {
      return { test: "common:error-shapes", result: "FAIL", reason: "401-missing-code-or-message", body: unauthorized };
    }
    const has401Shape = typeof unauthorized.code === "string" && typeof unauthorized.message === "string";
    if (!has401Shape) {
      return { test: "common:error-shapes", result: "FAIL", reason: "401-invalid-shape", body: unauthorized };
    }

    // Test 3: 403 Forbidden - feature disabled (valid auth), POST /registrations without flag
    const forbidden = await post(`/registrations`, {}, {}, { auth: "default" });
    if (forbidden.status !== 403) {
      return { test: "common:error-shapes", result: "FAIL", reason: "expected-403-got-" + forbidden.status, forbidden };
    }
    if (!forbidden.body?.code || !forbidden.body?.message) {
      return { test: "common:error-shapes", result: "FAIL", reason: "403-missing-code-or-message", body: forbidden.body };
    }

    // Test 4: 404 Not Found - nonexistent resource (feature flag ON)
    const notFound = await get(`/registrations/NON_EXISTENT_ID`, {}, { headers: { "X-Feature-Registrations-Enabled": "true" }, auth: "default" });
    if (notFound.status !== 404) {
      return { test: "common:error-shapes", result: "FAIL", reason: "expected-404-got-" + notFound.status, notFound };
    }
    if (!notFound.body?.code || !notFound.body?.message) {
      return { test: "common:error-shapes", result: "FAIL", reason: "404-missing-code-or-message", body: notFound.body };
    }
    const has404Shape = typeof notFound.body.code === "string" && typeof notFound.body.message === "string";
    if (!has404Shape) {
      return { test: "common:error-shapes", result: "FAIL", reason: "404-invalid-shape", body: notFoundBody };
    }

    return {
      test: "common:error-shapes",
      result: "PASS",
      validatedShapes: {
        "400": { hasCode: !!badRequest.body.code, hasMessage: !!badRequest.body.message, hasDetails: !!badRequest.body.details },
        "401": { hasCode: !!unauthorized.code, hasMessage: !!unauthorized.message },
        "403": { hasCode: !!forbidden.body.code, hasMessage: !!forbidden.body.message },
        "404": { hasCode: !!notFound.body.code, hasMessage: !!notFound.body.message }
      }
    };
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
