// apps/api/src/purchasing/po-create-from-suggestion.ts
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, tableObjects } from "../common/ddb";

const PK = process.env.MBAPP_TABLE_PK || "pk";
const SK = process.env.MBAPP_TABLE_SK || "sk";
const json = (s: number, b: unknown): APIGatewayProxyResultV2 => ({
  statusCode: s,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(b),
});

export async function handle(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const auth: any = (event as any).requestContext?.authorizer?.mbapp || {};
  const tenantId: string = auth.tenantId;
  const body = event.body ? JSON.parse(event.body) : {};
  const draft = body?.draft;
  if (!draft || draft.status !== "draft") return json(400, { message: "draft with status=draft required" });

  const now = new Date().toISOString();
  const po = { ...draft, tenantId, createdAt: draft.createdAt ?? now, updatedAt: now };
  await ddb.send(new PutCommand({ TableName: tableObjects, Item: { [PK]: tenantId, [SK]: `purchaseOrder#${po.id}`, ...po } }));

  // Optional: if caller bundled boRefs (future), we'd update them here to status=converted.

  return json(200, po);
}
