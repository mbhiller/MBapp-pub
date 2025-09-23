// apps/api/src/objects/list.ts
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, tableObjects } from "../common/ddb";
import { ok, bad, error as errResp } from "../common/responses";
import { getTenantId } from "../common/env";

/**
 * GET /objects/{type}?limit=&next=&by=createdAt|updatedAt&sort=asc|desc&fields=a,b,c
 * - Returns full items by default (no projection).
 * - Optional projection via ?fields=...
 * - Simple filter for registrations: ?eventId=...
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
    const limit = Math.max(1, Math.min(200, Number(qs.limit ?? 20)));
    const nextToken = typeof qs.next === "string" && qs.next ? qs.next : undefined;
    const by = (qs.by as string) === "updatedAt" ? "updatedAt" : "createdAt";
    const sort = (qs.sort as string) === "asc" ? "asc" : "desc";

    // Optional projection
    const fieldsParam = (qs.fields as string | undefined)?.trim();
    let ProjectionExpression: string | undefined;
    let ExpressionAttributeNames: Record<string, string> | undefined;

    if (fieldsParam) {
      const raw = fieldsParam.split(",").map(s => s.trim()).filter(Boolean);
      if (raw.length) {
        const base = new Set(["pk","sk","id","type","tenantId","createdAt","updatedAt"]);
        raw.forEach(f => base.add(f));
        const names: Record<string,string> = {};
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

    const gsiPk = `${tenantId}|${typeParam}`;

    const queryInput: any = {
      TableName: tableObjects,
      IndexName: GSI1_NAME,
      // We don't need aliasing here; avoid unused names errors.
      KeyConditionExpression: "gsi1pk = :pk",
      ExpressionAttributeValues: { ":pk": gsiPk },
      ScanIndexForward: sort === "asc",
      Limit: limit,
      ExclusiveStartKey: decodeNext(nextToken),
      ...(ProjectionExpression ? { ProjectionExpression } : {}),
      ...(ExpressionAttributeNames ? { ExpressionAttributeNames } : {}),
    };

    // Optional server-side filters
    const namesForFilter: Record<string,string> = {};
    const filterValues: Record<string, any> = {};
    const filterParts: string[] = [];

    if (typeParam === "registration" && typeof qs.eventId === "string" && qs.eventId.trim()) {
      namesForFilter["#eventId"] = "eventId";
      filterValues[":eid"] = qs.eventId.trim();
      filterParts.push("#eventId = :eid");
    }

    if (filterParts.length) {
      queryInput.FilterExpression = filterParts.join(" AND ");
      queryInput.ExpressionAttributeNames = {
        ...(queryInput.ExpressionAttributeNames ?? {}),
        ...namesForFilter,
      };
      queryInput.ExpressionAttributeValues = {
        ...queryInput.ExpressionAttributeValues,
        ...filterValues,
      };
    }

    const res = await ddb.send(new QueryCommand(queryInput));
    let items = (res.Items ?? []) as any[];

    if (by === "updatedAt") {
      items.sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")));
      if (sort === "asc") items.reverse();
    }

    return ok({ items, next: encodeNext(res.LastEvaluatedKey) });
  } catch (e: any) {
    return errResp(e);
  }
};
