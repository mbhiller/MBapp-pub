// apps/api/src/objects/repo.ts
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  DeleteCommand,
  QueryCommand,
  QueryCommandOutput,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { ensureLineIds } from "../shared/ensureLineIds";
import { normalizeTypeParam } from "./type-alias";

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

export type ListRegistrationsByEventArgs = {
  tenantId?: string;
  eventId: string;
  limit?: number;
  next?: string | null;
  scanIndexForward?: boolean;
  q?: string | null;
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

  export type ReserveEventSeatArgs = {
    tenantId?: string;
    eventId: string;
  };

  export type ReserveEventRvArgs = {
    tenantId?: string;
    eventId: string;
    qty: number;
    at?: string;
  };

  export type ReserveEventStallsArgs = {
    tenantId?: string;
    eventId: string;
    qty: number;
    at?: string;
  };

  export type ReserveEventLineArgs = {
    tenantId?: string;
    eventId: string;
    lineId: string;
    qty: number;
  };

// -------- Dynamo config --------
const TABLE   = process.env.MBAPP_OBJECTS_TABLE || process.env.MBAPP_TABLE || "mbapp_objects";
const PK_ATTR = process.env.MBAPP_TABLE_PK || "pk";
const SK_ATTR = process.env.MBAPP_TABLE_SK || "sk";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// -------- Telemetry config --------
const METRICS_ENABLED = process.env.MBAPP_OBJECTS_QUERY_METRICS === "1";
const DEEP_OFFSET_THRESHOLD = 500;
const HIGH_COST_PAGES_THRESHOLD = 20;
const HIGH_COST_ITEMS_THRESHOLD = 5000;

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

function computeRegistrationEventIndexKeys({ tenantId, reg }: { tenantId: string | undefined; reg: AnyRecord }) {
  const eventId = reg.eventId as string | undefined;
  const id = reg.id as string | undefined;
  if (!tenantId || !eventId || !id) return {} as AnyRecord;

  const dateComponent =
    (reg.submittedAt as string | undefined) ||
    (reg.createdAt as string | undefined) ||
    (reg.updatedAt as string | undefined) ||
    nowIso();

  return {
    gsi4pk: `${tenantId}|event|${eventId}`,
    gsi4sk: `${dateComponent}#${id}`,
  } as AnyRecord;
}

function stripInternalFields<T extends AnyRecord>(obj: T): T {
  if (!obj) return obj;
  const copy = { ...obj } as AnyRecord;
  delete copy.gsi4pk;
  delete copy.gsi4sk;
  return copy as T;
}

export async function listRegistrationsByEventId({ tenantId, eventId, limit = 50, next, scanIndexForward = true, q }: ListRegistrationsByEventArgs) {
  const decoded = decodeNext(next ?? null) as AnyRecord | undefined;
  const isOffsetCursor = !!decoded && typeof (decoded as AnyRecord).offset === "number";
  const forceFiltered = !!q || isOffsetCursor;

  // If cursor is an offset cursor or q is present, keep using filtered path for continuity.
  if (forceFiltered) {
    return listObjects({ tenantId, type: "registration", filters: { eventId }, limit, next: next ?? undefined, q: q ?? undefined });
  }

  try {
    const res = await ddb.send(new QueryCommand({
      TableName: TABLE,
      IndexName: "gsi4",
      KeyConditionExpression: "#gpk = :gpk",
      ExpressionAttributeNames: { "#gpk": "gsi4pk" },
      ExpressionAttributeValues: { ":gpk": `${tenantId}|event|${eventId}` },
      ExclusiveStartKey: decoded as AnyRecord | undefined,
      Limit: limit,
      ScanIndexForward: scanIndexForward,
      ConsistentRead: false,
    }));

    const items = (res.Items || []) as AnyRecord[];
    return {
      items: items.map(stripInternalFields),
      next: encodeNext(res.LastEvaluatedKey),
    };
  } catch (err: any) {
    // Fallback to filtered path when index is absent/not ready.
    if (METRICS_ENABLED) {
      console.warn(JSON.stringify({
        event: "objects:list:registration-event-fallback",
        tenantId,
        eventId,
        reason: err?.name || "unknown",
      }));
    }
    return listObjects({ tenantId, type: "registration", filters: { eventId }, limit, next: next ?? undefined });
  }
}

/**
 * Compute table keys for an item (Layout A).
 * Table PK is PK_ATTR (e.g., "pk") containing the tenant id.
 * Table SK is SK_ATTR (e.g., "sk") containing `${canonicalType}#${id}`.
 * We also keep plain `id` and `type` for client convenience.
 * Type is normalized to canonical form to prevent casing mismatches in SK prefixes.
 */
function computeKeys(tenantId: string | undefined, type: string, id: string) {
  const canonicalType = normalizeTypeParam(type) ?? type;
  const skValue = `${canonicalType}#${id}`;
  return {
    [PK_ATTR]: tenantId,
    [SK_ATTR]: skValue,
    id,
    type: canonicalType,
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
  const canonicalType = normalizeTypeParam(type) ?? type;
  const needsLineIds =
    canonicalType === "salesOrder" || canonicalType === "purchaseOrder" || canonicalType === "event";
  let normalizedBody = needsLineIds && Array.isArray((body as AnyRecord)?.lines)
    ? { ...body, lines: ensureLineIds((body as AnyRecord).lines as AnyRecord[]) }
    : body;

  // For events, ensure linesReservedById is always an object (never null/undefined)
  if (canonicalType === "event") {
    normalizedBody = { ...normalizedBody, linesReservedById: (normalizedBody as AnyRecord).linesReservedById ?? {} };
  }

  const id = (normalizedBody.id as string) || newId();
  const createdAt = (normalizedBody.createdAt as string) || nowIso();

  const item: AnyRecord = {
    ...normalizedBody,
    ...computeKeys(tenantId!, canonicalType, id),
    createdAt,
    updatedAt: nowIso(),
    ...(canonicalType === "registration" ? computeRegistrationEventIndexKeys({ tenantId, reg: { ...normalizedBody, id, createdAt } }) : {}),
  };

  // Type is already canonical from computeKeys; ensure consistency
  item.type = canonicalType;
  item.id = id;

  await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));
  return stripInternalFields(item);
}

