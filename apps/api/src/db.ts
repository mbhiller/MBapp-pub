// apps/api/src/db.ts
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

/* ------------------------------ cursors ------------------------------ */
export function encodeCursor(key?: Record<string, any>) {
  if (!key) return undefined;
  return Buffer.from(JSON.stringify(key), "utf8").toString("base64");
}
export function decodeCursor(token?: string) {
  if (!token) return undefined;
  try {
    return JSON.parse(Buffer.from(token, "base64").toString("utf8"));
  } catch {
    return undefined;
  }
}

/* ============================ OBJECTS (existing) ============================ */

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

  const out = await doc.send(
    new QueryCommand({
      TableName: OBJECTS_TABLE,
      IndexName: "gsi1",
      KeyConditionExpression: "#g1pk = :g1pk",
      ExpressionAttributeNames,
      ExpressionAttributeValues,
      FilterExpression,
      Limit,
      ExclusiveStartKey,
      ScanIndexForward: false,
    })
  );

  return {
    items: (out.Items ?? []) as any[],
    nextCursor: encodeCursor(out.LastEvaluatedKey),
  };
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

  await doc.send(
    new PutCommand({
      TableName: OBJECTS_TABLE,
      Item: item,
      ConditionExpression: "attribute_not_exists(pk)",
    })
  );
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

  const out = await doc.send(
    new UpdateCommand({
      TableName: OBJECTS_TABLE,
      Key,
      UpdateExpression,
      ExpressionAttributeNames,
      ExpressionAttributeValues,
      ReturnValues: "ALL_NEW",
      ConditionExpression: "attribute_exists(pk)", // guard: no upsert
    })
  );
  return (out.Attributes as any) || { id: params.id, type: params.type, tenant: params.tenant, updatedAt: now };
}

export async function deleteObject(params: { tenant: string; type: string; id: string }) {
  const Key = { pk: params.id, sk: `${params.tenant}|${params.type}` };
  const out = await doc.send(
    new DeleteCommand({
      TableName: OBJECTS_TABLE,
      Key,
      ReturnValues: "ALL_OLD",
    })
  );
  return (out.Attributes as any) || null;
}

/* ============================ PRODUCTS (new) ============================ */

export type Product = {
  id: string;
  sku: string;
  name: string;
  type: "good" | "service";
  uom: string;
  price: number;
  taxCode?: string;
  tags?: any;
  createdAt?: number;
  updatedAt?: number;
};

