// apps/api/src/inventory/counters.ts
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand, GetCommand } from "@aws-sdk/lib-dynamodb";

const TABLE = process.env.MBAPP_COUNTERS_TABLE || "mbapp_counters";
// You confirmed the counters table is composite { pk, sk }
const PK = process.env.MBAPP_COUNTERS_PK || "pk";
const SK = process.env.MBAPP_COUNTERS_SK || "sk";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

function makeKey(tenantId: string, itemId: string) {
  if (!tenantId || !String(tenantId).trim()) {
    const e: any = new Error("COUNTERS_KEY_MISSING_TENANT");
    e.code = "COUNTERS_KEY_MISSING_TENANT";
    throw e;
  }
  if (!itemId || !String(itemId).trim()) {
    const e: any = new Error("COUNTERS_KEY_MISSING_ITEM");
    e.code = "COUNTERS_KEY_MISSING_ITEM";
    throw e;
  }
  return { [PK]: tenantId, [SK]: `inventory#${itemId}` } as Record<string, any>;
}

/**
 * Safe counters update with OCC (no negatives; reserved ≤ onHand).
 * NOTE: tenantId is explicit—no reliance on Lambda event shape.
 */
export async function upsertDelta(
  tenantId: string,
  itemId: string,
  dOnHand: number,
  dReserved: number
) {
  const Key = makeKey(tenantId, itemId);
  const now = new Date().toISOString();

  // 1) Initialize attrs if missing (idempotent)
  await ddb.send(new UpdateCommand({
    TableName: TABLE,
    Key,
    UpdateExpression:
      "SET #onHand = if_not_exists(#onHand, :zero), " +
      "#reserved = if_not_exists(#reserved, :zero), " +
      "#updatedAt = :now, #createdAt = if_not_exists(#createdAt, :now)",
    ExpressionAttributeNames: {
      "#onHand": "onHand",
      "#reserved": "reserved",
      "#updatedAt": "updatedAt",
      "#createdAt": "createdAt",
    },
    ExpressionAttributeValues: { ":zero": 0, ":now": now },
    ReturnValues: "NONE",
  }));

  // 2) Read snapshot
  const snap = await ddb.send(new GetCommand({ TableName: TABLE, Key }));
  const curOnHand = Number(snap.Item?.onHand ?? 0);
  const curReserved = Number(snap.Item?.reserved ?? 0);

  // 3) Validate next state
  const nextOnHand = curOnHand + Number(dOnHand || 0);
  const nextReserved = curReserved + Number(dReserved || 0);
  if (nextOnHand < 0 || nextReserved < 0 || nextReserved > nextOnHand) {
    const err: any = new Error(
      `INSUFFICIENT_QTY: nextOnHand=${nextOnHand} nextReserved=${nextReserved} (cur onHand=${curOnHand} reserved=${curReserved}, deltas ${dOnHand}/${dReserved})`
    );
    err.code = "INSUFFICIENT_QTY";
    throw err;
  }

  // 4) Apply with optimistic concurrency
  try {
    await ddb.send(new UpdateCommand({
      TableName: TABLE,
      Key,
      // order: SET ... ADD ...
      UpdateExpression: "SET #updatedAt = :now ADD #onHand :doh, #reserved :drv",
      ConditionExpression: "#onHand = :curOnHand AND #reserved = :curReserved",
      ExpressionAttributeNames: {
        "#onHand": "onHand",
        "#reserved": "reserved",
        "#updatedAt": "updatedAt",
      },
      ExpressionAttributeValues: {
        ":now": now,
        ":doh": Number(dOnHand || 0),
        ":drv": Number(dReserved || 0),
        ":curOnHand": curOnHand,
        ":curReserved": curReserved,
      },
      ReturnValues: "NONE",
    }));
  } catch (e: any) {
    const name = String(e?.name || "");
    const err = new Error(`counters.upsertDelta OCC failed: ${e?.message || e}`);
    (err as any).cause = e;
    if (name.includes("ConditionalCheckFailed")) (err as any).code = "OCC_CONFLICT";
    throw err;
  }
}

export async function getOnHand(tenantId: string, itemId: string) {
  const Key = makeKey(tenantId, itemId);
  const res = await ddb.send(new GetCommand({ TableName: TABLE, Key }));
  const onHand = Number(res.Item?.onHand || 0);
  const reserved = Number(res.Item?.reserved || 0);
  const available = Math.max(0, onHand - reserved);
  return { onHand, reserved, available, raw: res.Item || null };
}
