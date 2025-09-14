import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, tableObjects } from "../common/ddb";
import { ok, bad, error as errResp } from "../common/responses";
import { getTenantId } from "../common/env";

type Order = "asc" | "desc";

function b64e(o: any) { return Buffer.from(JSON.stringify(o), "utf8").toString("base64"); }
function b64d(s?: string) {
  if (!s) return undefined;
  try { return JSON.parse(Buffer.from(s, "base64").toString("utf8")); } catch { return undefined; }
}

export const handler = async (evt: any) => {
  try {
    const tenantId = getTenantId(evt);
    if (!tenantId) return bad("x-tenant-id header required");

    const qs = evt?.queryStringParameters ?? {};
    const type = String(qs.type ?? "").trim();
    if (!type) return bad("type query param is required");

    const limit = Math.max(1, Math.min(100, Number(qs.limit ?? 50)));
    const cursor = b64d(qs.cursor);
    const order: Order = (String(qs.order ?? "desc").toLowerCase() === "asc" ? "asc" : "desc");

    // List by GSI1: gsi1pk = tenant|type, gsi1sk = updatedAt (stringified)
    const params: any = {
      TableName: tableObjects,
      IndexName: "gsi1",
      KeyConditionExpression: "#pk = :pk",
      ExpressionAttributeNames: { "#pk": "gsi1pk" },
      ExpressionAttributeValues: { ":pk": `${tenantId}|${type}` },
      Limit: limit,
      ScanIndexForward: order === "asc", // asc = oldest first, desc = newest first
    };
    if (cursor) params.ExclusiveStartKey = cursor;

    const res = await ddb.send(new QueryCommand(params));
    const items = (res.Items ?? []).map((it: any) => ({
      id: it.id,
      tenant: it.tenant,
      type: it.type,
      name: it.name,
      sku: it.sku,
      price: it.price,
      uom: it.uom,
      taxCode: it.taxCode,
      kind: it.kind,
      createdAt: it.createdAt,
      updatedAt: it.updatedAt,
    }));

    return ok({ items, nextCursor: res.LastEvaluatedKey ? b64e(res.LastEvaluatedKey) : undefined });
  } catch (e: any) {
    return errResp(e);
  }
};
