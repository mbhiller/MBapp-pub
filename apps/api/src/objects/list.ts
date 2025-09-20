// apps/api/src/objects/list.ts
// GSI-backed list with fast count support:
//   GET /objects/:type?limit=&next=&sort=(asc|desc)
//   GET /objects/registration?eventId=...&count=1  ->  { count }

import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, tableObjects, GSI1_NAME } from "../common/ddb";
import { ok, bad, error as errResp } from "../common/responses";
import { getTenantId } from "../common/env";

const MAX_LIST_LIMIT = Math.max(1, parseInt(process.env.MAX_LIST_LIMIT ?? "100", 10) || 100);

type Key = { pk: string; sk: string };

function enc(k?: any) {
  if (!k) return undefined;
  try { return Buffer.from(JSON.stringify(k)).toString("base64"); }
  catch { return undefined; }
}
function dec(s?: string) {
  if (!s) return undefined;
  try { return JSON.parse(Buffer.from(String(s), "base64").toString("utf8")); }
  catch { return undefined; }
}

export const handler = async (evt: any) => {
  try {
    const tenantId = getTenantId(evt);
    if (!tenantId) return bad("x-tenant-id header required");

    const typeParam = (evt?.pathParameters?.type as string | undefined)?.trim();
    if (!typeParam) return bad("type is required");

    const qs = evt?.queryStringParameters ?? {};
    const countOnly = qs.count === "1";
    const limit = Math.min(
      MAX_LIST_LIMIT,
      Math.max(1, parseInt(String(qs.limit ?? "25"), 10) || 25)
    );
    const nextIn = dec(qs.next);

    // sort param (optional): "asc" | "desc"
    const sort = String(qs.sort ?? "").toLowerCase();
    // Default sort: products & events => DESC (newest first), others => ASC
    let scanForward = typeParam === "product" || typeParam === "event" ? false : true;
    if (sort === "asc") scanForward = true;
    if (sort === "desc") scanForward = false;

    // Optional filter for registrations
    const eventIdFilter =
      typeParam === "registration" && qs?.eventId ? String(qs.eventId) : undefined;

    // ----- Build base Query on GSI1: gsi1pk = `${tenantId}|${type}` -----
    const baseValues: Record<string, any> = { ":pk": `${tenantId}|${typeParam}` };
    const baseNames: Record<string, string> = { "#pk": "gsi1pk" };

    // COUNT branch (registrations)
    if (countOnly && typeParam === "registration") {
      const countParams: any = {
        TableName: tableObjects,
        IndexName: GSI1_NAME,
        KeyConditionExpression: "#pk = :pk",
        ExpressionAttributeValues: { ...baseValues },
        ExpressionAttributeNames: { ...baseNames },
        Select: "COUNT",
      };
      if (eventIdFilter) {
        countParams.FilterExpression = "#eventId = :e";
        countParams.ExpressionAttributeNames["#eventId"] = "eventId";
        countParams.ExpressionAttributeValues[":e"] = eventIdFilter;
      }
      const r = await ddb.send(new QueryCommand(countParams));
      return ok({ count: r?.Count ?? 0 });
    }

    // LIST branch
    const listParams: any = {
      TableName: tableObjects,
      IndexName: GSI1_NAME,
      KeyConditionExpression: "#pk = :pk",
      ExpressionAttributeValues: { ...baseValues },
      ExpressionAttributeNames: { ...baseNames },
      Limit: limit,
      ExclusiveStartKey: nextIn,
      ScanIndexForward: scanForward,
    };
    if (eventIdFilter) {
      listParams.FilterExpression = "#eventId = :e";
      listParams.ExpressionAttributeNames["#eventId"] = "eventId";
      listParams.ExpressionAttributeValues[":e"] = eventIdFilter;
    }

    const r = await ddb.send(new QueryCommand(listParams));
    const items = (r.Items || []).map((it: any) => {
      if (typeParam === "product") {
        return {
          id: it.id, type: it.type,
          name: it.name, price: it.price, sku: it.sku, uom: it.uom, taxCode: it.taxCode, kind: it.kind,
          createdAt: it.createdAt, updatedAt: it.updatedAt,
        };
      }
      return it;
    });

    return ok({ items, next: enc(r.LastEvaluatedKey as Key | undefined) });
  } catch (e) {
    return errResp(e);
  }
};
