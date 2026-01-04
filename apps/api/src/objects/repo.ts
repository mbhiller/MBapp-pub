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
import { ensureLineIds } from "../shared/ensureLineIds";

type AnyRecord = Record<string, unknown>;

export type ListArgs = {
  tenantId?: string;
  type: string;
  q?: string;
  filters?: Record<string, string>;
  eventId?: string;
  next?: string;
  limit?: number;
  fields?: string[];
  sort?: string;
};

export type GetArgs = {
  tenantId?: string;
  type: string;
  id: string;
  fields?: string[];
  /** When true, allow returning an item whose stored type differs (used for alias resolution). */
  acceptAliasType?: boolean;
};

export type CreateArgs = {
  tenantId?: string;
  type: string;
  body: AnyRecord;
};

export type ReplaceArgs = {
  tenantId?: string;
  type: string;
  id: string;
  body: AnyRecord;
};

export type UpdateArgs = {
  tenantId?: string;
  type: string;
  id: string;
  body: AnyRecord;
};

export type DeleteArgs = {
  tenantId?: string;
  type: string;
  id: string;
};

// -------- Dynamo config --------
const TABLE   = process.env.MBAPP_OBJECTS_TABLE || process.env.MBAPP_TABLE || "mbapp_objects";
const PK_ATTR = process.env.MBAPP_TABLE_PK || "pk";
const SK_ATTR = process.env.MBAPP_TABLE_SK || "sk";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// -------- Utilities --------
function nowIso() {
  return new Date().toISOString();
}
function newId() {
  // Simple, fast, collision-resistant enough for dev; swap for UUID if desired
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
/**
 * Canonicalize object type for storage.
 * Treats inventory and inventoryItem as aliases; always writes as inventoryItem (canonical).
 * Other types are normalized to lowercase for consistency.
 */
function canonicalWriteType(typeParam: string): string {
  const raw = (typeParam || "").trim();
  const normalized = raw.toLowerCase();
  if (normalized === "inventory" || normalized === "inventoryitem") {
    return "inventoryItem";
  }
  // Preserve caller casing for non-aliased types to match stored SK prefixes and type-sensitive logic.
  return raw;
}


export async function createObject({ tenantId, type, body }: CreateArgs) {
  const needsLineIds = type === "salesOrder" || type === "purchaseOrder";
  const normalizedBody = needsLineIds && Array.isArray((body as AnyRecord)?.lines)
    ? { ...body, lines: ensureLineIds((body as AnyRecord).lines as AnyRecord[]) }
    : body;

  const id = (normalizedBody.id as string) || newId();
  const createdAt = (normalizedBody.createdAt as string) || nowIso();

  const item: AnyRecord = {
    ...normalizedBody,
    ...computeKeys(tenantId!, type, id),
    createdAt,
    updatedAt: nowIso(),
  };

  // Canonicalize type for storage (inventory/inventoryItem -> inventoryItem)
  item.type = canonicalWriteType(type);
  item.id = id;

  await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));
  return item;
}

export async function getObjectById({ tenantId, type, id, fields, acceptAliasType = false }: GetArgs) {
  const Key: AnyRecord = {
    [PK_ATTR]: tenantId,
    [SK_ATTR]: `${type}#${id}`,
  };

  const res = await ddb.send(new GetCommand({ TableName: TABLE, Key, ConsistentRead: true }));
  if (!res.Item) return null;
  if (!acceptAliasType && (res.Item as AnyRecord).type !== type) return null;
  return project(res.Item as AnyRecord, fields);
}

