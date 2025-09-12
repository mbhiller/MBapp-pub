import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, tableObjects } from "../common/ddb";
import { ok, bad, error as errResp } from "../common/responses";
import { getTenantId } from "../common/env";

export const handler = async (evt: any) => {
  try {
    const tenantId = getTenantId(evt);
    if (!tenantId) return bad("x-tenant-id header required");

    const q = evt?.queryStringParameters ?? {};
    const type = (q.type ?? "").toString().trim();
    const sku = q.sku ? q.sku.toString().trim() : undefined;
    const term = q.q ? q.q.toString().trim().toLowerCase() : undefined;
    const limit = Math.min(Number(q.limit ?? 50), 200);

    if (!type) return bad("type query param is required");

    let items: any[] = [];

    if (sku) {
      const skuLc = sku.toLowerCase();

      // Try GSI3 first (fast exact match)
      try {
        const gsi3 = await ddb.send(new QueryCommand({
          TableName: tableObjects,
          IndexName: "gsi3_sku",
          KeyConditionExpression: "#k = :v",
          ExpressionAttributeNames: { "#k": "sku_lc" },
          ExpressionAttributeValues: { ":v": skuLc },
          Limit: limit,
        }));
        items = gsi3.Items ?? [];
      } catch (e: any) {
        // Fallback: use gsi1 and filter in-memory if GSI3 not present
        const base = await ddb.send(new QueryCommand({
          TableName: tableObjects,
          IndexName: "gsi1",
          KeyConditionExpression: "#pk = :pk",
          ExpressionAttributeNames: { "#pk": "gsi1pk" },
          ExpressionAttributeValues: { ":pk": `${tenantId}|${type}` },
          Limit: limit,
          ScanIndexForward: false,
        }));
        items = (base.Items ?? []).filter((x: any) => (x?.sku ?? "").toLowerCase() === skuLc);
      }
    } else {
      // Name contains search via GSI2 if available; otherwise use gsi1 and filter
      if (term) {
        const byName = await ddb.send(new QueryCommand({
          TableName: tableObjects,
          IndexName: "gsi2",
          KeyConditionExpression: "#pk = :pk AND begins_with(#sk, :prefix)", // cheap prefix; still filter contains below
          ExpressionAttributeNames: { "#pk": "gsi2pk", "#sk": "gsi2sk" },
          ExpressionAttributeValues: { ":pk": `${tenantId}|${type}`, ":prefix": term.slice(0, 1) },
          Limit: limit,
        })).catch(async () => {
          // fallback to gsi1 when gsi2 isn't present
          return ddb.send(new QueryCommand({
            TableName: tableObjects,
            IndexName: "gsi1",
            KeyConditionExpression: "#pk = :pk",
            ExpressionAttributeNames: { "#pk": "gsi1pk" },
            ExpressionAttributeValues: { ":pk": `${tenantId}|${type}` },
            Limit: limit,
            ScanIndexForward: false,
          }));
        });

        items = (byName.Items ?? []).filter((x: any) => (x?.name_lc ?? "").includes(term));
      } else {
        // plain list by type via gsi1
        const base = await ddb.send(new QueryCommand({
          TableName: tableObjects,
          IndexName: "gsi1",
          KeyConditionExpression: "#pk = :pk",
          ExpressionAttributeNames: { "#pk": "gsi1pk" },
          ExpressionAttributeValues: { ":pk": `${tenantId}|${type}` },
          Limit: limit,
          ScanIndexForward: false,
        }));
        items = base.Items ?? [];
      }
    }

    items = items.slice(0, limit).map((x: any) => ({
      id: x.id, tenant: x.tenant, type: x.type,
      name: x.name ?? "", sku: x.sku, price: x.price, uom: x.uom, taxCode: x.taxCode, kind: x.kind,
      updatedAt: x.updatedAt,
    }));

    return ok({ items });
  } catch (e: any) {
    return errResp(e);
  }
};
