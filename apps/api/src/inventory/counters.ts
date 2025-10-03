// apps/api/src/inventory/counters.ts
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand, GetCommand } from "@aws-sdk/lib-dynamodb";

const TABLE = process.env.MBAPP_COUNTERS_TABLE || "mbapp_counters";
// IMPORTANT: These must match the actual key attribute names on the COUNTERS table.
const PK    = process.env.MBAPP_TABLE_PK || "pk";
const SK    = process.env.MBAPP_TABLE_SK || "sk";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

function key(tenantId: string, itemId: string) {
  return { [PK]: tenantId, [SK]: `inventory#${itemId}` } as Record<string, any>;
}

function tenantFrom(event: any): string {
  return (
    event?.requestContext?.authorizer?.mbapp?.tenantId ||
    event?.tenantId ||
    ""
  );
}

/**
 * Atomically apply deltas to onHand / reserved counters.
 * - Creates the item if it doesn't exist (ADD works on missing attrs).
 * - Updates timestamps every call.
 */
export async function upsertDelta(
  event: any,
  itemId: string,
  dOnHand: number,
  dReserved: number
) {
  const tenantId = tenantFrom(event);
  if (!tenantId) throw new Error("tenantId missing in authorizer");

  const Key = key(tenantId, itemId);
  const now = new Date().toISOString();

  try {
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE,
        Key,
        // ADD for numeric increments; SET for timestamps
        UpdateExpression: [
          "SET #updatedAt = :now",
          "    , #createdAt = if_not_exists(#createdAt, :now)",
          "ADD #onHand :doh, #reserved :drv",
        ].join(" "),
        ExpressionAttributeNames: {
          "#updatedAt": "updatedAt",
          "#createdAt": "createdAt",
          "#onHand": "onHand",
          "#reserved": "reserved",
        },
        ExpressionAttributeValues: {
          ":now": now,
          ":doh": Number(dOnHand || 0),
          ":drv": Number(dReserved || 0),
        },
        ReturnValues: "NONE",
      })
    );
  } catch (e: any) {
    // Surface actionable context to caller/logs
    const err = new Error(
      `counters.upsertDelta failed: table=${TABLE} pkAttr=${PK} skAttr=${SK} tenant=${tenantId} item=${itemId} dOnHand=${dOnHand} dReserved=${dReserved} — ${e?.message || e}`
    );
    (err as any).cause = e;
    throw err;
  }
}

export async function getOnHand(tenantId: string, itemId: string) {
  const res = await ddb.send(
    new GetCommand({ TableName: TABLE, Key: key(tenantId, itemId) })
  );
  const onHand = Number(res.Item?.onHand || 0);
  const reserved = Number(res.Item?.reserved || 0);
  const available = Math.max(0, onHand - reserved);
  return { onHand, reserved, available, raw: res.Item || null };
}
