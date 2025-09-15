import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, tableObjects, GSI1_NAME } from "../common/ddb";
import { ok, bad, error as errResp } from "../common/responses";
import { getTenantId } from "../common/env";

const MAX_LIST_LIMIT = Math.max(1, parseInt(process.env.MAX_LIST_LIMIT ?? "100", 10) || 100);

export const handler = async (evt: any) => {
  try {
    const tenantId = getTenantId(evt);
    if (!tenantId) return bad("x-tenant-id header required");

    const qs = evt?.queryStringParameters ?? {};
    const typeParam = (qs?.type as string | undefined)?.trim();
    if (!typeParam) return bad("type query param is required");

    const limit = Math.min(MAX_LIST_LIMIT, Math.max(1, parseInt(qs?.limit ?? "25", 10) || 25));
    const order = (qs?.order || "desc").toLowerCase(); // 'asc'|'desc'
    const sku = (qs?.sku as string | undefined)?.trim()?.toLowerCase();
    const q = (qs?.q as string | undefined)?.trim()?.toLowerCase();

    // Strategy: query gsi1 by tenant|type (cheap), then filter by sku or name_lc.
    // This is fine for nonprod sizes and keeps the model simple per this sprint.
    const params: any = {
      TableName: tableObjects,
      IndexName: GSI1_NAME,
      KeyConditionExpression: "gsi1pk = :gpk",
      ExpressionAttributeValues: { ":gpk": `${tenantId}|${typeParam}` },
      Limit: limit,
      ScanIndexForward: order === "asc",
    };

    const r = await ddb.send(new QueryCommand(params));
    let items = (r.Items ?? []) as any[];

    if (sku) items = items.filter(it => (it.sku ?? "").toLowerCase() === sku);
    if (q) items = items.filter(it => (it.name_lc ?? "").includes(q));

    items = items.slice(0, limit);

    const out = items.map((it: any) => ({
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

    return ok({ items, next: undefined });
  } catch (e) {
    return errResp(e);
  }
};
