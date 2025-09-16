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
    const limit = Math.min(
      MAX_LIST_LIMIT,
      Math.max(1, parseInt(String(qs.limit ?? "25"), 10) || 25)
    );
    const nextIn = dec(qs.next);

    // sort param (optional): "asc" | "desc"
    const sort = String(qs.sort ?? "").toLowerCase();

    // ✅ Default: products & events => DESC (newest first), others => ASC
    let scanForward = (typeParam === "product" || typeParam === "event") ? false : true;
    if (sort === "asc") scanForward = true;
    if (sort === "desc") scanForward = false;

    // Optional correctness filter: list registrations by eventId
    const eventIdFilter =
      typeParam === "registration" && qs?.eventId ? String(qs.eventId) : undefined;

    const params: any = {
      TableName: tableObjects,
      IndexName: GSI1_NAME,
      KeyConditionExpression: "gsi1pk = :pk",
      ExpressionAttributeValues: { ":pk": `${tenantId}|${typeParam}` },
      Limit: limit,
      ExclusiveStartKey: nextIn,
      ScanIndexForward: scanForward,
    };

    const r = await ddb.send(new QueryCommand(params));
    let items = (r.Items || []);

    if (eventIdFilter) {
      items = items.filter((it: any) => it?.eventId === eventIdFilter);
    }

    const shaped = items.map((it: any) => {
      if (typeParam === "product") {
        return {
          id: it.id, type: it.type,
          name: it.name, price: it.price, sku: it.sku, uom: it.uom, taxCode: it.taxCode, kind: it.kind,
          createdAt: it.createdAt, updatedAt: it.updatedAt,
        };
      }
      return it;
    });

    return ok({ items: shaped, next: enc(r.LastEvaluatedKey as Key | undefined) });
  } catch (e) {
    return errResp(e);
  }
};
