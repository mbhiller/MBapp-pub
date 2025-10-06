// so-cancel.ts
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import * as ObjGet from "../objects/get";
import * as ObjUpdate from "../objects/update";
import { upsertDelta } from "../inventory/counters";

const json=(c:number,b:unknown)=>({statusCode:c,headers:{"content-type":"application/json"},body:JSON.stringify(b)});
const withTypeId=(e:any,t:string,id:string,b?:any)=>({ 
  ...e, 
  queryStringParameters:{...(e.queryStringParameters||{}),type:t}, 
  pathParameters:{...(e.pathParameters||{}),type:t,id}, 
  body:b!==undefined?JSON.stringify(b):e.body 
});

export async function handle(event: APIGatewayProxyEventV2){
  const id=event.pathParameters?.id||""; if(!id) return json(400,{message:"Missing id"});
  const g=await ObjGet.handle(withTypeId(event,"salesOrder",id)); if(g.statusCode!==200||!g.body) return g;
  const so=JSON.parse(g.body);
  if (["fulfilled","closed"].includes(String(so.status))) return json(409,{message:`Cannot cancel when status is ${so.status}`});

  // Release remaining reserved
  const reservedMap: Record<string, number> = { ...(so.metadata?.reservedMap || {}) };
  const byItem: Record<string, number> = {};
  for (const [lineId, qty] of Object.entries(reservedMap)) {
    if (qty > 0) {
      const line = (so.lines || []).find((l:any)=>String(l.id)===lineId);
      if (line) byItem[String(line.itemId)] = (byItem[String(line.itemId)]||0) + Number(qty);
    }
  }
  for (const [itemId, qty] of Object.entries(byItem)) {
    await upsertDelta(String(so.tenantId || ""), itemId, 0, -Number(qty));
  }

  so.status="cancelled";
  so.metadata = { ...(so.metadata || {}), reservedMap: {} };
  return ObjUpdate.handle(withTypeId(event,"salesOrder",id,so));
}
