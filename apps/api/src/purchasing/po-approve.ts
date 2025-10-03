import type { APIGatewayProxyEventV2 } from "aws-lambda";
import * as ObjGet from "../objects/get";
import * as ObjUpdate from "../objects/update";

const json=(c:number,b:unknown)=>({statusCode:c,headers:{"content-type":"application/json"},body:JSON.stringify(b)});
const withTypeId=(e:any,t:string,id:string,b?:any)=>({ ...e, queryStringParameters:{...(e.queryStringParameters||{}),type:t}, pathParameters:{...(e.pathParameters||{}),type:t,id}, body:b!==undefined?JSON.stringify(b):e.body });

export async function handle(event: APIGatewayProxyEventV2) {
  const id = event.pathParameters?.id || ""; if (!id) return json(400,{message:"Missing id"});
  const get = await ObjGet.handle(withTypeId(event,"purchaseOrder",id)); if (get.statusCode!==200||!get.body) return get;
  const po = JSON.parse(get.body);
  if (!["submitted","draft"].includes(String(po.status))) return json(409,{message:`Cannot approve when status is ${po.status}`});
  po.status = "approved";
  return ObjUpdate.handle(withTypeId(event,"purchaseOrder",id,po));
}
