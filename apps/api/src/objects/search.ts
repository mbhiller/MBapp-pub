import { QueryCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, tableObjects } from "../common/ddb";
import { ok, bad, error as errResp } from "../common/responses";
import { getTenantId } from "../common/env";

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

    const qs = evt?.queryStringParameters ?? {};
    const limit  = Math.max(1, Math.min(50, Number(qs.limit) || 20));
    const cursor = decodeCursor(qs.cursor);
    const type   = (qs.type as string | undefined)?.trim();
    const rfidEpc = (qs.rfidEpc as string | undefined)?.trim();
    const nameLike = (qs.name as string | undefined)?.trim();

    // Strategy:
    // 1) If rfidEpc provided, try GSI (gsi2pk = tag#{epc}, gsi2sk = tenant#{tenant}) and fallback to Scan if the index doesn't exist.
    // 2) Else if name provided, Scan with contains(name, :name) — acceptable for nonprod/small datasets.
    // 3) Optionally filter by type if provided.

    if (rfidEpc) {
      // Attempt Query on GSI named "gsi2" (change if your index name differs)
      try {
        const r = await ddb.send(new QueryCommand({
          TableName: tableObjects,
          IndexName: "gsi2",
          KeyConditionExpression: "#g2pk = :pk AND #g2sk = :sk",
          ExpressionAttributeNames:  { "#g2pk": "gsi2pk", "#g2sk": "gsi2sk" },
          ExpressionAttributeValues: { ":pk": `tag#${rfidEpc}`, ":sk": `tenant#${tenantId}` },
          Limit: limit,
          ExclusiveStartKey: cursor
        }));
        const items = type ? (r.Items ?? []).filter(i => i.type === type) : (r.Items ?? []);
        return ok({ items, nextCursor: encodeCursor(r.LastEvaluatedKey) });
      } catch (e) {
        // fall through to Scan
        console.warn("search.ts: gsi2 Query failed, falling back to Scan", e);
      }
    }

    // Scan fallback (name contains / tag equality)
    const names: Record<string,string> = { "#tenantId": "tenantId" };
    const exprs: string[] = ["#tenantId = :t"];
    const values: Record<string,any> = { ":t": tenantId };

    if (type) {
      names["#type"] = "type";
      exprs.push("#type = :type");
      values[":type"] = type;
    }
    if (rfidEpc) {
      names["#tags"] = "tags";
      exprs.push("#tags.rfidEpc = :epc");
      values[":epc"] = rfidEpc;
    }
    if (nameLike) {
      names["#name"] = "name";
      exprs.push("contains(#name, :name)");
      values[":name"] = nameLike;
    }

    const r = await ddb.send(new ScanCommand({
      TableName: tableObjects,
      FilterExpression: exprs.join(" AND "),
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      Limit: limit,
      ExclusiveStartKey: cursor
    }));

    return ok({ items: r.Items ?? [], nextCursor: encodeCursor(r.LastEvaluatedKey) });
  } catch (e: unknown) {
    console.error("SEARCH objects failed", e);
    const msg = e instanceof Error ? e.message : String(e);
    return errResp(msg);
  }
};
