"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
// apps/api/src/objects/update.ts
const lib_dynamodb_1 = require("@aws-sdk/lib-dynamodb");
const ddb_1 = require("../common/ddb");
const responses_1 = require("../common/responses");
const env_1 = require("../common/env");
const uniqPk = (tenant, skuLc) => `UNIQ#${tenant}#product#SKU#${skuLc}`;
function parseKind(input) {
    if (typeof input !== "string")
        return undefined;
    const k = input.trim().toLowerCase();
    return k === "good" || k === "service" ? k : undefined;
}
const handler = async (evt) => {
    try {
        const tenantId = (0, env_1.getTenantId)(evt);
        if (!tenantId)
            return (0, responses_1.bad)("x-tenant-id header required");
        const typeParam = evt?.pathParameters?.type?.trim();
        const id = evt?.pathParameters?.id?.trim();
        if (!typeParam)
            return (0, responses_1.bad)("type is required");
        if (!id)
            return (0, responses_1.bad)("id is required");
        const bodyText = evt?.isBase64Encoded
            ? Buffer.from(evt.body ?? "", "base64").toString("utf8")
            : (evt?.body ?? "{}");
        let patch = {};
        try {
            patch = JSON.parse(bodyText || "{}");
        }
        catch {
            patch = {};
        }
        const now = new Date().toISOString();
        // Normalize fields
        const name = typeof patch?.name === "string" ? patch.name.trim() : undefined;
        const name_lc = name?.toLowerCase();
        const price = typeof patch?.price === "number"
            ? patch.price
            : (patch?.price != null ? Number(patch.price) : undefined);
        const sku = typeof patch?.sku === "string" ? patch.sku.trim() : undefined;
        const sku_lc = sku?.toLowerCase();
        const uom = typeof patch?.uom === "string" ? patch.uom.trim() : undefined;
        const taxCode = typeof patch?.taxCode === "string" ? patch.taxCode.trim() : undefined;
        const kind = parseKind(patch?.kind);
        // Load current item (validate tenant/type and prep for SKU token migration)
        const curRes = await ddb_1.ddb.send(new lib_dynamodb_1.GetCommand({
            TableName: ddb_1.tableObjects,
            Key: { pk: id, sk: `${tenantId}|${typeParam}` },
        }));
        const cur = curRes.Item;
        if (!cur)
            return (0, responses_1.bad)("object not found for tenant/type");
        // Build UpdateExpression
        const setParts = ["updatedAt = :now", "gsi1sk = :now"];
        const values = { ":now": now };
        const setIf = (field, value) => {
            if (value === undefined)
                return;
            setParts.push(`${field} = :${field}`);
            values[`:${field}`] = value;
        };
        setIf("name", name);
        setIf("name_lc", name_lc);
        setIf("price", price);
        setIf("sku", sku);
        setIf("uom", uom);
        setIf("taxCode", taxCode);
        setIf("kind", kind);
        // Product SKU change → migrate uniqueness token within one transaction
        const curSkuLc = (cur?.sku ?? "").toLowerCase() || undefined;
        const willChangeSku = typeParam === "product" && sku_lc && sku_lc !== curSkuLc;
        if (willChangeSku) {
            const newTokenKey = { pk: uniqPk(tenantId, sku_lc), sk: "UNIQ" };
            const newToken = {
                ...newTokenKey,
                tenant: tenantId,
                entity: "uniq",
                domain: "product",
                field: "sku",
                value: sku_lc,
                refId: id,
                createdAt: now,
            };
            const oldTokenKey = curSkuLc ? { pk: uniqPk(tenantId, curSkuLc), sk: "UNIQ" } : undefined;
            try {
                await ddb_1.ddb.send(new lib_dynamodb_1.TransactWriteCommand({
                    TransactItems: [
                        // Put new token guarded by condition
                        {
                            Put: {
                                TableName: ddb_1.tableObjects,
                                Item: newToken,
                                ConditionExpression: "attribute_not_exists(pk)",
                            },
                        },
                        // Delete old token if present
                        ...(oldTokenKey ? [{ Delete: { TableName: ddb_1.tableObjects, Key: oldTokenKey } }] : []),
                        // Update the product
                        {
                            Update: {
                                TableName: ddb_1.tableObjects,
                                Key: { pk: id, sk: `${tenantId}|${typeParam}` },
                                UpdateExpression: `SET ${setParts.join(", ")}`,
                                ExpressionAttributeValues: values,
                            },
                        },
                    ],
                }));
            }
            catch (e) {
                if ((e?.name || "").includes("ConditionalCheckFailed")) {
                    return (0, responses_1.conflict)("SKU already exists for this tenant");
                }
                return (0, responses_1.error)(e);
            }
            // TransactWrite returns no attributes — synthesize a minimal, correct response
            return (0, responses_1.ok)({
                ...cur,
                ...patch,
                id,
                tenant: tenantId,
                type: typeParam,
                updatedAt: now,
                sku,
            });
        }
        // Simple UpdateCommand path (no SKU migration)
        const r = await ddb_1.ddb.send(new lib_dynamodb_1.UpdateCommand({
            TableName: ddb_1.tableObjects,
            Key: { pk: id, sk: `${tenantId}|${typeParam}` },
            UpdateExpression: `SET ${setParts.join(", ")}`,
            ExpressionAttributeValues: values,
            ReturnValues: "ALL_NEW",
        }));
        // ✅ FIX: coalesce Attributes so ok() never receives undefined
        const updated = r.Attributes ?? {
            id,
            tenant: tenantId,
            type: typeParam,
            updatedAt: now,
        };
        return (0, responses_1.ok)(updated);
    }
    catch (e) {
        if ((e?.name || "").includes("ConditionalCheckFailed")) {
            return (0, responses_1.conflict)("SKU already exists for this tenant");
        }
        return (0, responses_1.error)(e);
    }
};
exports.handler = handler;
