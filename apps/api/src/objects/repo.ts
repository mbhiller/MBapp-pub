// apps/api/src/objects/repo.ts
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  DeleteCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

type AnyRecord = Record<string, unknown>;

export type ListArgs = {
  tenantId?: string;        // logical tenant; will be mapped to PK_ATTR
  type: string;
  q?: string;
  eventId?: string;
  next?: string;
  limit?: number;
  fields?: string[];
  sort?: string;
};

export type GetArgs = {
  tenantId?: string;        // logical tenant; will be mapped to PK_ATTR
  type: string;
  id: string;
  fields?: string[];
};

export type CreateArgs = {
  tenantId?: string;        // logical tenant; will be mapped to PK_ATTR
  type: string;
  body: AnyRecord;
};

export type ReplaceArgs = {
  tenantId?: string;        // logical tenant; will be mapped to PK_ATTR
  type: string;
  id: string;
  body: AnyRecord;
};

export type UpdateArgs = {
  tenantId?: string;        // logical tenant; will be mapped to PK_ATTR
  type: string;
  id: string;
  body: AnyRecord;
};

export type DeleteArgs = {
  tenantId?: string;        // logical tenant; will be mapped to PK_ATTR
  type: string;
  id: string;
};

// -------- Dynamo config --------
// Table & key attribute names are configurable via env to match your infra.
const TABLE   = process.env.MBAPP_OBJECTS_TABLE || "mbapp_objects";
// Primary key attribute (HASH). Your table uses "pk".
const PK_ATTR = process.env.MBAPP_TABLE_PK || "pk";
// Sort key attribute (RANGE). Your table uses "sk" with `${type}#${id}` pattern.
const SK_ATTR = process.env.MBAPP_TABLE_SK || "sk";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// -------- Utilities --------
function nowIso() {
  return new Date().toISOString();
}
function newId() {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

function encodeNext(key?: AnyRecord | null) {
  return key ? Buffer.from(JSON.stringify(key), "utf8").toString("base64") : null;
}
function decodeNext(token?: string | null) {
  if (!token) return undefined;
  try {
    return JSON.parse(Buffer.from(token, "base64").toString("utf8"));
  } catch {
    return undefined;
  }
}

/**
 * Compute table keys for an item (Layout A).
 * Table PK is PK_ATTR (e.g., "pk") containing the tenant id.
 * Table SK is SK_ATTR (e.g., "sk") containing `${type}#${id}`.
 * We also keep plain `id` and `type` for client convenience.
 */
function computeKeys(tenantId: string | undefined, type: string, id: string) {
  const skValue = `${type}#${id}`;
  return {
    [PK_ATTR]: tenantId,
    [SK_ATTR]: skValue,
    id,
    type,
  } as AnyRecord;
}

// Pick a subset of fields (client-side projection)
function project<T extends AnyRecord>(obj: T, fields?: string[]): Partial<T> | T {
  if (!fields?.length) return obj;
  const out: Partial<T> = {};
  for (const f of fields) {
    if (f in obj) (out as AnyRecord)[f] = (obj as AnyRecord)[f];
  }
  return out;
}

// -------- Public API --------

export async function createObject({ tenantId, type, body }: CreateArgs) {
  const id = (body.id as string) || newId();
  const createdAt = (body.createdAt as string) || nowIso();

  const item: AnyRecord = {
    ...body,
    ...computeKeys(tenantId!, type, id),
    createdAt,
    updatedAt: nowIso(),
  };

  // enforce route type
  item.type = type;
  item.id = id;

  await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));
  return item;
}

export async function getObjectById({ tenantId, type, id, fields }: GetArgs) {
  const Key: AnyRecord = {
    [PK_ATTR]: tenantId,
    [SK_ATTR]: `${type}#${id}`,
  };

  const res = await ddb.send(new GetCommand({ TableName: TABLE, Key }));
  if (!res.Item) return null;
  if ((res.Item as AnyRecord).type !== type) return null; // extra safety
  return project(res.Item as AnyRecord, fields);
}

