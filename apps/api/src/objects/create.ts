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

    const sku = pick("sku") != null && String(pick("sku")).trim() ? String(pick("sku")).trim() : undefined;
    const uom = pick("uom") != null && String(pick("uom")).trim() ? String(pick("uom")).trim() : undefined;
    const taxCode = pick("taxCode") != null && String(pick("taxCode")).trim() ? String(pick("taxCode")).trim() : undefined;

    const priceRaw = pick("price");
    const price = priceRaw != null ? Number(priceRaw) : undefined;
    const kind = parseKind(pick("kind")); // <- only from 'kind'

    const id = randomUUID();
    const now = Date.now();
    const name_lc = name.toLowerCase();

    const item: any = {
      // keys + indexes
      pk: id,
      sk: `${tenantId}|${typeParam}`,
      gsi1pk: `${tenantId}|${typeParam}`,
      gsi1sk: String(now),
      gsi2pk: `${tenantId}|${typeParam}`,
      gsi2sk: name_lc,

      // data
      id,
      tenant: tenantId,
      type: typeParam, // <- always object class, never 'good'/'service'
      name,
      name_lc,
      createdAt: now,
      updatedAt: now,
      tags: null,
    };
    if (sku) { item.sku = sku; item.sku_lc = sku.toLowerCase(); }
    if (uom) item.uom = uom;
    if (taxCode) item.taxCode = taxCode;
    if (price != null && Number.isFinite(price)) item.price = price;
    if (kind) item.kind = kind;

    // SKU uniqueness for products
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