function asProduct(item: any): Product {
  return {
    id: item.id,
    sku: item.sku ?? "",
    name: item.name ?? "",
    type: (item.type === "service" ? "service" : "good") as "good" | "service",
    uom: item.uom ?? "ea",
    price: typeof item.price === "number" ? item.price : Number(item.price ?? 0) || 0,
    taxCode: item.taxCode,
    tags: item.tags,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

/** List products for a tenant (newest first). Supports q (name/sku contains) and sku (exact). */
export async function listProductsQuery(params: {
  tenant: string;
  limit?: number;
  cursor?: string;
  q?: string;
  sku?: string;
}) {
  const Limit = Math.min(Math.max(params.limit ?? 25, 1), 100);

  // If sku provided, try GSI2 first (fast exact match if present)
  if (params.sku) {
    const g2 = await doc.send(
      new QueryCommand({
        TableName: OBJECTS_TABLE,
        IndexName: "gsi2",
        KeyConditionExpression: "#g2pk = :g2pk",
        ExpressionAttributeNames: { "#g2pk": "gsi2pk" },
        ExpressionAttributeValues: { ":g2pk": `${params.tenant}|product|sku|${params.sku.toUpperCase()}` },
        Limit,
        ScanIndexForward: false,
      })
    );
    const items = (g2.Items ?? []).map(asProduct);
    if (items.length > 0) return { items, nextCursor: undefined };
    // fallthrough to gsi1 if nothing found
  }

  const ExclusiveStartKey = decodeCursor(params.cursor);
  const ExpressionAttributeNames: Record<string, string> = { "#g1pk": "gsi1pk" };
  const ExpressionAttributeValues: Record<string, any> = { ":g1pk": `${params.tenant}|product` };

  let FilterExpression: string | undefined;
  if (params.q) {
    ExpressionAttributeNames["#name"] = "name";
    ExpressionAttributeNames["#sku"] = "sku";
    ExpressionAttributeValues[":q"] = params.q;
    FilterExpression = "contains(#name, :q) OR contains(#sku, :q)";
  }
  if (params.sku && !FilterExpression) {
    ExpressionAttributeNames["#sku"] = "sku";
    ExpressionAttributeValues[":sku"] = params.sku;
    FilterExpression = "#sku = :sku";
  }

  const out = await doc.send(
    new QueryCommand({
      TableName: OBJECTS_TABLE,
      IndexName: "gsi1",
      KeyConditionExpression: "#g1pk = :g1pk",
      ExpressionAttributeNames,
      ExpressionAttributeValues,
      FilterExpression,
      Limit,
      ExclusiveStartKey,
      ScanIndexForward: false,
    })
  );

  return {
    items: (out.Items ?? []).map(asProduct),
    nextCursor: encodeCursor(out.LastEvaluatedKey),
  };
}

/** Get product by id (base table) */
export async function getProductById(params: { tenant: string; id: string }) {
  const Key = { pk: params.id, sk: `${params.tenant}|product` };
  const out = await doc.send(new GetCommand({ TableName: OBJECTS_TABLE, Key }));
  return out.Item ? asProduct(out.Item) : null;
}

/** Create product; sets gsi1 (list) and gsi2 (sku) */
export async function createProduct(params: {
  tenant: string;
  body: Partial<{
    id: string;
    sku: string;
    name: string;
    type: "good" | "service";
    uom: string;
    price: number;
    taxCode?: string;
    tags?: any;
    createdAt?: number | string;
  }>;
}) {
  const nowMs = Date.now();
  const createdAt =
    typeof params.body?.createdAt === "number"
      ? params.body!.createdAt
      : typeof params.body?.createdAt === "string" && /^\d{13}$/.test(params.body.createdAt)
      ? Number(params.body.createdAt)
      : nowMs;

  const id = params.body?.id || randomUUID();
  const sku = (params.body?.sku || "").toString().trim();
  const name = (params.body?.name || "").toString().trim();
  const kind: "good" | "service" = params.body?.type === "service" ? "service" : "good";
  const uom = (params.body?.uom || "ea").toString().trim();
  const price = typeof params.body?.price === "number" ? params.body!.price : Number(params.body?.price ?? 0) || 0;

  const item = {
    pk: id,
    sk: `${params.tenant}|product`,
    id,
    tenant: params.tenant,
    type: kind,
    sku,
    name,
    uom,
    price,
    taxCode: params.body?.taxCode,
    tags: params.body?.tags ?? null,
    createdAt,
    updatedAt: createdAt,

    // list
    gsi1pk: `${params.tenant}|product`,
    gsi1sk: String(createdAt),

    // sku lookup (optional)
    gsi2pk: sku ? `${params.tenant}|product|sku|${sku.toUpperCase()}` : undefined,
    gsi2sk: id,
  };

  await doc.send(
    new PutCommand({
      TableName: OBJECTS_TABLE,
      Item: item,
      ConditionExpression: "attribute_not_exists(pk)",
    })
  );

  return asProduct(item);
}

/** Update product (guarded) */
export async function updateProduct(params: {
  tenant: string;
  id: string;
  patch: Partial<{ sku?: string; name?: string; type?: "good" | "service"; uom?: string; price?: number; taxCode?: string; tags?: any }>;
}) {
  const now = Date.now();
  const Key = { pk: params.id, sk: `${params.tenant}|product` };

  let UpdateExpression = "SET #updatedAt = :now";
  const ExpressionAttributeNames: Record<string, string> = { "#updatedAt": "updatedAt" };
  const ExpressionAttributeValues: Record<string, any> = { ":now": now };

  const set = (attr: string, valName: string, value: any) => {
    UpdateExpression += `, ${attr} = ${valName}`;
    ExpressionAttributeValues[valName] = value;
  };
  const nameAttr = (k: string, v: string) => ((ExpressionAttributeNames[k] = v), k);

  if (params.patch.name !== undefined) {
    const k = nameAttr("#name", "name");
    set(k, ":name", params.patch.name);
  }
  if (params.patch.sku !== undefined) {
    const k = nameAttr("#sku", "sku");
    set(k, ":sku", params.patch.sku);
    // maintain GSI2 for sku lookups
    const k2 = nameAttr("#g2pk", "gsi2pk");
    const k3 = nameAttr("#g2sk", "gsi2sk");
    set(k2, ":g2pk", `${params.tenant}|product|sku|${String(params.patch.sku).toUpperCase()}`);
    set(k3, ":g2sk", params.id);
  }
  if (params.patch.type !== undefined) {
    const k = nameAttr("#type", "type");
    set(k, ":type", params.patch.type === "service" ? "service" : "good");
  }
  if (params.patch.uom !== undefined) {
    const k = nameAttr("#uom", "uom");
    set(k, ":uom", params.patch.uom);
  }
  if (params.patch.price !== undefined) {
    const k = nameAttr("#price", "price");
    set(k, ":price", typeof params.patch.price === "number" ? params.patch.price : Number(params.patch.price || 0) || 0);
  }
  if (params.patch.taxCode !== undefined) {
    const k = nameAttr("#tax", "taxCode");
    set(k, ":tax", params.patch.taxCode);
  }
  if (params.patch.tags !== undefined) {
    const k = nameAttr("#tags", "tags");
    set(k, ":tags", params.patch.tags);
  }

  const out = await doc.send(
    new UpdateCommand({
      TableName: OBJECTS_TABLE,
      Key,
      UpdateExpression,
      ExpressionAttributeNames,
      ExpressionAttributeValues,
      ReturnValues: "ALL_NEW",
      ConditionExpression: "attribute_exists(pk)", // guard: no upsert
    })
  );

  return asProduct(out.Attributes || { ...Key, updatedAt: now });
}