export async function listObjects({
  tenantId,
  type,
  q,
  next,
  limit = 20,
  fields,
}: ListArgs) {
  const ExclusiveStartKey = decodeNext(next);

  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: `#pk = :t AND begins_with(#sk, :prefix)`,
      ExpressionAttributeNames: { "#pk": PK_ATTR, "#sk": SK_ATTR },
      ExpressionAttributeValues: { ":t": tenantId, ":prefix": `${type}#` },
      ExclusiveStartKey,
      Limit: limit,
    })
  );

  let items = (res.Items || []) as AnyRecord[];
  if (q) {
    const needle = q.toLowerCase();
    items = items.filter((o) => JSON.stringify(o).toLowerCase().includes(needle));
  }

  return {
    items: items.map((o) => project(o, fields)),
    next: encodeNext(res.LastEvaluatedKey),
  };
}

// For now identical to list; wire richer predicates as needed.
export async function searchObjects(args: ListArgs) {
  return listObjects(args);
}

export async function replaceObject({ tenantId, type, id, body }: ReplaceArgs) {
  const existing = await getObjectById({ tenantId, type, id });
  const createdAt =
    (body.createdAt as string) ||
    ((existing as AnyRecord | null)?.createdAt as string) ||
    nowIso();

  const item: AnyRecord = {
    ...body,
    ...computeKeys(tenantId!, type, id),
    id,
    type,
    createdAt,
    updatedAt: nowIso(),
  };

  await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));
  return item;
}

export async function updateObject({ tenantId, type, id, body }: UpdateArgs) {
  // dynamic UpdateExpression (ignore identity/system fields)
  const identity = new Set([PK_ATTR, SK_ATTR, "tenantId", "type", "id", "createdAt", "updatedAt"]);
  const sets: string[] = [];
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};

  for (const [k, v] of Object.entries(body || {})) {
    if (identity.has(k)) continue;
    const nk = `#n_${k.replace(/[^A-Za-z0-9_]/g, "_")}`;
    const vk = `:v_${k.replace(/[^A-Za-z0-9_]/g, "_")}`;
    names[nk] = k;
    values[vk] = v;
    sets.push(`${nk} = ${vk}`);
  }

  // always enforce type + updatedAt
  names["#n_type"] = "type";
  values[":v_type"] = type;
  sets.push("#n_type = :v_type");

  names["#n_updatedAt"] = "updatedAt";
  values[":v_updatedAt"] = nowIso();
  sets.push("#n_updatedAt = :v_updatedAt");

  const Key: AnyRecord = {
    [PK_ATTR]: tenantId,
    [SK_ATTR]: `${type}#${id}`,
  };

  const res = await ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key,
      UpdateExpression: `SET ${sets.join(", ")}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ReturnValues: "ALL_NEW",
    })
  );

  const item = { ...(res.Attributes || {}), id } as AnyRecord;
  return item;
}

export async function deleteObject({ tenantId, type, id }: DeleteArgs) {
  const Key: AnyRecord = {
    [PK_ATTR]: tenantId,
    [SK_ATTR]: `${type}#${id}`,
  };
  await ddb.send(new DeleteCommand({ TableName: TABLE, Key }));
  return { ok: true };
}

/**
 * Layout A key normalizer:
 *   pk = id
 *   sk = `${tenantId}|${type}|${id}`
 */
export function normalizeKeys(input: { id?: string; type: string; tenantId: string }) {
  const id = input.id ?? crypto.randomUUID();
  const sk = `${input.tenantId}|${input.type}|${id}`;
  return { id, pk: id, sk, type: input.type };
}

/**
 * Deterministic uniqueness lock for product SKU values.
 * We store one item per (tenant, SKU):
 *   pk = UNIQ#<tenant>#product#SKU#<sku>
 *   sk = <tenant>|product|<productId>
 *   type = "product:sku"
 */
export function buildSkuLock(tenantId: string, productId: string, sku: string) {
  const now = new Date().toISOString();
  return {
    pk: `UNIQ#${tenantId}#product#SKU#${sku}`,
    sk: `${tenantId}|product|${productId}`,
    id: productId,
    tenantId,
    type: "product:sku",
    uniqueField: "SKU",
    uniqueValue: sku,
    createdAt: now,
    updatedAt: now,
  };
}
