#!/usr/bin/env node
import process from "node:process";
import assert from "node:assert/strict";
import { baseGraph } from "./seed/routing.ts";

const API=(process.env.MBAPP_API_BASE??"http://localhost:3000").replace(/\/+$/,"");
const TENANT=process.env.MBAPP_TENANT_ID??"DemoTenant";
const EMAIL=process.env.MBAPP_DEV_EMAIL??"dev@example.com";

async function ensureBearer(){
  if(process.env.MBAPP_BEARER) return;
  try{
    const r=await fetch(API+"/auth/dev-login",{method:"POST",headers:{"Content-Type":"application/json","X-Tenant-Id":TENANT},body:JSON.stringify({email:EMAIL,tenantId:TENANT})});
    if(r.ok){ const j=await r.json().catch(()=>({})); if(j?.token) process.env.MBAPP_BEARER=j.token; }
  }catch{}
}
function baseHeaders(){
  const h={"accept":"application/json","Content-Type":"application/json","X-Tenant-Id":TENANT};
  const b=process.env.MBAPP_BEARER||process.env.MBAPP_API_KEY;
  if(b) h["Authorization"]=`Bearer ${b}`;
  return h;
}
async function get(p){ const r=await fetch(API+p,{headers:baseHeaders()}); const b=await r.json().catch(()=>({})); return {ok:r.ok,status:r.status,body:b};}
async function post(p,body,h={}){ const r=await fetch(API+p,{method:"POST",headers:{...baseHeaders(),...h},body:JSON.stringify(body??{})}); const j=await r.json().catch(()=>({})); return {ok:r.ok,status:r.status,body:j};}
async function put(p,body,h={}){ const r=await fetch(API+p,{method:"PUT",headers:{...baseHeaders(),...h},body:JSON.stringify(body??{})}); const j=await r.json().catch(()=>({})); return {ok:r.ok,status:r.status,body:j};}

const PARTY_TYPE=process.env.SMOKE_PARTY_TYPE??"party";
const ITEM_TYPE=process.env.SMOKE_ITEM_TYPE??"inventoryItem";
const MV_TYPE=process.env.SMOKE_MOVEMENT_TYPE??"inventoryMovement";