export async function getObjectById({ tenantId, type, id, fields, acceptAliasType = false }: GetArgs) {
  const canonicalType = normalizeTypeParam(type) ?? type;
  const Key: AnyRecord = {
    [PK_ATTR]: tenantId,
    [SK_ATTR]: `${canonicalType}#${id}`,
  };

  const res = await ddb.send(new GetCommand({ TableName: TABLE, Key, ConsistentRead: true }));
  if (!res.Item) return null;
  if (!acceptAliasType && (res.Item as AnyRecord).type !== canonicalType) return null;
  return project(stripInternalFields(res.Item as AnyRecord), fields);
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
  const startTime = Date.now();
  const canonicalType = normalizeTypeParam(type) ?? type;
  // If no filters and no q, use simple path
  const hasFilters = filters && Object.keys(filters).length > 0;
  const pathType = (!hasFilters && !q) ? "simple" : "filtered";

  if (!hasFilters && !q) {
    // Simple path: efficient DynamoDB key cursor
    const ExclusiveStartKey = decodeNext(next);
    const dbStart = Date.now();
    const res = await ddb.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: `#pk = :t AND begins_with(#sk, :prefix)`,
        ExpressionAttributeNames: { "#pk": PK_ATTR, "#sk": SK_ATTR },
        ExpressionAttributeValues: { ":t": tenantId, ":prefix": `${canonicalType}#` },
        ExclusiveStartKey,
        Limit: limit,
        ConsistentRead: true,
      })
    );
    const dbMs = Date.now() - dbStart;
    const items = (res.Items || []) as AnyRecord[];
    const totalMs = Date.now() - startTime;

    if (METRICS_ENABLED) {
      console.log(JSON.stringify({
        event: "objects:list:path",
        pathType,
        tenantId,
        type: canonicalType,
        limit,
        hasNext: !!next,
        itemsReturned: items.length,
        dbMs,
        totalMs,
      }));
    }

    return {
      items: items.map((o) => project(stripInternalFields(o), fields)),
      next: encodeNext(res.LastEvaluatedKey),
    };
  }

  // Filtered path: Pagination-aware filtering
  // 1) Fetch all matching items (up to a reasonable cap)
  // 2) Sort deterministically (updatedAt desc, then id asc)
  // 3) Use offset-based pagination (cursor encodes offset, not DynamoDB key)
  // This ensures consistent ordering across pages when filtering/searching.

  const incomingCursorString = next ?? null;
  let offset = 0;
  
  // Decode offset from cursor if present
  if (incomingCursorString) {
    try {
      const decoded = JSON.parse(Buffer.from(incomingCursorString, "base64").toString("utf8"));
      offset = typeof decoded.offset === "number" ? decoded.offset : 0;
    } catch {
      offset = 0;
    }
  }

  // Warn on deep offset pagination
  if (offset >= DEEP_OFFSET_THRESHOLD) {
    console.warn(JSON.stringify({
      event: "objects:list:deep-offset",
      tenantId,
      type: canonicalType,
      offset,
      filters,
      q,
      message: "Deep pagination with offset cursor - consider UI redesign or cursor limit",
    }));
  }

  // Fetch all matching items (up to a cap to prevent runaway queries)
  let collected: AnyRecord[] = [];
  let ExclusiveStartKey: AnyRecord | undefined = undefined;
  const maxFetch = 10000; // Safety cap
  const maxPages = 50;

  const dbFetchStart = Date.now();
  let pageIdx = 0;
  for (pageIdx = 0; pageIdx < maxPages; pageIdx++) {
    if (collected.length >= maxFetch) break;

    const queryRes: QueryCommandOutput = await ddb.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: `#pk = :t AND begins_with(#sk, :prefix)`,
        ExpressionAttributeNames: { "#pk": PK_ATTR, "#sk": SK_ATTR },
        ExpressionAttributeValues: { ":t": tenantId, ":prefix": `${canonicalType}#` },
        ExclusiveStartKey,
        Limit: 1000,
        ConsistentRead: true,
      })
    );

    const rawItems = (queryRes.Items || []) as AnyRecord[];

    // Apply filters and q to each item
    const filterStart = Date.now();
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

      // Item matched; collect it
      collected.push(item);
      if (collected.length >= maxFetch) break;
    }

    // If no more pages, stop
    if (!queryRes.LastEvaluatedKey) break;
    ExclusiveStartKey = queryRes.LastEvaluatedKey;
  }
  const dbFetchMs = Date.now() - dbFetchStart;
  const pagesFetched = pageIdx + 1;
  const itemsFetched = collected.length;
  const capHit = collected.length >= maxFetch || pageIdx >= maxPages - 1;

  // Apply deterministic ordering:
  // 1) Deduplicate by id (defensive guard)
  const dedupStart = Date.now();
  const dedupMap = new Map<string, AnyRecord>();
  for (const item of collected) {
    const itemId = item?.id as string | undefined;
    if (itemId && !dedupMap.has(itemId)) {
      dedupMap.set(itemId, item);
    }
  }
  const deduped = Array.from(dedupMap.values());
  const dedupeMs = Date.now() - dedupStart;
  const itemsMatched = deduped.length;

  // 2) Sort: updatedAt desc, then id asc
  const sortStart = Date.now();
  deduped.sort((a, b) => {
    const aUpdated = (a?.updatedAt as string) || "";
    const bUpdated = (b?.updatedAt as string) || "";
    if (aUpdated && bUpdated && aUpdated !== bUpdated) {
      return aUpdated > bUpdated ? -1 : 1;
    }
    const aId = (a?.id as string) || "";
    const bId = (b?.id as string) || "";
    return aId.localeCompare(bId);
  });
  const sortMs = Date.now() - sortStart;

  // 3) Slice for current page
  const finalItems = deduped.slice(offset, offset + limit);
  const hasMore = offset + limit < deduped.length;

  // 4) Generate offset-based cursor if more items exist
  let outgoingCursor: string | null = null;
  if (hasMore) {
    const nextOffset = offset + limit;
    const cursorObj = { offset: nextOffset };
    outgoingCursor = Buffer.from(JSON.stringify(cursorObj)).toString("base64");
  }

  const totalMs = Date.now() - startTime;

  // Telemetry: filtered path cost metrics
  const highCost = pagesFetched >= HIGH_COST_PAGES_THRESHOLD || 
                   itemsFetched >= HIGH_COST_ITEMS_THRESHOLD || 
                   capHit;

  if (METRICS_ENABLED) {
    console.log(JSON.stringify({
      event: "objects:list:filtered-cost",
      tenantId,
      type: canonicalType,
      pagesFetched,
      itemsFetched,
      itemsMatched,
      offset,
      limit,
      hasMore,
      capHit,
      dbFetchMs,
      dedupeMs,
      sortMs,
      totalMs,
      hasFilters,
      hasQ: !!q,
    }));
  }

  if (highCost) {
    console.warn(JSON.stringify({
      event: "objects:list:high-cost",
      tenantId,
      type: canonicalType,
      pagesFetched,
      itemsFetched,
      itemsMatched,
      capHit,
      filters,
      q,
      totalMs,
    }));
  }

  return {
    items: finalItems.map((o) => project(stripInternalFields(o), fields)),
    next: outgoingCursor,
  };
}

