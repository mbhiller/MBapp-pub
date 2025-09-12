import { GetCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, tableObjects } from "../common/ddb";
import { ok, bad, notfound, error as errResp } from "../common/responses";
import { getTenantId } from "../common/env";

const uniqPk = (tenant: string, skuLc: string) => `UNIQ#${tenant}#product#SKU#${skuLc}`;

function parseKind(input: unknown): "good" | "service" | undefined {
  if (typeof input !== "string") return undefined;
  const k = input.trim().toLowerCase();
  return k === "good" || k === "service" ? k : undefined;
}

export const handler = async (evt: any) => {
  try {
    const tenantId = getTenantId(evt);
    if (!tenantId) return bad("x-tenant-id header required");

    const typeParam = (evt?.pathParameters?.type as string | undefined)?.trim();
    const id        = (evt?.pathParameters?.id as string | undefined)?.trim();
    if (!typeParam) return bad("type is required");
    if (!id) return bad("id is required");

    let body: any = {};
    if (evt?.body) {
      try { body = typeof evt.body === "string" ? JSON.parse(evt.body) : evt.body; }
      catch { return bad("invalid json body"); }
    }
    const pick = (k: string) => body?.[k] ?? body?.core?.[k];

    const curResp = await ddb.send(new GetCommand({
      TableName: tableObjects,
      Key: { pk: id, sk: `${tenantId}|${typeParam}` },
    }));
    const cur = curResp.Item as Record<string, any> | undefined;
    if (!cur) return notfound("object not found");

    const now = Date.now();
    const next: Record<string, any> = { updatedAt: now };

    const name = pick("name");
    if (typeof name === "string" && name.trim()) {
      const nm = name.trim();
      next["name"] = nm;
      next["name_lc"] = nm.toLowerCase();
      next["gsi2pk"] = `${tenantId}|${typeParam}`;
      next["gsi2sk"] = nm.toLowerCase();
    }

    const sku = pick("sku");
    if (sku != null && String(sku).trim()) {
      const s = String(sku).trim();
      next["sku"] = s;
      next["sku_lc"] = s.toLowerCase(); // <-- keep GSI3 current
    }

    const uom = pick("uom");
    if (uom != null && String(uom).trim()) next["uom"] = String(uom).trim();

    const tax = pick("taxCode");
    if (tax != null && String(tax).trim()) next["taxCode"] = String(tax).trim();

    const kindVal = parseKind(pick("kind"));
    if (kindVal) next["kind"] = kindVal;

    const priceRaw = pick("price");
    if (priceRaw !== undefined && priceRaw !== null) {
      const n = typeof priceRaw === "string" ? Number(priceRaw) : priceRaw;
      if (Number.isFinite(n)) next["price"] = Number(n);
    }

    if (Object.keys(next).length === 1) {
      return ok({ id, type: typeParam, updated: false, updatedAt: now });
    }

    const names: Record<string, string> = {};
    const values: Record<string, any> = {};
    const sets: string[] = [];
    Object.entries(next).forEach(([k, v], i) => {
      const nk = `#n${i}`, vk = `:v${i}`;
      names[nk] = k;
      values[vk] = v;
      sets.push(`${nk} = ${vk}`);
    });

    const key = { pk: id, sk: `${tenantId}|${typeParam}` };
    const curSkuLc = cur?.sku ? String(cur.sku).toLowerCase() : undefined;
    const newSkuLc = next.sku ? String(next.sku).toLowerCase() : undefined;

    if (typeParam === "product" && newSkuLc && newSkuLc !== curSkuLc) {
      await ddb.send(new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: tableObjects,
              Item: {
                pk: uniqPk(tenantId, newSkuLc),
                sk: "UNIQ",
                tenant: tenantId,
                refType: typeParam,
                refId: id,
                createdAt: now,
              },
              ConditionExpression: "attribute_not_exists(pk)",
            },
          },
          {
            Update: {
              TableName: tableObjects,
              Key: key,
              UpdateExpression: "SET " + sets.join(", "),
              ExpressionAttributeNames: names,
              ExpressionAttributeValues: values,
            },
          },
          ...(curSkuLc
            ? [{
                Delete: {
                  TableName: tableObjects,
                  Key: { pk: uniqPk(tenantId, curSkuLc), sk: "UNIQ" },
                },
              }]
            : []),
        ],
      }));

      const reread = await ddb.send(new GetCommand({ TableName: tableObjects, Key: key }));
      const item = { id, type: typeParam, updatedAt: now, ...(reread.Item ?? {}) };
      return ok(item);
    }

    const resp = await ddb.send(new UpdateCommand({
      TableName: tableObjects,
      Key: key,
      UpdateExpression: "SET " + sets.join(", "),
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ReturnValues: "ALL_NEW",
    }));

    const out = { id, type: typeParam, updatedAt: now, ...(resp.Attributes ?? {}) };
    return ok(out);
  } catch (e: any) {
    if ((e?.name || "").includes("ConditionalCheckFailed")) {
      return bad("SKU already exists for this tenant");
    }
    return errResp(e);
  }
};
