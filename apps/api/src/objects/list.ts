import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, tableObjects, GSI1_NAME } from "../common/ddb";
import { ok, bad, error as errResp } from "../common/responses";
import { getTenantId } from "../common/env";

const MAX_LIST_LIMIT = Math.max(1, parseInt(process.env.MAX_LIST_LIMIT ?? "100", 10) || 100);

type Key = { pk: string; sk: string };

// simple base64 cursor helpers
function enc(k?: any) { if (!k) return undefined; try { return Buffer.from(JSON.stringify(k)).toString("base64"); } catch { return undefined; } }
function dec(s?: string) { if (!s) return undefined; try { return JSON.parse(Buffer.from(s, "base64").toString("utf8")); } catch { return undefined; } }

export const handler = async (evt: any) => {
  try {
    const tenantId = getTenantId(evt);
    if (!tenantId) return bad("x-tenant-id header required");

    const typeParam = (evt?.pathParameters?.type as string | undefined)?.trim();
    if (!typeParam) return bad("type is required");

    const qs = evt?.queryStringParameters ?? {};
    const limit = Math.min(MAX_LIST_LIMIT, Math.max(1, parseInt(qs?.limit ?? "25", 10) || 25));
    const order = (qs?.order || "desc").toLowerCase(); // 'asc'|'desc'
    const cursor = dec(qs?.cursor);

    const params: any = {
      TableName: tableObjects,
      IndexName: GSI1_NAME,
      KeyConditionExpression: "gsi1pk = :gpk",
      ExpressionAttributeValues: { ":gpk": `${tenantId}|${typeParam}` },
      Limit: limit,
      ScanIndexForward: order === "asc",
    };
    if (cursor) params.ExclusiveStartKey = cursor;

    const r = await ddb.send(new QueryCommand(params));
    const items = (r.Items ?? []).map((it: any) => ({
      id: it.id,
      tenant: it.tenant,
      type: typeParam,
      name: it.name,
      price: it.price,
      sku: it.sku,
      uom: it.uom,
      taxCode: it.taxCode,
      kind: it.kind,
      createdAt: it.createdAt,
      updatedAt: it.updatedAt,
    }));

    return ok({ items, next: enc(r.LastEvaluatedKey as Key | undefined) });
  } catch (e) {
    return errResp(e);
  }
};