const tests={
  "list": async()=>Object.keys(tests),

  "smoke:ping": async()=>{
    const r=await fetch(API+"/ping");
    const t=await r.text();
    return {test:"ping",result:r.ok?"PASS":"FAIL",status:r.status,text:t};
  },

  "smoke:parties:happy": async()=>{
    await ensureBearer();
    const create=await post(`/objects/${encodeURIComponent(PARTY_TYPE)}`,{kind:"person",name:"Smoke Test User",roles:["customer"]});
    const search=await post(`/objects/${encodeURIComponent(PARTY_TYPE)}/search`,{q:"Smoke Test User"});
    let update={ok:true,status:200,body:{}};
    if(create.ok&&create.body?.id){ update=await put(`/objects/${encodeURIComponent(PARTY_TYPE)}/${encodeURIComponent(create.body.id)}`,{notes:"updated by smoke"});}
    const pass=create.ok&&search.ok&&update.ok;
    return {test:"parties-happy",result:pass?"PASS":"FAIL",create,search,update};
  },

  "smoke:inventory:onhand": async()=>{
    await ensureBearer();
    const item=await post(`/objects/${ITEM_TYPE}`,{productId:"prod-smoke"});
    if(!item.ok) return {test:"inventory-onhand",result:"FAIL",item};
    const id=item.body?.id;
    const rec=await post(`/objects/${MV_TYPE}`,{itemId:id,type:"receive",qty:3});
    const onhand=await get(`/inventory/${encodeURIComponent(id)}/onhand`);
    const pass=rec.ok&&onhand.ok&&Array.isArray(onhand.body?.items)&&((onhand.body.items[0]?.onHand??0)>=3);
    return {test:"inventory-onhand",result:pass?"PASS":"FAIL",item,rec,onhand};
  },

  "smoke:inventory:guards": async()=>{
    await ensureBearer();
    const item=await post(`/objects/${ITEM_TYPE}`,{productId:"prod-smoke"});
    if(!item.ok) return {test:"inventory-guards",result:"FAIL",item};
    const id=item.body?.id;
    const rec=await post(`/objects/${MV_TYPE}`,{itemId:id,type:"receive",qty:1});
    const resv=await post(`/objects/${MV_TYPE}`,{itemId:id,type:"reserve",qty:2});
    const guardOk=rec.ok&&(!resv.ok||resv.status>=400);
    return {test:"inventory-guards",result:guardOk?"PASS":"FAIL",item,rec,resv};
  },

  "smoke:inventory:onhand-batch": async()=>{
    await ensureBearer();
    const a=await post(`/objects/${ITEM_TYPE}`,{productId:"prod-a"});
    const b=await post(`/objects/${ITEM_TYPE}`,{productId:"prod-b"});
    if(!a.ok||!b.ok) return {test:"inventory-onhand-batch",result:"FAIL",a,b};
    const recA=await post(`/objects/${MV_TYPE}`,{itemId:a.body?.id,action:"receive",qty:5});
    const recB=await post(`/objects/${MV_TYPE}`,{itemId:b.body?.id,action:"receive",qty:7});
    // CHANGED: send { itemIds: [...] } per OpenAPI JSON
    const batch=await post(`/inventory/onhand:batch`,{itemIds:[a.body?.id,b.body?.id]});
    const ok=batch.ok
   && Array.isArray(batch.body?.items)
   && batch.body.items.length===2
   && (batch.body.items.find(i=>i.itemId===a.body?.id)?.onHand ?? 0) >= 5
   && (batch.body.items.find(i=>i.itemId===b.body?.id)?.onHand ?? 0) >= 7;
    return {test:"inventory-onhand-batch",result:ok?"PASS":"FAIL",a,b,recA,recB,batch};
  },

  "smoke:inventory:list-movements": async()=>{
    await ensureBearer();
    const item=await post(`/objects/${ITEM_TYPE}`,{productId:"prod-smoke"});
    if(!item.ok) return {test:"inventory-list-movements",result:"FAIL",item};
    const id=item.body?.id;
    await post(`/objects/${MV_TYPE}`,{itemId:id,action:"receive",qty:3});
    await post(`/objects/${MV_TYPE}`,{itemId:id,action:"reserve",qty:1});
    await post(`/objects/${MV_TYPE}`,{itemId:id,action:"receive",qty:2});
    await post(`/objects/${MV_TYPE}`,{itemId:id,action:"reserve",qty:1});
    const mv=await get(`/inventory/${encodeURIComponent(id)}/movements`);
    const ok=mv.ok&&Array.isArray(mv.body?.items);
    return {test:"inventory-list-movements",result:ok?"PASS":"FAIL",item,mv};
  },
  /* ===================== Routing & Delivery (Sprint C) ===================== */
  "smoke:routing:shortest": async()=>{
    await ensureBearer();
    // Use your seed; assume it returns { nodes, edges, tasks }
    const g = baseGraph();
    // Graph endpoint currently validates; plan endpoint requires inline graph (MVP)
    const up = await post(`/routing/graph`, { nodes: g.nodes, edges: g.edges });
    const plan = await post(`/routing/plan`, {
      objective: "shortest",
      tasks: g.tasks,
      graph: { nodes: g.nodes, edges: g.edges }
    });
    const distance = plan.body?.summary?.distanceKm ?? 0;
    const pass = up.ok && plan.ok && distance > 0;
    return { test:"routing-shortest", result: pass?"PASS":"FAIL", up, plan };
  },

  "smoke:routing:closure": async()=>{
    await ensureBearer();
    const g = baseGraph();
    // Mark an edge closed in the request graph (don’t require seed to accept params)
    const CLOSED = "A-B";
    const edgesClosed = (g.edges ?? []).map(e => e.id === CLOSED ? { ...e, isClosed: true } : e);
    const up = await post(`/routing/graph`, { nodes: g.nodes, edges: edgesClosed });
    const plan = await post(`/routing/plan`, {
      objective: "shortest",
      constraints: { closures: [CLOSED] },
      tasks: g.tasks,
      graph: { nodes: g.nodes, edges: edgesClosed }
    });
    const distance = plan.body?.summary?.distanceKm ?? 0;
    // Baseline: A-B-C-D (12) is blocked; expect ≥12 as it reroutes
    const ok = up.ok && plan.ok && distance >= 12;
    return {
      name: "smoke:routing:closure",
      ok,
      status: ok ? "PASS" : "FAIL",
      summary: { distanceKm: distance, closed: ["A-B"] },
      artifacts: { up, plan }
    };
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
