import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  QueryCommand,
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
} from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "crypto";

const REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
export const OBJECTS_TABLE = process.env.OBJECTS_TABLE || "mbapp_objects";

const ddb = new DynamoDBClient({ region: REGION });
export const doc = DynamoDBDocumentClient.from(ddb, {
  marshallOptions: { removeUndefinedValues: true },
  unmarshallOptions: { wrapNumbers: false },
});

export function encodeCursor(key?: Record<string, any>) {
  if (!key) return undefined;
  return Buffer.from(JSON.stringify(key), "utf8").toString("base64");
}
export function decodeCursor(token?: string) {
  if (!token) return undefined;
  try { return JSON.parse(Buffer.from(token, "base64").toString("utf8")); } catch { return undefined; }
}

/* --------------------------- OBJECTS (real Dynamo) --------------------------- */

export async function listObjectsByTypeQuery(params: {
  tenant: string;
  type: string;
  limit?: number;
  cursor?: string;
  nameContains?: string;
}) {
  const Limit = Math.min(Math.max(params.limit ?? 25, 1), 100);
  const ExclusiveStartKey = decodeCursor(params.cursor);

  const ExpressionAttributeNames: Record<string, string> = { "#g1pk": "gsi1pk" };
  const ExpressionAttributeValues: Record<string, any> = { ":g1pk": `${params.tenant}|${params.type}` };

  let FilterExpression: string | undefined;
  if (params.nameContains) {
    ExpressionAttributeNames["#name"] = "name";
    ExpressionAttributeValues[":name"] = params.nameContains;
    FilterExpression = "contains(#name, :name)";
  }

  const out = await doc.send(new QueryCommand({
    TableName: OBJECTS_TABLE,
    IndexName: "gsi1",
    KeyConditionExpression: "#g1pk = :g1pk",
    ExpressionAttributeNames,
    ExpressionAttributeValues,
    FilterExpression,
    Limit,
    ExclusiveStartKey,
    ScanIndexForward: false, // newest first (13-digit ms STRING)
  }));

  return { items: (out.Items ?? []) as any[], nextCursor: encodeCursor(out.LastEvaluatedKey) };
}

export async function getObjectByKey(params: { tenant: string; type: string; id: string }) {
  const Key = { pk: params.id, sk: `${params.tenant}|${params.type}` };
  const out = await doc.send(new GetCommand({ TableName: OBJECTS_TABLE, Key }));
  return (out.Item as any) || null;
}

export async function createObject(params: {
  tenant: string;
  type: string;
  body: Partial<{ id: string; name?: string; tags?: any; createdAt?: number | string }>;
}) {
  const nowMs = Date.now();
  const createdAt =
    typeof params.body?.createdAt === "number"
      ? params.body!.createdAt
      : typeof params.body?.createdAt === "string" && /^\d{13}$/.test(params.body.createdAt)
      ? Number(params.body.createdAt)
      : nowMs;

  const id = params.body?.id || randomUUID();

  const item = {
    pk: id,
    sk: `${params.tenant}|${params.type}`,
    id,
    tenant: params.tenant,
    type: params.type,
    name: params.body?.name ?? "",
    tags: params.body?.tags ?? null,
    createdAt,
    updatedAt: createdAt,
    gsi1pk: `${params.tenant}|${params.type}`,
    gsi1sk: String(createdAt), // STRING sort key
  };

  await doc.send(new PutCommand({
    TableName: OBJECTS_TABLE,
    Item: item,
    ConditionExpression: "attribute_not_exists(pk)",
  }));

  return item;
}

export async function updateObject(params: {
  tenant: string;
  type: string;
  id: string;
  patch: Partial<{ name?: string; tags?: any }>;
}) {
  const now = Date.now();
  const Key = { pk: params.id, sk: `${params.tenant}|${params.type}` };

  let UpdateExpression = "SET #updatedAt = :now";
  const ExpressionAttributeNames: Record<string, string> = { "#updatedAt": "updatedAt" };
  const ExpressionAttributeValues: Record<string, any> = { ":now": now };

  if (params.patch.name !== undefined) {
    UpdateExpression += ", #name = :name";
    ExpressionAttributeNames["#name"] = "name";
    ExpressionAttributeValues[":name"] = params.patch.name;
  }
  if (params.patch.tags !== undefined) {
    UpdateExpression += ", #tags = :tags";
    ExpressionAttributeNames["#tags"] = "tags";
    ExpressionAttributeValues[":tags"] = params.patch.tags;
  }

  const out = await doc.send(new UpdateCommand({
    TableName: OBJECTS_TABLE,
    Key,
    UpdateExpression,
    ExpressionAttributeNames,
    ExpressionAttributeValues,
    ReturnValues: "ALL_NEW",
    ConditionExpression: "attribute_exists(pk)", // guard: no upsert
  }));

  return (out.Attributes as any) || { id: params.id, type: params.type, tenant: params.tenant, updatedAt: now };
}

export async function deleteObject(params: { tenant: string; type: string; id: string }) {
  const Key = { pk: params.id, sk: `${params.tenant}|${params.type}` };
  const out = await doc.send(new DeleteCommand({
    TableName: OBJECTS_TABLE,
    Key,
    ReturnValues: "ALL_OLD",
  }));
  return (out.Attributes as any) || null;
}
