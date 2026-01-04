// apps/api/src/backorders/request-convert.ts
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, tableObjects } from "../common/ddb";
import { validateBackorderRefsOrThrow } from "./related-refs";
const PK = process.env.MBAPP_TABLE_PK || "pk";
const SK = process.env.MBAPP_TABLE_SK || "sk";
const json = (s:number,b:unknown):APIGatewayProxyResultV2=>({statusCode:s,headers:{"content-type":"application/json"},body:JSON.stringify(b)});

export async function handle(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const tenantId = (event as any)?.requestContext?.authorizer?.mbapp?.tenantId as string | undefined;
  const id = event.pathParameters?.id as string | undefined;
  const requestId = (event as any)?.requestContext?.requestId as string | undefined;
  if (!tenantId) return json(400, { message: "Missing tenant" });
  if (!id) return json(400, { message: "Missing id" });
  const now = new Date().toISOString();
  try {
    // Fetch record for validation
    const got = await ddb.send(new GetCommand({
      TableName: tableObjects,
      Key: { [PK]: tenantId, [SK]: `backorderRequest#${id}` },
    } as any));
    const existing = got?.Item || null;
    if (!existing) {
      return json(404, { message: "BackorderRequest not found" });
    }

    // Integrity guard: require related references to exist before conversion
    try {
      await validateBackorderRefsOrThrow(
        {
          tenantId,
          soId: (existing as any)?.soId,
          soLineId: (existing as any)?.soLineId,
          itemId: (existing as any)?.itemId,
        },
        { requestId, where: "backorder-convert", mode: "convert" } as any
      );
    } catch (err: any) {
      if (err?.statusCode && err?.body) {
        return json(err.statusCode, err.body);
      }
      throw err;
    }

    const res = await ddb.send(new UpdateCommand({
      TableName: tableObjects,
      Key: { [PK]: tenantId, [SK]: `backorderRequest#${id}` },
      UpdateExpression: "SET #s = :s, updatedAt = :u",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: { ":s": "converted", ":u": now },
      ConditionExpression: "attribute_exists(pk) AND attribute_exists(sk)",
      ReturnValues: "ALL_NEW",
    }));
    return json(200, res.Attributes);
  } catch (err: any) {
    if (err?.name === "ConditionalCheckFailedException") {
      return json(404, { message: "BackorderRequest not found" });
    }
    return json(400, { message: err?.message || "Unable to convert backorder" });
  }
}
