import { GetCommand, PutCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "crypto";
import { ddb, tableObjects } from "../common/ddb";
import { ok, bad, error as errResp, conflict } from "../common/responses";
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
    try { body = JSON.parse(bodyText || "{}"); } catch { body = {}; }

    // Accept flat or { core:{...} }
    const core = body?.core && typeof body.core === "object" ? body.core : body;
    const id = (core?.id as string | undefined) || randomUUID();

    const now = new Date().toISOString();
    const name = typeof core?.name === "string" ? core.name.trim() : undefined;
    const name_lc = name?.toLowerCase();
    const price = typeof core?.price === "number" ? core.price : (core?.price ? Number(core.price) : undefined);
    const sku = typeof core?.sku === "string" ? core.sku.trim() : undefined;
    const sku_lc = sku?.toLowerCase();
    const kind = parseKind(core?.kind);
    const uom = typeof core?.uom === "string" ? core.uom.trim() : undefined;
    const taxCode = typeof core?.taxCode === "string" ? core.taxCode.trim() : undefined;

    const item: any = {
      pk: id,
      sk: `${tenantId}|${typeParam}`,
      id,
      tenant: tenantId,
      type: typeParam,
      name, name_lc,
      price, sku,
      uom, taxCode, kind,
      createdAt: now,
      updatedAt: now,
      gsi1pk: `${tenantId}|${typeParam}`,
      gsi1sk: now,
    };

    // If creating a product with SKU, assert tenant-unique SKU via token item
    if (typeParam === "product" && sku_lc) {
      // sanity: ensure not already used by an existing product
      const token = {
        pk: uniqPk(tenantId, sku_lc),
        sk: "UNIQ",
        tenant: tenantId, entity: "uniq", domain: "product", field: "sku",
        value: sku_lc, refId: id, createdAt: now,
      };
      await ddb.send(new TransactWriteCommand({
        TransactItems: [
          {
            ConditionCheck: {
              TableName: tableObjects,
              Key: { pk: token.pk, sk: token.sk },
              ConditionExpression: "attribute_not_exists(pk)",
            }
          },
          { Put: { TableName: tableObjects, Item: token } },
          { Put: { TableName: tableObjects, Item: item } },
        ],
      }));
      return ok(item);
    }

    // Non-product or product without sku: just put
    await ddb.send(new PutCommand({ TableName: tableObjects, Item: item }));
    return ok(item);
  } catch (e: any) {
    if ((e?.name || "").includes("ConditionalCheckFailed")) return conflict("SKU already exists for this tenant");
    return errResp(e);
  }
};
