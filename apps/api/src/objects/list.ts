import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, tableObjects } from "../common/ddb";
import { ok, bad, error as errResp } from "../common/responses";
import { getTenantId } from "../common/env";

type Cursor = { pk: string; sk: string };

function encodeCursor(k: any | undefined) {
  if (!k) return undefined;
  try { return Buffer.from(JSON.stringify(k)).toString("base64"); } catch { return undefined; }
}
function decodeCursor(s: string | undefined) {
  if (!s) return undefined;
  try { return JSON.parse(Buffer.from(s, "base64").toString("utf8")); } catch { return undefined; }
}

export const handler = async (evt: any) => {
  try {
    const tenantId = getTenantId(evt);
    if (!tenantId) return bad("x-tenant-id header required");

    const type = evt?.pathParameters?.type?.trim();
    if (!type) return bad("type is required");

    const qs = evt?.queryStringParameters ?? {};
    const limit = Math.max(1, Math.min(100, Number(qs.limit) || 20));
    const cursor = decodeCursor(qs.cursor);

    // Partition: pk; Range starts with "ID#"
    const pk = `TENANT#${tenantId}#TYPE#${type}`;
    const r = await ddb.send(new QueryCommand({
      TableName: tableObjects,
      KeyConditionExpression: "#pk = :pk AND begins_with(#sk, :skprefix)",
      ExpressionAttributeNames:  { "#pk": "pk", "#sk": "sk" },
      ExpressionAttributeValues: { ":pk": pk, ":skprefix": "ID#" },
      Limit: limit,
      ExclusiveStartKey: cursor,
      ScanIndexForward: false, // newest first (if sk sortable)
      ConsistentRead: false
    }));

    return ok({
      items: r.Items ?? [],
      nextCursor: encodeCursor(r.LastEvaluatedKey)
    });
  } catch (e: unknown) {
    console.error("LIST objects failed", e);
    const msg = e instanceof Error ? e.message : String(e);
    return errResp(msg);
  }
};
