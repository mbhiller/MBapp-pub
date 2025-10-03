import type { APIGatewayProxyEventV2 } from "aws-lambda";
import * as ObjGet from "../objects/get";
import * as ObjUpdate from "../objects/update";
const json=(c:number,b:unknown)=>({statusCode:c,headers:{"content-type":"application/json"},body:JSON.stringify(b)});
const withTypeId=(e:any,t:string,id:string,b?:any)=>({ ...e, queryStringParameters:{...(e.queryStringParameters||{}),type:t}, pathParameters:{...(e.pathParameters||{}),type:t,id}, body:b!==undefined?JSON.stringify(b):e.body });

export async function handle(event: APIGatewayProxyEventV2){
  const id=event.pathParameters?.id||""; if(!id) return json(400,{message:"Missing id"});
  const g=await ObjGet.handle(withTypeId(event,"registration",id)); if(g.statusCode!==200||!g.body) return g;
  const reg=JSON.parse(g.body);
  if (!["pending","confirmed","checked_out"].includes(String(reg.status))) return json(409,{message:`Cannot check-in from ${reg.status}`});
  reg.status="checked_in";
  reg.checkedInAt=new Date().toISOString();
  return ObjUpdate.handle(withTypeId(event,"registration",id,reg));
}
