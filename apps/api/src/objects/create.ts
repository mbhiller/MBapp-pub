import { PutCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "crypto";
import { ddb, tableObjects } from "../common/ddb";
import { ok, bad, error as errResp } from "../common/responses";
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
    if (!typeParam) return bad("type is required");

    let body: any = {};
    if (evt?.body) {
      try { body = typeof evt.body === "string" ? JSON.parse(evt.body) : evt.body; }
      catch { return bad("invalid json body"); }
    }

    const pick = (k: string) => body?.[k] ?? body?.core?.[k];

    const name = String(pick("name") ?? "").trim();
    if (!name) return bad("name is required");

    const skuRaw   = pick("sku");
    const uomRaw   = pick("uom");
    const taxRaw   = pick("taxCode");
    const priceRaw = pick("price");
    const kindVal  = parseKind(pick("kind"));

    const sku = skuRaw != null && String(skuRaw).trim() ? String(skuRaw).trim() : undefined;
    const uom = uomRaw != null && String(uomRaw).trim() ? String(uomRaw).trim() : undefined;
    const taxCode = taxRaw != null && String(taxRaw).trim() ? String(taxRaw).trim() : undefined;

    const priceNum = typeof priceRaw === "string" ? Number(priceRaw) : priceRaw;
    const price = priceNum != null && Number.isFinite(priceNum) ? Number(priceNum) : undefined;

    const id = randomUUID();
    const now = Date.now();
    const name_lc = name.toLowerCase();

    const item: any = {
      pk: id,
      sk: `${tenantId}|${typeParam}`,
      gsi1pk: `${tenantId}|${typeParam}`,
      gsi1sk: String(now),

      // Optional name index (GSI2)
      gsi2pk: `${tenantId}|${typeParam}`,
      gsi2sk: name_lc,

      id,
      tenant: tenantId,
      type: typeParam,
      name,
      name_lc,
      createdAt: now,
      updatedAt: now,
      tags: null,
    };
    if (sku) { item.sku = sku; item.sku_lc = sku.toLowerCase(); } // <-- needed for GSI3
    if (uom) item.uom = uom;
    if (taxCode) item.taxCode = taxCode;
    if (price != null) item.price = price;
    if (kindVal) item.kind = kindVal;

    // Enforce SKU uniqueness for products
    if (typeParam === "product" && sku) {
      const skuLc = sku.toLowerCase();
      await ddb.send(new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: tableObjects,
              Item: { pk: uniqPk(tenantId, skuLc), sk: "UNIQ", tenant: tenantId, refType: typeParam, refId: id, createdAt: now },
              ConditionExpression: "attribute_not_exists(pk)",
            },
          },
          {
            Put: {
              TableName: tableObjects,
              Item: item,
              ConditionExpression: "attribute_not_exists(pk)",
            },
          },
        ],
      }));
      return ok(item);
    }

    await ddb.send(new PutCommand({ TableName: tableObjects, Item: item }));
    return ok(item);
  } catch (e: any) {
    if ((e?.name || "").includes("ConditionalCheckFailed")) return bad("SKU already exists for this tenant");
    return errResp(e);
  }
};
