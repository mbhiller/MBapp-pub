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
    const id = (evt?.pathParameters?.id as string | undefined)?.trim();
    if (!typeParam) return bad("type is required");
    if (!id) return bad("id is required");

    const bodyText = evt?.isBase64Encoded ? Buffer.from(evt.body ?? "", "base64").toString("utf8") : (evt?.body ?? "{}");
    let body: any = {};
    try { body = JSON.parse(bodyText || "{}"); } catch {}
    const pick = (k: string) => (body?.[k] ?? body?.[k.toLowerCase()]);

    const curRes = await ddb.send(new GetCommand({
      TableName: tableObjects,
      Key: { pk: id, sk: `${tenantId}|${typeParam}` },
    }));
    const cur = curRes.Item as Record<string, any> | undefined;
    if (!cur) return notfound("object not found");

    const now = Date.now();
    const next: Record<string, any> = {
      updatedAt: now,
      // 🔑 keep list index current
      gsi1pk: `${tenantId}|${typeParam}`,
      gsi1sk: String(now),
    };

    // Repair legacy rows where type was 'good'|'service'
    if (!cur.type || cur.type === "good" || cur.type === "service") {
      next["type"] = typeParam;
      if ((cur.type === "good" || cur.type === "service") && cur.kind == null) next["kind"] = cur.type;
    }

    const name = (pick("name") ? String(pick("name")).trim() : "") || undefined;
    if (name) { next["name"] = name; next["name_lc"] = name.toLowerCase(); }

    const sku = (pick("sku") ? String(pick("sku")).trim() : "") || undefined;
    const uom = (pick("uom") ? String(pick("uom")).trim() : "") || undefined;
    if (uom) next["uom"] = uom;

    const taxCode = (pick("taxCode") ? String(pick("taxCode")).trim() : "") || undefined;
    if (taxCode) next["taxCode"] = taxCode;

    const priceRaw = pick("price");
    if (priceRaw !== undefined && priceRaw !== null) {
      const n = typeof priceRaw === "string" ? Number(priceRaw) : priceRaw;
      if (Number.isFinite(n)) next["price"] = Number(n);
    }

    const kind = parseKind(pick("kind"));
    if (kind) next["kind"] = kind;

    const parts = buildUpdateParts(next, { sku });

    if (typeParam === "product" && sku && sku !== cur.sku) {
      const skuLc = sku.toLowerCase();
      const oldSkuLc = (cur.sku ?? "").toLowerCase();
      const txItems: any[] = [];
      if (oldSkuLc) {
        txItems.push({
          Delete: { TableName: tableObjects, Key: { pk: uniqPk(tenantId, oldSkuLc), sk: `${tenantId}|product|${id}` } },
        });
      }
      txItems.push({
        Put: {
          TableName: tableObjects,
          Item: { pk: uniqPk(tenantId, skuLc), sk: `${tenantId}|product|${id}`, id, tenant: tenantId, updatedAt: now },
          ConditionExpression: "attribute_not_exists(pk)",
        },
      });
      txItems.push({
        Update: {
          TableName: tableObjects,
          Key: { pk: id, sk: `${tenantId}|${typeParam}` },
          UpdateExpression: parts.expr,
          ExpressionAttributeNames: parts.names,
          ExpressionAttributeValues: parts.values,
          ReturnValues: "ALL_NEW",
        },
      });
      await ddb.send(new TransactWriteCommand({ TransactItems: txItems }));
      return ok({ id, type: typeParam, ...next });
    }

    const resp = await ddb.send(new UpdateCommand({
      TableName: tableObjects,
      Key: { pk: id, sk: `${tenantId}|${typeParam}` },
      UpdateExpression: parts.expr,
      ExpressionAttributeNames: parts.names,
      ExpressionAttributeValues: parts.values,
      ReturnValues: "ALL_NEW",
    }));

    return ok({ id, type: typeParam, ...(resp.Attributes ?? {}) });
  } catch (e: any) {
    if ((e?.name || "").includes("ConditionalCheckFailed")) return bad("SKU already exists for this tenant");
    return errResp(e);
  }
};

function buildUpdateParts(
  next: Record<string, any>,
  extras?: { sku?: string }
): { expr: string; names: Record<string,string>; values: Record<string,any> } {
  const sets: string[] = [];
  const names: Record<string,string> = {};
  const values: Record<string,any> = {};

  const set = (k: string, v: any) => {
    const nk = `#${k}`;
    const vk = `:${k}`;
    sets.push(`${nk} = ${vk}`);
    names[nk] = k;
    values[vk] = v;
  };

  set("updatedAt", next.updatedAt);

  if (next.name) { set("name", next.name); set("name_lc", next.name_lc); }
  if (extras?.sku) set("sku", extras.sku);
  if (next.uom) set("uom", next.uom);
  if (next.taxCode) set("taxCode", next.taxCode);
  if (next.price != null) set("price", next.price);
  if (next.kind) set("kind", next.kind);
  if (next.type) set("type", next.type);

  // 🔑 keep list GSI current
  if (next.gsi1pk) set("gsi1pk", next.gsi1pk);
  if (next.gsi1sk) set("gsi1sk", next.gsi1sk);

  return { expr: "SET " + sets.join(", "), names, values };
}
