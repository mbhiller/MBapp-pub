import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, tableObjects } from "../common/ddb";
import { ok, bad, error as errResp } from "../common/responses";
import { getTenantId } from "../common/env";

/**
 * GET /objects?type={type}&limit=20&cursor=...
 * Uses GSI1 (gsi1pk = `${tenant}|${type}`, gsi1sk DESC).
 * Env: GSI1_INDEX (defaults to "gsi1")
 */
export const handler = async (evt: any) => {
  try {
    const tenant = getTenantId(evt);
    if (!tenant) return bad("x-tenant-id header required");

    const qs = evt?.queryStringParameters ?? {};
    const type = (qs.type as string | undefined)?.trim();
    if (!type) return bad("type is required");

    const limitNum = Number.parseInt(String(qs.limit ?? "20"), 10);
    const limit = Number.isFinite(limitNum) ? Math.max(1, Math.min(100, limitNum)) : 20;

    let ExclusiveStartKey: any;
    const cursor = qs.cursor as string | undefined;
    if (cursor) {
      try { ExclusiveStartKey = JSON.parse(Buffer.from(cursor, "base64").toString("utf8")); } catch {}
    }

    const IndexName = process.env.GSI1_INDEX || "gsi1";
    const gsiPk = `${tenant}|${type}`;

    const r = await ddb.send(new QueryCommand({
      TableName: tableObjects,
      IndexName,
      KeyConditionExpression: "#p = :p",
      ExpressionAttributeNames: { "#p": "gsi1pk" },
      ExpressionAttributeValues: { ":p": gsiPk },
      Limit: limit,
      ExclusiveStartKey,
      ScanIndexForward: false,
    }));

    const nextCursor = r.LastEvaluatedKey
      ? Buffer.from(JSON.stringify(r.LastEvaluatedKey)).toString("base64")
      : undefined;

    return ok({ items: r.Items ?? [], nextCursor });
  } catch (e) {
    console.error("LIST objects failed", e);
    return errResp("Internal error");
  }
};