// For now identical to list; wire richer predicates as needed.
// Telemetry uses search-specific event names for tracking.
export async function searchObjects(args: ListArgs) {
  const startTime = Date.now();
  const canonicalType = normalizeTypeParam(args.type) ?? args.type;
  const hasFilters = args.filters && Object.keys(args.filters).length > 0;
  const pathType = (!hasFilters && !args.q) ? "simple" : "filtered";

  // Call base implementation
  const result = await listObjects(args);
  const totalMs = Date.now() - startTime;

  // Override event names for search tracking (mirrors list telemetry)
  if (METRICS_ENABLED) {
    console.log(JSON.stringify({
      event: "objects:search:path",
      pathType,
      tenantId: args.tenantId,
      type: canonicalType,
      limit: args.limit || 20,
      hasNext: !!args.next,
      itemsReturned: result.items.length,
      totalMs,
    }));
  }

  return result;
}

export async function replaceObject({ tenantId, type, id, body }: ReplaceArgs) {
  const canonicalType = normalizeTypeParam(type) ?? type;
  const existing = await getObjectById({ tenantId, type, id });
  const createdAt =
    (body.createdAt as string) ||
    ((existing as AnyRecord | null)?.createdAt as string) ||
    nowIso();

  const item: AnyRecord = {
    ...body,
    ...computeKeys(tenantId!, canonicalType, id),
    id,
    type: canonicalType,
    createdAt,
    updatedAt: nowIso(),
    ...(canonicalType === "registration" ? computeRegistrationEventIndexKeys({ tenantId, reg: { ...body, id, createdAt } }) : {}),
  };

  await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));
  return stripInternalFields(item);
}

