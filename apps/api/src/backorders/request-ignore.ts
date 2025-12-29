// apps/api/src/backorders/request-ignore.ts
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, tableObjects } from "../common/ddb";
import { emitDomainEvent } from "../common/logger";
const PK = process.env.MBAPP_TABLE_PK || "pk";
const SK = process.env.MBAPP_TABLE_SK || "sk";
const json = (s:number,b:unknown):APIGatewayProxyResultV2=>({statusCode:s,headers:{"content-type":"application/json"},body:JSON.stringify(b)});

export async function handle(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const tenantId = (event as any)?.requestContext?.authorizer?.mbapp?.tenantId as string;
  const userId = (event as any)?.requestContext?.authorizer?.mbapp?.userId as string | undefined;
  const requestId = (event as any)?.requestContext?.requestId as string | undefined;
  const route = (event as any)?.rawPath as string | undefined;
  const method = (event as any)?.requestContext?.http?.method as string | undefined;
  const id = event.pathParameters?.id as string;
  const now = new Date().toISOString();
  const started = Date.now();

  // Build minimal log/emit context
  const ctx = { tenantId, userId, requestId, route, method };

  // Fetch existing record to capture statusBefore and related IDs
  let existing: any = null;
  try {
    const got = await ddb.send(new GetCommand({
      TableName: tableObjects,
      Key: { [PK]: tenantId, [SK]: `backorderRequest#${id}` },
    } as any));
    existing = got?.Item || null;
  } catch {}
  const res = await ddb.send(new UpdateCommand({
    TableName: tableObjects,
    Key: { [PK]: tenantId, [SK]: `backorderRequest#${id}` },
    UpdateExpression: "SET #s = :s, updatedAt = :u",
    ExpressionAttributeNames: { "#s": "status" },
    ExpressionAttributeValues: { ":s": "ignored", ":u": now },
    ReturnValues: "ALL_NEW",
  }));
  const updated = res.Attributes as any;

  // Emit domain event: BackorderIgnored
  try {
    emitDomainEvent(ctx, "BackorderIgnored", {
      objectType: "backorderRequest",
      objectId: id,
      soId: existing?.soId ?? updated?.soId,
      itemId: existing?.itemId ?? updated?.itemId,
      statusBefore: existing?.status,
      statusAfter: updated?.status,
      result: "success",
      durationMs: Date.now() - started,
    });
  } catch {}

  return json(200, updated);
}
