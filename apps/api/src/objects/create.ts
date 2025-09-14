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

    const bodyText = evt?.isBase64Encoded ? Buffer.from(evt.body ?? "", "base64").toString("utf8") : (evt?.body ?? "{}");
    let body: any = {};
    try { body = JSON.parse(bodyText || "{}"); } catch {}

    const pick = (k: string) => (body?.[k] ?? body?.[k.toLowerCase()]);
    const name = String(pick("name") ?? "").trim();
    if (!name) return bad("name is required");

    const id = randomUUID();
    const now = Date.now();
    const sku = (pick("sku") ? String(pick("sku")).trim() : "") || undefined;
    const priceRaw = pick("price");
    const price = priceRaw != null ? Number(priceRaw) : undefined;
    const uom = (pick("uom") ? String(pick("uom")).trim() : "") || undefined;
    const taxCode = (pick("taxCode") ? String(pick("taxCode")).trim() : "") || undefined;
    const kind = parseKind(pick("kind"));

    const item: any = {
      pk: id,
      sk: `${tenantId}|${typeParam}`,
      id,
      tenant: tenantId,
      type: typeParam,
      name,
      name_lc: name.toLowerCase(),
      createdAt: now,
      updatedAt: now,
      // 🔑 ensure list GSI sees the item immediately
      gsi1pk: `${tenantId}|${typeParam}`, // e.g., DemoTenant|product
      gsi1sk: String(now),
    };
    if (sku) item.sku = sku;
    if (uom) item.uom = uom;
    if (taxCode) item.taxCode = taxCode;
    if (price != null && Number.isFinite(price)) item.price = price;
    if (kind) item.kind = kind;

    if (typeParam === "product" && sku) {
      const skuLc = sku.toLowerCase();
      await ddb.send(new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: tableObjects,
              Item: { pk: uniqPk(tenantId, skuLc), sk: `${tenantId}|product|${id}`, id, tenant: tenantId, createdAt: now },
              ConditionExpression: "attribute_not_exists(pk)",
            },
          },
          { Put: { TableName: tableObjects, Item: item } },
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