export async function updateObject({ tenantId, type, id, body }: UpdateArgs) {
  const canonicalType = normalizeTypeParam(type) ?? type;
  const needsLineIds =
    canonicalType === "salesOrder" || canonicalType === "purchaseOrder" || canonicalType === "event";
  let normalizedBody: AnyRecord | UpdateArgs["body"] = body;

  let registrationIndexKeys: AnyRecord | null = null;

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

  // For events, ensure linesReservedById is always an object (never null/undefined)
  if (canonicalType === "event") {
    const existing = await getObjectById({ tenantId, type, id, fields: ["linesReservedById"] });
    const existingMap = (existing as AnyRecord)?.linesReservedById as Record<string, unknown> | undefined;
    // Only initialize if not provided in body AND existing event has none
    if (!((normalizedBody as AnyRecord).linesReservedById) && !existingMap) {
      (normalizedBody as AnyRecord).linesReservedById = {};
    }
  }
  if (canonicalType === "registration") {
    const existing = await getObjectById({ tenantId, type, id, fields: ["eventId", "createdAt", "submittedAt", "updatedAt"] });
    const merged = {
      ...(existing as AnyRecord),
      ...(normalizedBody as AnyRecord),
      id,
    } as AnyRecord;
    registrationIndexKeys = computeRegistrationEventIndexKeys({ tenantId, reg: merged });
  }

  const identity = new Set([PK_ATTR, SK_ATTR, "tenantId", "type", "id", "createdAt", "updatedAt", "gsi4pk", "gsi4sk"]);
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
  values[":v_type"] = canonicalType;
  sets.push("#n_type = :v_type");

  names["#n_updatedAt"] = "updatedAt";
  values[":v_updatedAt"] = nowIso();
  sets.push("#n_updatedAt = :v_updatedAt");

  if (registrationIndexKeys && registrationIndexKeys.gsi4pk && registrationIndexKeys.gsi4sk) {
    names["#n_gsi4pk"] = "gsi4pk";
    values[":v_gsi4pk"] = registrationIndexKeys.gsi4pk;
    sets.push("#n_gsi4pk = :v_gsi4pk");

    names["#n_gsi4sk"] = "gsi4sk";
    values[":v_gsi4sk"] = registrationIndexKeys.gsi4sk;
    sets.push("#n_gsi4sk = :v_gsi4sk");
  }

  const Key: AnyRecord = {
    [PK_ATTR]: tenantId,
    [SK_ATTR]: `${canonicalType}#${id}`,
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
  return stripInternalFields(item);
}

/**
 * Atomically reserve one seat for an event by incrementing reservedCount.
 * Condition: allow when capacity is missing/null/zero (treated as unlimited) OR reservedCount < capacity.
 * Throws ConditionalCheckFailedException when capacity would be exceeded.
 */
export async function reserveEventSeat({ tenantId, eventId }: ReserveEventSeatArgs) {
  const Key: AnyRecord = {
    [PK_ATTR]: tenantId,
    [SK_ATTR]: `${normalizeTypeParam("event") ?? "event"}#${eventId}`,
  };

  const names = {
    "#reserved": "reservedCount",
    "#updatedAt": "updatedAt",
    "#cap": "capacity",
  };

  const values = {
    ":one": 1,
    ":zero": 0,
    ":now": nowIso(),
  };

  try {
    const res = await ddb.send(new UpdateCommand({
      TableName: TABLE,
      Key,
      UpdateExpression: "SET #reserved = if_not_exists(#reserved, :zero) + :one, #updatedAt = :now",
      ConditionExpression: "(attribute_not_exists(#cap) OR #cap = :zero) OR (attribute_not_exists(#reserved) OR #reserved < #cap)",
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ReturnValues: "ALL_NEW",
    }));

    return res.Attributes as AnyRecord;
  } catch (err: any) {
    if (err?.name === "ConditionalCheckFailedException") {
      throw Object.assign(new Error("Event capacity full"), { code: "capacity_full", statusCode: 409 });
    }
    throw err;
  }
}

/**
 * Atomically release one seat for an event by decrementing reservedCount.
 * Safe/idempotent: if reservedCount is missing or already zero, performs no-op without throwing.
 * Never allows reservedCount to go negative.
 */
export async function releaseEventSeat({ tenantId, eventId }: ReserveEventSeatArgs) {
  const Key: AnyRecord = {
    [PK_ATTR]: tenantId,
    [SK_ATTR]: `${normalizeTypeParam("event") ?? "event"}#${eventId}`,
  };

  const names = {
    "#reserved": "reservedCount",
    "#updatedAt": "updatedAt",
  };

  const values = {
    ":one": 1,
    ":now": nowIso(),
  };

  try {
    const res = await ddb.send(new UpdateCommand({
      TableName: TABLE,
      Key,
      UpdateExpression: "SET #reserved = #reserved - :one, #updatedAt = :now",
      ConditionExpression: "#reserved >= :one",
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ReturnValues: "ALL_NEW",
    }));
    return res.Attributes as AnyRecord;
  } catch (err: any) {
    if (err?.name === "ConditionalCheckFailedException") {
      // No reserved seats to release; treat as no-op.
      return null as any;
    }
    throw err;
  }
}

/**
 * Atomically reserve RV capacity on an event by incrementing rvReserved by qty.
 * Rules:
 * - If qty <= 0 OR event.rvEnabled is false => no-op
 * - If rvCapacity is null/undefined and rvEnabled=true => unlimited (allow increment)
 * - If rvCapacity === 0 => capacity full for any qty>0
 * - Guard: ensure previous rvReserved + qty <= rvCapacity using optimistic check
 * Persists rvReserved on the event (defaults to 0 when missing).
 */
export async function reserveEventRv({ tenantId, eventId, qty, at }: ReserveEventRvArgs) {
  if (!qty || qty <= 0) return null as any;

  // Read current flags and counters (strongly consistent)
  const current = await getObjectById({
    tenantId,
    type: "event",
    id: eventId,
    fields: ["id", "rvEnabled", "rvCapacity", "rvReserved"],
  });

  const rvEnabled = (current as any)?.rvEnabled === true;
  const rvCapacity = (current as any)?.rvCapacity as number | undefined | null;
  const rvReserved = Number((current as any)?.rvReserved ?? 0) || 0;

  if (!rvEnabled) return null as any;
  if (rvCapacity === 0 && qty > 0) {
    throw Object.assign(new Error("RV capacity full"), { code: "rv_capacity_full", statusCode: 409 });
  }
  if (typeof rvCapacity === "number" && rvCapacity > 0) {
    if (rvReserved + qty > rvCapacity) {
      throw Object.assign(new Error("RV capacity full"), { code: "rv_capacity_full", statusCode: 409 });
    }
  }

  const Key: AnyRecord = {
    [PK_ATTR]: tenantId,
    [SK_ATTR]: `${normalizeTypeParam("event") ?? "event"}#${eventId}`,
  };

  const names = {
    "#rvReserved": "rvReserved",
    "#updatedAt": "updatedAt",
  } as Record<string, string>;

  const values = {
    ":now": at || nowIso(),
    ":zero": 0,
    ":qty": qty,
    ":expected": rvReserved,
  } as Record<string, unknown>;

  // Optimistic concurrency: ensure rvReserved matches snapshot (or missing when expected=0)
  const condition = rvReserved === 0
    ? "(attribute_not_exists(#rvReserved) OR #rvReserved = :expected)"
    : "#rvReserved = :expected";

  try {
    const res = await ddb.send(new UpdateCommand({
      TableName: TABLE,
      Key,
      UpdateExpression: "SET #rvReserved = if_not_exists(#rvReserved, :zero) + :qty, #updatedAt = :now",
      ConditionExpression: condition,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ReturnValues: "ALL_NEW",
    }));
    return res.Attributes as AnyRecord;
  } catch (err: any) {
    if (err?.name === "ConditionalCheckFailedException") {
      // Lost race or capacity changed; surface as capacity_full for callers
      throw Object.assign(new Error("RV capacity full"), { code: "rv_capacity_full", statusCode: 409 });
    }
    throw err;
  }
}

/**
 * Atomically release RV capacity by decrementing rvReserved by qty.
 * Safe/idempotent: clamps at 0 and treats insufficient reserved as no-op.
 */
export async function releaseEventRv({ tenantId, eventId, qty, at }: ReserveEventRvArgs) {
  if (!qty || qty <= 0) return null as any;

  // Optional check: if rv not enabled, treat as no-op
  const current = await getObjectById({
    tenantId,
    type: "event",
    id: eventId,
    fields: ["id", "rvEnabled", "rvReserved"],
  });
  const rvEnabled = (current as any)?.rvEnabled === true;
  if (!rvEnabled) return null as any;

  const Key: AnyRecord = {
    [PK_ATTR]: tenantId,
    [SK_ATTR]: `${normalizeTypeParam("event") ?? "event"}#${eventId}`,
  };

  const names = {
    "#rvReserved": "rvReserved",
    "#updatedAt": "updatedAt",
  } as Record<string, string>;

  const values = {
    ":now": at || nowIso(),
    ":qty": qty,
    ":zero": 0,
  } as Record<string, unknown>;

  try {
    const res = await ddb.send(new UpdateCommand({
      TableName: TABLE,
      Key,
      UpdateExpression: "SET #rvReserved = if_not_exists(#rvReserved, :zero) - :qty, #updatedAt = :now",
      ConditionExpression: "#rvReserved >= :qty",
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ReturnValues: "ALL_NEW",
    }));
    return res.Attributes as AnyRecord;
  } catch (err: any) {
    if (err?.name === "ConditionalCheckFailedException") {
      // Clamp to zero if not enough reserved; perform safe correction
      try {
        const res2 = await ddb.send(new UpdateCommand({
          TableName: TABLE,
          Key,
          UpdateExpression: "SET #rvReserved = :zero, #updatedAt = :now",
          ConditionExpression: "attribute_exists(#rvReserved) AND #rvReserved > :zero",
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
          ReturnValues: "ALL_NEW",
        }));
        return res2.Attributes as AnyRecord;
      } catch (_) {
        // Treat as no-op if still failing
        return null as any;
      }
    }
    throw err;
  }
}

/**
 * Atomically reserve stall capacity by incrementing stallReserved by qty.
 * Rules:
 * - If qty <= 0 OR event.stallEnabled is false => no-op
 * - If stallCapacity is null/undefined and stallEnabled=true => unlimited (allow increment)
 * - If stallCapacity === 0 => capacity full for any qty>0
 * - Guard: ensure previous stallReserved + qty <= stallCapacity using optimistic check
 * Persists stallReserved on the event (defaults to 0 when missing).
 */
export async function reserveEventStalls({ tenantId, eventId, qty, at }: ReserveEventStallsArgs) {
  if (!qty || qty <= 0) return null as any;

  // Read current flags and counters (strongly consistent)
  const current = await getObjectById({
    tenantId,
    type: "event",
    id: eventId,
    fields: ["id", "stallEnabled", "stallCapacity", "stallReserved"],
  });

  const stallEnabled = (current as any)?.stallEnabled === true;
  const stallCapacity = (current as any)?.stallCapacity as number | undefined | null;
  const stallReserved = Number((current as any)?.stallReserved ?? 0) || 0;

  if (!stallEnabled) return null as any;
  if (stallCapacity === 0 && qty > 0) {
    throw Object.assign(new Error("Stall capacity full"), { code: "stall_capacity_full", statusCode: 409 });
  }
  if (typeof stallCapacity === "number" && stallCapacity > 0) {
    if (stallReserved + qty > stallCapacity) {
      throw Object.assign(new Error("Stall capacity full"), { code: "stall_capacity_full", statusCode: 409 });
    }
  }

  const Key: AnyRecord = {
    [PK_ATTR]: tenantId,
    [SK_ATTR]: `${normalizeTypeParam("event") ?? "event"}#${eventId}`,
  };

  const names = {
    "#stallReserved": "stallReserved",
    "#updatedAt": "updatedAt",
  } as Record<string, string>;

  const values = {
    ":now": at || nowIso(),
    ":zero": 0,
    ":qty": qty,
    ":expected": stallReserved,
  } as Record<string, unknown>;

  // Optimistic concurrency: ensure stallReserved matches snapshot (or missing when expected=0)
  const condition = stallReserved === 0
    ? "(attribute_not_exists(#stallReserved) OR #stallReserved = :expected)"
    : "#stallReserved = :expected";

  try {
    const res = await ddb.send(new UpdateCommand({
      TableName: TABLE,
      Key,
      UpdateExpression: "SET #stallReserved = if_not_exists(#stallReserved, :zero) + :qty, #updatedAt = :now",
      ConditionExpression: condition,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ReturnValues: "ALL_NEW",
    }));
    return res.Attributes as AnyRecord;
  } catch (err: any) {
    if (err?.name === "ConditionalCheckFailedException") {
      // Lost race or capacity changed; surface as capacity_full for callers
      throw Object.assign(new Error("Stall capacity full"), { code: "stall_capacity_full", statusCode: 409 });
    }
    throw err;
  }
}

/**
 * Atomically release stall capacity by decrementing stallReserved by qty.
 * Safe/idempotent: clamps at 0 and treats insufficient reserved as no-op.
 */
export async function releaseEventStalls({ tenantId, eventId, qty, at }: ReserveEventStallsArgs) {
  if (!qty || qty <= 0) return null as any;

  // Optional check: if stall not enabled, treat as no-op
  const current = await getObjectById({
    tenantId,
    type: "event",
    id: eventId,
    fields: ["id", "stallEnabled", "stallReserved"],
  });
  const stallEnabled = (current as any)?.stallEnabled === true;
  if (!stallEnabled) return null as any;

  const Key: AnyRecord = {
    [PK_ATTR]: tenantId,
    [SK_ATTR]: `${normalizeTypeParam("event") ?? "event"}#${eventId}`,
  };

  const names = {
    "#stallReserved": "stallReserved",
    "#updatedAt": "updatedAt",
  } as Record<string, string>;

  const values = {
    ":now": at || nowIso(),
    ":qty": qty,
    ":zero": 0,
  } as Record<string, unknown>;

  try {
    const res = await ddb.send(new UpdateCommand({
      TableName: TABLE,
      Key,
      UpdateExpression: "SET #stallReserved = if_not_exists(#stallReserved, :zero) - :qty, #updatedAt = :now",
      ConditionExpression: "#stallReserved >= :qty",
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ReturnValues: "ALL_NEW",
    }));
    return res.Attributes as AnyRecord;
  } catch (err: any) {
    if (err?.name === "ConditionalCheckFailedException") {
      // Clamp to zero if not enough reserved; perform safe correction
      try {
        const res2 = await ddb.send(new UpdateCommand({
          TableName: TABLE,
          Key,
          UpdateExpression: "SET #stallReserved = :zero, #updatedAt = :now",
          ConditionExpression: "attribute_exists(#stallReserved) AND #stallReserved > :zero",
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
          ReturnValues: "ALL_NEW",
        }));
        return res2.Attributes as AnyRecord;
      } catch (_) {
        // Treat as no-op if still failing
        return null as any;
      }
    }
    throw err;
  }
}

/**
 * Reserve class line capacity by incrementing linesReservedById[lineId] by qty.
 * Enforces EventLine.capacity when set; null/undefined means unlimited.
 * Uses retry loop (max 5 attempts) to handle concurrent modifications.
 */
export async function reserveEventLineCapacity({ tenantId, eventId, lineId, qty }: ReserveEventLineArgs) {
  if (!qty || qty <= 0) {
    throw Object.assign(new Error("Invalid class qty"), { code: "invalid_class_qty", statusCode: 400 });
  }

  const MAX_RETRIES = 5;
  let lastErr: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const event = await getObjectById({
        tenantId,
        type: "event",
        id: eventId,
        fields: ["id", "lines", "linesReservedById"],
      });

      const lines = Array.isArray((event as AnyRecord)?.lines) ? ((event as AnyRecord).lines as AnyRecord[]) : [];
      const line = lines.find((l) => (l as AnyRecord)?.id === lineId);
      if (!line) {
        throw Object.assign(new Error("Event line not found"), { code: "event_line_not_found", statusCode: 400 });
      }

      const capacity = (line as AnyRecord)?.capacity as number | null | undefined;
      const reservedMap = ((event as AnyRecord)?.linesReservedById as Record<string, unknown>) || {};
      const reserved = Number(reservedMap[lineId] ?? 0) || 0;

      // Check capacity (fail fast before DynamoDB call)
      if (typeof capacity === "number" && capacity >= 0) {
        if (reserved + qty > capacity) {
          throw Object.assign(new Error("Class capacity full"), { code: "class_capacity_full", statusCode: 409 });
        }
      }

      const Key: AnyRecord = {
        [PK_ATTR]: tenantId,
        [SK_ATTR]: `${normalizeTypeParam("event") ?? "event"}#${eventId}`,
      };

      const names = {
        "#linesReservedById": "linesReservedById",
        "#lid": lineId,
        "#updatedAt": "updatedAt",
      } as Record<string, string>;

      const values: Record<string, unknown> = {
        ":zero": 0,
        ":qty": qty,
        ":now": nowIso(),
      };

      // Build ConditionExpression: match expected value or attribute_not_exists
      let conditionExpression: string;
      if (reserved === 0) {
        values[":zero_cond"] = 0;
        conditionExpression = "attribute_not_exists(#linesReservedById.#lid) OR #linesReservedById.#lid = :zero_cond";
      } else {
        values[":expected"] = reserved;
        conditionExpression = "#linesReservedById.#lid = :expected";
      }

      const res = await ddb.send(new UpdateCommand({
        TableName: TABLE,
        Key,
        UpdateExpression: "SET #linesReservedById.#lid = if_not_exists(#linesReservedById.#lid, :zero) + :qty, #updatedAt = :now",
        ConditionExpression: conditionExpression,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ReturnValues: "ALL_NEW",
      }));
      return res.Attributes as AnyRecord;
    } catch (err: any) {
      if (err?.name === "ConditionalCheckFailedException") {
        // Concurrent modification; retry from scratch
        lastErr = err;
        continue;
      }
      // Non-retryable errors (capacity full, line not found, etc.)
      if (err?.code === "class_capacity_full" || err?.code === "event_line_not_found" || err?.code === "invalid_class_qty") {
        throw err;
      }
      // Other DynamoDB errors
      throw err;
    }
  }

  // Exhausted retries
  throw Object.assign(new Error("Failed to reserve capacity after max retries"), {
    code: "capacity_reserve_conflict",
    statusCode: 409,
    eventLineId: lineId,
    cause: lastErr,
  });
}

