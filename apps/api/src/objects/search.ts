// apps/api/src/objects/search.ts
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, tableObjects } from "../common/ddb";
import { ok, bad, error as errResp } from "../common/responses";
import { getTenantId } from "../common/env";

/**
 * GET /objects/{type}/search?q=&limit=&next=&fields=a,b,c
 * - Returns full items by default.
 * - If ?fields is provided, projects only those (plus base keys) with safe aliasing.
 * - Scans the tenant/type partition (gsi1) newest-first, then filters in-page by q.
 *   For large-scale or richer search, use a dedicated index or OpenSearch.
 */

const GSI1_NAME = "gsi1"; // adjust if your index name differs

function decodeNext(next?: string) {
  if (!next) return undefined;
  try { return JSON.parse(Buffer.from(next, "base64").toString("utf8")); } catch { return undefined; }
}
function encodeNext(lek: any | undefined) {
  if (!lek) return undefined;
  return Buffer.from(JSON.stringify(lek), "utf8").toString("base64");
}

export const handler = async (evt: any) => {
  try {
    const tenantId = getTenantId(evt);
    if (!tenantId) return bad("x-tenant-id header required");

    const typeParam = (evt?.pathParameters?.type as string | undefined)?.trim();
    if (!typeParam) return bad("type is required");

    const qs = evt?.queryStringParameters ?? {};
    const q = (qs.q as string | undefined)?.trim()?.toLowerCase() ?? "";
    const limit = Math.max(1, Math.min(200, Number(qs.limit ?? 20)));
    const nextToken = typeof qs.next === "string" && qs.next ? qs.next : undefined;

    // Optional projection: ?fields=name,status,location
    const fieldsParam = (qs.fields as string | undefined)?.trim();
    let ProjectionExpression: string | undefined;
    let ExpressionAttributeNames: Record<string, string> | undefined;

    if (fieldsParam) {
      const raw = fieldsParam.split(",").map(s => s.trim()).filter(Boolean);
      if (raw.length) {
        // Always include base keys
        const base = new Set(["pk", "sk", "id", "type", "tenantId", "createdAt", "updatedAt"]);
        raw.forEach(f => base.add(f));

        const names: Record<string, string> = {};
        const parts: string[] = [];
        for (const f of base) {
          const key = `#${f.replace(/[^A-Za-z0-9_]/g, "_")}`;
          names[key] = f;
          parts.push(key);
        }
        ExpressionAttributeNames = names;
        ProjectionExpression = parts.join(", ");
      }
    }

    // Query tenant/type partition on GSI1 (newest-first)
    const gsiPk = `${tenantId}|${typeParam}`;
    const res = await ddb.send(new QueryCommand({
      TableName: tableObjects,
      IndexName: GSI1_NAME,
      KeyConditionExpression: "gsi1pk = :pk",
      ExpressionAttributeValues: { ":pk": gsiPk },
      ScanIndexForward: false,
      Limit: limit,
      ExclusiveStartKey: decodeNext(nextToken),
      ...(ProjectionExpression ? { ProjectionExpression } : {}),
      ...(ExpressionAttributeNames ? { ExpressionAttributeNames } : {}),
    }));

    // In-page keyword filter (lightweight)
    let items = (res.Items ?? []) as any[];
    if (q) {
      const needle = q.toLowerCase();
      items = items.filter((it) => {
        const name_lc = String(it?.name_lc ?? it?.name ?? "").toLowerCase();
        const desc    = String(it?.description ?? "").toLowerCase();
        const loc     = String(it?.location ?? "").toLowerCase();
        const status  = String(it?.status ?? "").toLowerCase();
        return (
          name_lc.includes(needle) ||
          desc.includes(needle) ||
          loc.includes(needle) ||
          status.includes(needle)
        );
      });
    }

    return ok({
      items,
      next: encodeNext(res.LastEvaluatedKey),
    });
  } catch (e: any) {
    return errResp(e);
  }
};
