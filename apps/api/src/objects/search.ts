import { QueryCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, tableObjects } from "../common/ddb";
import { ok, bad, error as errResp } from "../common/responses";
import { getTenantId } from "../common/env";

const MAX_SEARCH_LIMIT = Math.max(1, parseInt(process.env.MAX_SEARCH_LIMIT ?? "50", 10) || 50);
const ALLOW_SCAN = (process.env.SEARCH_ALLOW_SCAN || "false").toLowerCase() === "true";

// base64 cursor helpers
function enc(k?: any) { if (!k) return undefined; try { return Buffer.from(JSON.stringify(k)).toString("base64"); } catch { return undefined; } }
function dec(s?: string) { if (!s) return undefined; try { return JSON.parse(Buffer.from(s, "base64").toString("utf8")); } catch { return undefined; } }

export const handler = async (evt: any) => {
  try {
    const tenantId = getTenantId(evt);
    if (!tenantId) return bad("x-tenant-id header required");

    const qs = evt?.queryStringParameters ?? {};
    const requestedLimit = Number(qs.limit) || 20;
    const limit = Math.max(1, Math.min(MAX_SEARCH_LIMIT, requestedLimit));
    const cursor = dec(qs.cursor);
    const order = (qs.order ?? "desc").toLowerCase();
    const scanIndexForward = order === "asc";

    const type     = (qs.type as string | undefined)?.trim();
    const rfidEpc  = (qs.rfidEpc as string | undefined)?.trim();
    const nameLike = (qs.name as string | undefined)?.trim();
    const namePrefix = (qs.namePrefix as string | undefined)?.trim();

    // Strategy:
    // 1) If rfidEpc → Query GSI "gsi2" (gsi2pk=tag#EPC, gsi2sk=tenant#TENANT) and filter by type if present.
    // 2) Else if (type && (nameLike || namePrefix)) → Query the type partition and FilterExpression on name.
    // 3) Else if ALLOW_SCAN → fallback Scan (nonprod only).
    // 4) Else → ask for more specific params.
    if (rfidEpc) {
      try {
        const r = await ddb.send(new QueryCommand({
          TableName: tableObjects,
          IndexName: "gsi2",
          KeyConditionExpression: "#g2pk = :pk AND #g2sk = :sk",
          ExpressionAttributeNames:  { "#g2pk": "gsi2pk", "#g2sk": "gsi2sk" },
          ExpressionAttributeValues: { ":pk": `tag#${rfidEpc}`, ":sk": `tenant#${tenantId}` },
          Limit: limit,
          ExclusiveStartKey: cursor,
          ScanIndexForward: scanIndexForward
        }));
        const items = type ? (r.Items ?? []).filter(i => i.type === type) : (r.Items ?? []);
        return ok({ items, nextCursor: enc(r.LastEvaluatedKey), prevCursor: qs.cursor || undefined, order });
      } catch (err) {
        // If the index doesn't exist, we may fall back (see below).
        console.warn("search: gsi2 query failed, index may not exist", err);
      }
    }

    if (type && (nameLike || namePrefix)) {
      const pk = `TENANT#${tenantId}#TYPE#${type}`;
      const names: Record<string, string> = { "#pk": "pk", "#sk": "sk" };
      const values: Record<string, any> = { ":pk": pk, ":skprefix": "ID#" };
      const filters: string[] = [];

      if (namePrefix) {
        names["#name"] = "name"; values[":namePrefix"] = namePrefix; filters.push("begins_with(#name, :namePrefix)");
      }
      if (nameLike) {
        names["#name"] = names["#name"] || "name"; values[":nameContains"] = nameLike; filters.push("contains(#name, :nameContains)");
      }

      const r = await ddb.send(new QueryCommand({
        TableName: tableObjects,
        KeyConditionExpression: "#pk = :pk AND begins_with(#sk, :skprefix)",
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        FilterExpression: filters.length ? filters.join(" AND ") : undefined,
        Limit: limit,
        ExclusiveStartKey: cursor,
        ScanIndexForward: scanIndexForward,
        ConsistentRead: false
      }));

      return ok({ items: r.Items ?? [], nextCursor: enc(r.LastEvaluatedKey), prevCursor: qs.cursor || undefined, order });
    }

    // Nonprod only: allow table Scan if explicitly enabled
    if (ALLOW_SCAN) {
      const names: Record<string,string> = { "#tenantId": "tenantId" };
      const values: Record<string,any> = { ":t": tenantId };
      const filters: string[] = ["#tenantId = :t"];

      if (type) { names["#type"]="type"; values[":type"]=type; filters.push("#type = :type"); }
      if (namePrefix) { names["#name"]="name"; values[":namePrefix"]=namePrefix; filters.push("begins_with(#name, :namePrefix)"); }
      if (nameLike) { names["#name"]=names["#name"]||"name"; values[":nameContains"]=nameLike; filters.push("contains(#name, :nameContains)"); }

      const r = await ddb.send(new ScanCommand({
        TableName: tableObjects,
        FilterExpression: filters.join(" AND "),
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        Limit: limit,
        ExclusiveStartKey: cursor
      }));
      return ok({ items: r.Items ?? [], nextCursor: enc(r.LastEvaluatedKey), prevCursor: qs.cursor || undefined, order });
    }

    return bad("Provide one of: rfidEpc OR (type AND name|namePrefix). Scans are disabled; set SEARCH_ALLOW_SCAN=true in nonprod to enable.");
  } catch (e: unknown) {
    console.error("SEARCH objects failed", e);
    const msg = e instanceof Error ? e.message : String(e);
    return errResp(msg);
  }
};
