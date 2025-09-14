import { GetCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
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
    const id = (evt?.pathParameters?.id as string | undefined)?.trim();
    if (!typeParam) return bad("type is required");
    if (!id) return bad("id is required");

    const bodyText = evt?.isBase64Encoded ? Buffer.from(evt.body ?? "", "base64").toString("utf8") : (evt?.body ?? "{}");
    let patch: any = {};
    try { patch = JSON.parse(bodyText || "{}"); } catch { patch = {}; }

    // Normalize fields we support
    const now = new Date().toISOString();
    const name = typeof patch?.name === "string" ? patch.name.trim() : undefined;
    const name_lc = name?.toLowerCase();
    const price = typeof patch?.price === "number" ? patch.price : (patch?.price ? Number(patch.price) : undefined);
    const sku = typeof patch?.sku === "string" ? patch.sku.trim() : undefined;
    const sku_lc = sku?.toLowerCase();
    const uom = typeof patch?.uom === "string" ? patch.uom.trim() : undefined;
    const taxCode = typeof patch?.taxCode === "string" ? patch.taxCode.trim() : undefined;
    const kind = parseKind(patch?.kind);

    // Load current to handle SKU token migration and to guard tenant/type
    const curRes = await ddb.send(new GetCommand({
      TableName: tableObjects,
      Key: { pk: id, sk: `${tenantId}|${typeParam}` },
    }));
    const cur = curRes.Item as any;
    if (!cur) return bad("object not found for tenant/type");

    const setParts: string[] = ["updatedAt = :now", "gsi1sk = :now"];
    const names: Record<string,string> = {};
    const values: Record<string,any> = { ":now": now };

    function setIf(field: string, value: any, attrName?: string) {
      if (value === undefined) return;
      if (attrName && attrName.startsWith("#")) {
        names[attrName] = field;
        setParts.push(`${attrName} = :${field}`);
        values[`:${field}`] = value;
      } else {
        setParts.push(`${field} = :${field}`);
        values[`:${field}`] = value;
      }
    }

    setIf("name", name);
    setIf("name_lc", name_lc);
    setIf("price", price);
    setIf("sku", sku);
    setIf("uom", uom);
    setIf("taxCode", taxCode);
    setIf("kind", kind);

    // If SKU changed on a product, we must migrate the uniq token atomically
    const curSkuLc = (cur?.sku ?? "").toLowerCase() || undefined;
    const willChangeSku = typeParam === "product" && sku_lc && sku_lc !== curSkuLc;

    if (willChangeSku) {
      const newToken = { pk: uniqPk(tenantId, sku_lc!), sk: "UNIQ", tenant: tenantId, entity: "uniq", domain: "product", field: "sku", value: sku_lc, refId: id, createdAt: now };
      const oldTokenKey = curSkuLc ? { pk: uniqPk(tenantId, curSkuLc), sk: "UNIQ" } : undefined;

      await ddb.send(new TransactWriteCommand({
        TransactItems: [
          { // assert new token is free
            ConditionCheck: { TableName: tableObjects, Key: { pk: newToken.pk, sk: newToken.sk }, ConditionExpression: "attribute_not_exists(pk)" }
          },
          ...(oldTokenKey ? [{ Delete: { TableName: tableObjects, Key: oldTokenKey } }] : []),
          { Put: { TableName: tableObjects, Item: newToken } },
          {
            Update: {
              TableName: tableObjects,
              Key: { pk: id, sk: `${tenantId}|${typeParam}` },
              UpdateExpression: `SET ${setParts.join(", ")}`,
              ExpressionAttributeNames: Object.keys(names).length ? names : undefined,
              ExpressionAttributeValues: values,
            }
          },
        ],
      }));
      return ok({ ...cur, ...patch, updatedAt: now, sku });
    }

    // Simple update
    const r = await ddb.send(new UpdateCommand({
      TableName: tableObjects,
      Key: { pk: id, sk: `${tenantId}|${typeParam}` },
      UpdateExpression: `SET ${setParts.join(", ")}`,
      ExpressionAttributeNames: Object.keys(names).length ? names : undefined,
      ExpressionAttributeValues: values,
      ReturnValues: "ALL_NEW",
    }));
    return ok(r.Attributes);
  } catch (e: any) {
    if ((e?.name || "").includes("ConditionalCheckFailed")) return conflict("SKU already exists for this tenant");
    return errResp(e);
  }
};
