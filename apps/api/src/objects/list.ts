import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, tableObjects } from "../common/ddb";
import { ok, bad, error as errResp } from "../common/responses";
import { getTenantId } from "../common/env";

const MAX_LIST_LIMIT = Math.max(1, parseInt(process.env.MAX_LIST_LIMIT ?? "100", 10) || 100);

type Key = { pk: string; sk: string };

function enc(k?: any) { if (!k) return undefined; try { return Buffer.from(JSON.stringify(k)).toString("base64"); } catch { return undefined; } }
function dec(s?: string) { if (!s) return undefined; try { return JSON.parse(Buffer.from(s, "base64").toString("utf8")); } catch { return undefined; } }

export const handler = async (evt: any) => {
  try {
    const tenantId = getTenantId(evt);
    if (!tenantId) return bad("x-tenant-id header required");

    const type = evt?.pathParameters?.type?.trim();
    if (!type) return bad("type is required");

    const qs = evt?.queryStringParameters ?? {};
    const requestedLimit = Number(qs.limit) || 20;
    const limit = Math.max(1, Math.min(MAX_LIST_LIMIT, requestedLimit));
    const cursor = dec(qs.cursor);
    const order = (qs.order ?? "desc").toLowerCase(); // 'asc' | 'desc'
    const scanIndexForward = order === "asc";

    // Optional name filters
    const namePrefix = (qs.namePrefix as string | undefined)?.trim();
    const nameContains = (qs.name as string | undefined)?.trim();

    const pk = `TENANT#${tenantId}#TYPE#${type}`;

    const names: Record<string, string> = { "#pk": "pk", "#sk": "sk" };
    const values: Record<string, any> = { ":pk": pk, ":skprefix": "ID#" };

    let filterExpr: string | undefined;
    const filters: string[] = [];

    if (namePrefix) {
      names["#name"] = "name";
      values[":namePrefix"] = namePrefix;
      filters.push("begins_with(#name, :namePrefix)");
    }
    if (nameContains) {
      names["#name"] = names["#name"] || "name";
      values[":nameContains"] = nameContains;
      filters.push("contains(#name, :nameContains)");
    }
    if (filters.length) filterExpr = filters.join(" AND ");

    const r = await ddb.send(new QueryCommand({
      TableName: tableObjects,
      KeyConditionExpression: "#pk = :pk AND begins_with(#sk, :skprefix)",
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      FilterExpression: filterExpr,
      Limit: limit,
      ExclusiveStartKey: cursor as Key | undefined,
      ScanIndexForward: scanIndexForward,
      ConsistentRead: false
    }));

    return ok({
      items: r.Items ?? [],
      nextCursor: enc(r.LastEvaluatedKey),
      // For “reverse pagination”, clients usually keep a cursor stack.
      // We also echo the incoming cursor so UIs can implement a back-stack easily.
      prevCursor: qs.cursor || undefined,
      order
    });
  } catch (e: unknown) {
    console.error("LIST objects failed", e);
    const msg = e instanceof Error ? e.message : String(e);
    return errResp(msg);
  }
};