export async function listObjects({
  tenantId,
  type,
  q,
  filters,
  next,
  limit = 20,
  fields,
}: ListArgs) {
  // If no filters and no q, use simple path
  const hasFilters = filters && Object.keys(filters).length > 0;
  if (!hasFilters && !q) {
    const ExclusiveStartKey = decodeNext(next);
    const res = await ddb.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: `#pk = :t AND begins_with(#sk, :prefix)`,
        ExpressionAttributeNames: { "#pk": PK_ATTR, "#sk": SK_ATTR },
        ExpressionAttributeValues: { ":t": tenantId, ":prefix": `${type}#` },
        ExclusiveStartKey,
        Limit: limit,
        ConsistentRead: true,
      })
    );
    const items = (res.Items || []) as AnyRecord[];
    return {
      items: items.map((o) => project(o, fields)),
      next: encodeNext(res.LastEvaluatedKey),
    };
  }

  // Pagination-aware filtering: loop through Dynamo pages until we collect `limit` matches
  let collected: AnyRecord[] = [];
  const incomingCursorString = next ?? null;
  let ExclusiveStartKey = decodeNext(next);
  let LastEvaluatedKey: AnyRecord | undefined = undefined;
  let hasMorePages = true;

  while (collected.length < limit && hasMorePages) {
    const res = await ddb.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: `#pk = :t AND begins_with(#sk, :prefix)`,
        ExpressionAttributeNames: { "#pk": PK_ATTR, "#sk": SK_ATTR },
        ExpressionAttributeValues: { ":t": tenantId, ":prefix": `${type}#` },
        ExclusiveStartKey,
        Limit: Math.max(limit * 2, 100), // Fetch extra to account for filtering
        ConsistentRead: true,
      })
    );

    const rawItems = (res.Items || []) as AnyRecord[];
    LastEvaluatedKey = res.LastEvaluatedKey;

    // Apply filters and q to each item
    for (const item of rawItems) {
      // Apply structured filters (exact match)
      if (hasFilters) {
        let matchesFilters = true;
        for (const [key, value] of Object.entries(filters!)) {
          if (item[key] !== value) {
            matchesFilters = false;
            break;
          }
        }
        if (!matchesFilters) continue;
      }

      // Apply q search (substring)
      if (q) {
        const needle = q.toLowerCase();
        if (!JSON.stringify(item).toLowerCase().includes(needle)) continue;
      }

      // Item matched all filters and q; add to results
      collected.push(item);

      // Stop if we've collected enough
      if (collected.length >= limit) break;
    }

    // Check if we have more pages
    if (!LastEvaluatedKey) {
      hasMorePages = false;
      break;
    } else if (collected.length >= limit) {
      // We have enough results; next cursor is from Dynamo (more may exist after filters)
      hasMorePages = true;
      break;
    } else {
      // We exhausted the page but haven't collected enough; continue with Dynamo's cursor
      ExclusiveStartKey = LastEvaluatedKey;
    }
  }

  // Compute outgoing cursor ONLY from DynamoDB's LastEvaluatedKey
  const outgoingCursor = hasMorePages && LastEvaluatedKey ? encodeNext(LastEvaluatedKey) : null;

  // Defensive guard: if outgoing cursor equals incoming cursor, we're stuck
  if (outgoingCursor && outgoingCursor === incomingCursorString) {
    console.warn(
      `[objects/repo] Stuck cursor detected: type=${type}, tenantId=${tenantId}, cursor=${outgoingCursor.slice(0, 20)}...`
    );
    return {
      items: collected.slice(0, limit).map((o) => project(o, fields)),
      next: null,
    };
  }

  return {
    items: collected.slice(0, limit).map((o) => project(o, fields)),
    next: outgoingCursor,
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
  const needsLineIds = type === "salesOrder" || type === "purchaseOrder";
  let normalizedBody: AnyRecord | UpdateArgs["body"] = body;

  if (needsLineIds && Array.isArray((body as AnyRecord)?.lines)) {
    const existing = await getObjectById({ tenantId, type, id, fields: ["lines"] });
    const existingLines = Array.isArray((existing as AnyRecord)?.lines) ? (existing as AnyRecord).lines as AnyRecord[] : [];

    const reserveIds: string[] = [];
    let maxNum = 0;
    for (const ln of existingLines) {
      const lid = (ln as AnyRecord)?.id ?? (ln as AnyRecord)?.lineId;
      if (typeof lid === "string" && lid.trim()) {
        reserveIds.push(lid.trim());
        const m = /^L(\d+)$/i.exec(lid.trim());
        if (m) {
          const n = Number(m[1]);
          if (!Number.isNaN(n) && n > maxNum) maxNum = n;
        }
      }
    }

    const startAt = maxNum > 0 ? maxNum + 1 : 1;
    normalizedBody = {
      ...body,
      lines: ensureLineIds((body as AnyRecord).lines as AnyRecord[], { startAt, reserveIds }) as AnyRecord,
    };
  }
  const identity = new Set([PK_ATTR, SK_ATTR, "tenantId", "type", "id", "createdAt", "updatedAt"]);
  const sets: string[] = [];
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};

  for (const [k, v] of Object.entries(normalizedBody || {})) {
    if (identity.has(k)) continue;
    const nk = `#n_${k.replace(/[^A-Za-z0-9_]/g, "_")}`;
    const vk = `:v_${k.replace(/[^A-Za-z0-9_]/g, "_")}`;
    names[nk] = k;
    values[vk] = v;
    sets.push(`${nk} = ${vk}`);
  }

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
  const id = input.id ?? newId(); // <-- use newId(), no crypto
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
  const now = nowIso();
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
