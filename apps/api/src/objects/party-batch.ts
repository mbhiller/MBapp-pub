// apps/api/src/objects/party-batch.ts
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, BatchGetCommand } from "@aws-sdk/lib-dynamodb";
import { resolveTenantId } from "../common/tenant";
import { normalizeTypeParam } from "./type-alias";

const TABLE = process.env.MBAPP_OBJECTS_TABLE || process.env.MBAPP_TABLE || "mbapp_objects";
const PK_ATTR = process.env.MBAPP_TABLE_PK || "pk";
const SK_ATTR = process.env.MBAPP_TABLE_SK || "sk";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

function respond(status: number, body: unknown) {
  return { statusCode: status, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

/** HTTP handler — POST /objects/party:batch */
export async function handle(event: any) {
  let body: any = {};
  try { body = JSON.parse(event?.body || "{}"); } catch {}
  const partyIds: string[] = Array.isArray(body?.partyIds) ? body.partyIds : [];
  
  if (partyIds.length === 0) {
    return respond(400, { error: "BadRequest", message: "partyIds required" });
  }

  let tenantId: string;
  try {
    tenantId = resolveTenantId(event);
  } catch (err: any) {
    const status = err?.statusCode ?? 400;
    return respond(status, { error: err?.code ?? "TenantError", message: err?.message ?? "Tenant resolution failed" });
  }

  // Hard cap at 100 items per request (DynamoDB BatchGetItem limit)
  const cappedIds = partyIds.slice(0, 100);
  
  // Build keys for BatchGetItem
  const canonicalType = normalizeTypeParam("party") ?? "party";
  const keys = cappedIds.map(id => ({
    [PK_ATTR]: tenantId,
    [SK_ATTR]: `${canonicalType}#${id}`,
  }));

  // Batch get parties
  const items: any[] = [];
  
  // DynamoDB BatchGetItem supports up to 100 items, but we can chunk for safety
  const BATCH_SIZE = 100;
  for (let i = 0; i < keys.length; i += BATCH_SIZE) {
    const batchKeys = keys.slice(i, i + BATCH_SIZE);
    
    const result = await ddb.send(
      new BatchGetCommand({
        RequestItems: {
          [TABLE]: {
            Keys: batchKeys,
            ConsistentRead: true,
          },
        },
      })
    );

    const responses = result.Responses?.[TABLE] || [];
    items.push(...responses);
  }

  // Filter to only parties (in case of type mismatch) and return
  const parties = items.filter((item: any) => item?.type === canonicalType);

  return respond(200, { items: parties });
}

export default { handle };
