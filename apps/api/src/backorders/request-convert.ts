// apps/api/src/backorders/request-convert.ts
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, tableObjects } from "../common/ddb";
const PK = process.env.MBAPP_TABLE_PK || "pk";
const SK = process.env.MBAPP_TABLE_SK || "sk";
const json = (s:number,b:unknown):APIGatewayProxyResultV2=>({statusCode:s,headers:{"content-type":"application/json"},body:JSON.stringify(b)});

export async function handle(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const tenantId = (event as any)?.requestContext?.authorizer?.mbapp?.tenantId as string;
  const id = event.pathParameters?.id as string;
  const now = new Date().toISOString();
  const res = await ddb.send(new UpdateCommand({
    TableName: tableObjects,
    Key: { [PK]: tenantId, [SK]: `backorderRequest#${id}` },
    UpdateExpression: "SET #s = :s, updatedAt = :u",
    ExpressionAttributeNames: { "#s": "status" },
    ExpressionAttributeValues: { ":s": "converted", ":u": now },
    ReturnValues: "ALL_NEW",
  }));
  return json(200, res.Attributes);
}