/**
 * Release class line capacity by decrementing linesReservedById[lineId] by qty (clamped at 0).
 * Uses retry loop (max 5 attempts) to handle concurrent modifications.
 */
export async function releaseEventLineCapacity({ tenantId, eventId, lineId, qty }: ReserveEventLineArgs) {
  if (!qty || qty <= 0) return null as any;

  const MAX_RETRIES = 5;
  let lastErr: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const event = await getObjectById({
        tenantId,
        type: "event",
        id: eventId,
        fields: ["id", "lines", "linesReservedById"],
      });

      const lines = Array.isArray((event as AnyRecord)?.lines) ? ((event as AnyRecord).lines as AnyRecord[]) : [];
      const line = lines.find((l) => (l as AnyRecord)?.id === lineId);
      if (!line) {
        throw Object.assign(new Error("Event line not found"), { code: "event_line_not_found", statusCode: 400 });
      }

      const reservedMap = ((event as AnyRecord)?.linesReservedById as Record<string, unknown>) || {};
      const reserved = Number(reservedMap[lineId] ?? 0) || 0;
      if (reserved <= 0) return null as any;

      // Compute new value clamped at 0
      const newReserved = Math.max(0, reserved - qty);

      const Key: AnyRecord = {
        [PK_ATTR]: tenantId,
        [SK_ATTR]: `${normalizeTypeParam("event") ?? "event"}#${eventId}`,
      };

      const names = {
        "#linesReservedById": "linesReservedById",
        "#lid": lineId,
        "#updatedAt": "updatedAt",
      } as Record<string, string>;

      const values: Record<string, unknown> = {
        ":now": nowIso(),
        ":new": newReserved,
        ":expected": reserved,
      };

      // Optimistic lock: ensure value matches what we read
      const cond = "#linesReservedById.#lid = :expected";

      const res = await ddb.send(new UpdateCommand({
        TableName: TABLE,
        Key,
        UpdateExpression: "SET #linesReservedById.#lid = :new, #updatedAt = :now",
        ConditionExpression: cond,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ReturnValues: "ALL_NEW",
      }));
      return res.Attributes as AnyRecord;
    } catch (err: any) {
      if (err?.name === "ConditionalCheckFailedException") {
        // Concurrent modification; retry from scratch
        lastErr = err;
        continue;
      }
      // Non-retryable errors (line not found, etc.)
      if (err?.code === "event_line_not_found") {
        throw err;
      }
      // Other DynamoDB errors
      throw err;
    }
  }

  // Exhausted retries; log and continue (release is not critical)
  console.warn("Failed to release capacity after max retries", { eventId, lineId, qty, cause: lastErr });
  return null as any;
}

export async function deleteObject({ tenantId, type, id }: DeleteArgs) {
  const canonicalType = normalizeTypeParam(type) ?? type;
  const Key: AnyRecord = {
    [PK_ATTR]: tenantId,
    [SK_ATTR]: `${canonicalType}#${id}`,
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
