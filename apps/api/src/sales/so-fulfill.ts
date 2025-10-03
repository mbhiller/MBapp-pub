import type { APIGatewayProxyEventV2 } from "aws-lambda";
import * as ObjGet from "../objects/get";
import * as ObjUpdate from "../objects/update";
import * as ObjCreate from "../objects/create";
import { upsertDelta } from "../inventory/counters";

const json=(c:number,b:unknown)=>({statusCode:c,headers:{ "content-type":"application/json" },body:JSON.stringify(b)});
const withTypeId=(e:any,t:string,id?:string,b?:any)=>{ const out:any={...e}; out.queryStringParameters={...(e.queryStringParameters||{}),type:t}; out.pathParameters={...(e.pathParameters||{}),type:t,...(id?{id}:{})}; if(b!==undefined) out.body=JSON.stringify(b); return out; };
const bodyOf=<T=any>(e:any):T=>{ try{ return e?.body?JSON.parse(e.body):{} as any }catch{ return {} as any } };
const header=(e:any,k:string)=>e.headers?.[k]||e.headers?.[k.toLowerCase()];
const clamp=(ordered:number,fulfilled:number,delta:number)=>Math.min(Math.max(0,delta), Math.max(0,ordered-fulfilled));

export async function handle(event: APIGatewayProxyEventV2){
  const id=event.pathParameters?.id||""; if(!id) return json(400,{message:"Missing id"});
  const idemKey = header(event,"Idempotency-Key") || bodyOf(event).idempotencyKey;

  const g=await ObjGet.handle(withTypeId(event,"salesOrder",id)); if(g.statusCode!==200||!g.body) return g;
  const so=JSON.parse(g.body);

  if (["cancelled","closed"].includes(String(so.status))) return json(409,{message:`Cannot fulfill when status is ${so.status}`});

  const applied: string[] = Array.isArray(so.metadata?.fulfillIdemKeys) ? so.metadata.fulfillIdemKeys : [];
  if (idemKey && applied.includes(idemKey)) return json(200, so);

  const req = bodyOf<{ lines: Array<{ lineId:string; deltaQty:number; locationId?:string; lot?:string }> }>(event);
  const reqLines = Array.isArray(req.lines) ? req.lines : [];
  if (!reqLines.length) return json(400,{message:"No lines to fulfill"});

  const next = { ...so, lines: Array.isArray(so.lines) ? so.lines.map((l:any)=>({...l})) : [] };
  const movements:any[] = [];
  const deltas = new Map<string,{dOnHand:number; dReserved:number}>();
  const reservedMap: Record<string, number> = { ...(so.metadata?.reservedMap || {}) };

  for (const r of reqLines) {
    const idx = next.lines.findIndex((l:any)=>String(l.id)===String(r.lineId)); if (idx===-1) continue;
    const line = next.lines[idx];
    const apply = clamp(Number(line.qty), Number(line.qtyFulfilled ?? 0), Number(r.deltaQty));
    if (apply<=0) continue;

    line.qtyFulfilled = Number(line.qtyFulfilled ?? 0) + apply;

    const itemId = String(line.itemId);
    const reservedForLine = Math.max(0, Number(reservedMap[r.lineId] ?? 0));
    const useFromReserved = Math.min(reservedForLine, apply);
    reservedMap[r.lineId] = Math.max(0, reservedForLine - useFromReserved);

    const prev = deltas.get(itemId) || { dOnHand: 0, dReserved: 0 };
    deltas.set(itemId, { dOnHand: prev.dOnHand - apply, dReserved: prev.dReserved - useFromReserved });

    movements.push({
      type:"inventoryMovement", ts:new Date().toISOString(), itemId,
      deltaQty: -apply, uom:String(line.uom||"each"),
      locationId:r.locationId, lot:r.lot,
      sourceType:"SO", sourceId:String(so.id), lineId:String(line.id), notes:"SO fulfill",
    });
  }

  const anyFulfilled = next.lines.some((l:any)=>Number(l.qtyFulfilled ?? 0) > 0);
  const allFulfilled = next.lines.length>0 && next.lines.every((l:any)=>Number(l.qtyFulfilled ?? 0) >= Number(l.qty ?? 0));
  if (allFulfilled) next.status="fulfilled"; else if (anyFulfilled) next.status="partially_fulfilled";

  if (idemKey) {
    const set = new Set([...(so.metadata?.fulfillIdemKeys ?? []), idemKey]);
    next.metadata = { ...(next.metadata || {}), fulfillIdemKeys: Array.from(set).slice(-50), reservedMap };
  } else {
    next.metadata = { ...(next.metadata || {}), reservedMap };
  }

  for (const mv of movements) await ObjCreate.handle(withTypeId(event,"inventoryMovement",undefined,mv));
  for (const [itemId, d] of deltas) await upsertDelta(event, itemId, d.dOnHand, d.dReserved);

  return ObjUpdate.handle(withTypeId(event,"salesOrder",id,next));
}
