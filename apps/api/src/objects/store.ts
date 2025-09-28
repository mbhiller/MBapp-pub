// apps/api/src/objects/store.ts
import {
  DynamoDBClient,
} from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  DeleteCommand,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";
import crypto from "crypto";

const TABLE = process.env.MBAPP_TABLE ?? "mbapp_objects";

// ---------- client ----------
let _doc: DynamoDBDocumentClient | null = null;
function doc() {
  if (_doc) return _doc;
  const ddb = new DynamoDBClient({});
  _doc = DynamoDBDocumentClient.from(ddb, {
    marshallOptions: { removeUndefinedValues: true, convertClassInstanceToMap: true },
    unmarshallOptions: {},
  });
  return _doc;
}

// ---------- key helpers ----------
function primaryKey(tenantId: string, type: string, id: string) {
  // Layout A -> pk=id, sk=tenant|type|id
  return { pk: id, sk: `${tenantId}|${type}|${id}` };
}

// ---------- paging helpers ----------
function encodePageKey(key?: Record<string, any> | undefined): string | undefined {
  if (!key) return undefined;
  return Buffer.from(JSON.stringify(key), "utf8").toString("base64");
}
function decodePageKey(cursor?: string | null): Record<string, any> | undefined {
  if (!cursor) return undefined;
  try {
    return JSON.parse(Buffer.from(cursor, "base64").toString("utf8"));
  } catch {
    return undefined;
  }
}

// ---------- public API ----------
export async function getObject(tenantId: string, type: string, id: string) {
  const Key = primaryKey(tenantId, type, id);
  const res = await doc().send(new GetCommand({ TableName: TABLE, Key }));
  return res.Item ?? null;
}

export async function putObject(item: Record<string, any>) {
  // Expect item.pk / item.sk already set by normalizeKeys (or uniqueness lock)
  if (!item?.pk || !item?.sk) throw new Error("putObject requires { pk, sk }");
  await doc().send(new PutCommand({ TableName: TABLE, Item: item }));
}

export async function deleteObject(tenantId: string, type: string, id: string) {
  const Key = primaryKey(tenantId, type, id);
  await doc().send(new DeleteCommand({ TableName: TABLE, Key }));
}

export type ListOptions = { limit?: number; next?: string };
export type ListResult<T = any> = { items: T[]; next?: string };

export async function listObjects(
  tenantId: string,
  type: string,
  opts: ListOptions = {}
): Promise<ListResult> {
  // Without a suitable GSI, we use Scan + FilterExpression on the sk prefix.
  const prefix = `${tenantId}|${type}|`;
  const ExclusiveStartKey = decodePageKey(opts.next);

  const res = await doc().send(
    new ScanCommand({
      TableName: TABLE,
      Limit: opts.limit ?? 50,
      ExclusiveStartKey,
      FilterExpression: "begins_with(#sk, :p)",
      ExpressionAttributeNames: { "#sk": "sk" },
      ExpressionAttributeValues: { ":p": prefix },
    })
  );

  return {
    items: res.Items ?? [],
    next: encodePageKey(res.LastEvaluatedKey),
  };
}

export async function searchObjects(
  tenantId: string,
  type: string,
  q: string,
  opts: ListOptions = {}
): Promise<ListResult> {
  // Simple substring search across name / sku / notes (extend as needed)
  const prefix = `${tenantId}|${type}|`;
  const ExclusiveStartKey = decodePageKey(opts.next);
  const hasQ = (q ?? "").trim().length > 0;

  const params: any = {
    TableName: TABLE,
    Limit: opts.limit ?? 50,
    ExclusiveStartKey,
    ExpressionAttributeNames: { "#sk": "sk" },
    ExpressionAttributeValues: { ":p": prefix },
    FilterExpression: "begins_with(#sk, :p)",
  };

  if (hasQ) {
    params.ExpressionAttributeNames["#name"] = "name";
    params.ExpressionAttributeNames["#sku"] = "sku";
    params.ExpressionAttributeNames["#notes"] = "notes";
    params.ExpressionAttributeValues[":q"] = q;
    params.FilterExpression += " AND (contains(#name, :q) OR contains(#sku, :q) OR contains(#notes, :q))";
  }

  const res = await doc().send(new ScanCommand(params));
  return {
    items: res.Items ?? [],
    next: encodePageKey(res.LastEvaluatedKey),
  };
}
