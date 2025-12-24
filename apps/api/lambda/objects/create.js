"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const lib_dynamodb_1 = require("@aws-sdk/lib-dynamodb");
const ddb_1 = require("../common/ddb");
const responses_1 = require("../common/responses");
const env_1 = require("../common/env");
const uniqPk = (tenant, skuLc) => `UNIQ#${tenant}#product#SKU#${skuLc}`;
function genId() {
    return (Date.now().toString(36) +
        "-" + Math.random().toString(36).slice(2, 10) +
        "-" + Math.random().toString(36).slice(2, 10));
}
function cleanValue(v) {
    if (v == null)
        return undefined;
    if (typeof v === "string") {
        const s = v.trim();
        return s.length ? s : undefined; // no empty strings
    }
    if (typeof v === "number")
        return Number.isFinite(v) ? v : undefined;
    return v;
}
const handler = async (evt) => {
    try {
        const tenantId = (0, env_1.getTenantId)(evt);
        if (!tenantId)
            return (0, responses_1.bad)("x-tenant-id header required");
        const typeParam = evt?.pathParameters?.type?.trim() ||
            evt?.queryStringParameters?.type?.trim();
        if (!typeParam)
            return (0, responses_1.bad)("type is required");
        const bodyText = evt?.isBase64Encoded
            ? Buffer.from(evt.body ?? "", "base64").toString("utf8")
            : (evt?.body ?? "{}");
        let body = {};
        try {
            body = JSON.parse(bodyText || "{}");
        }
        catch {
            body = {};
        }
        const id = cleanValue(body?.id) || genId();
        const now = new Date().toISOString();
        const base = {
            pk: id,
            sk: `${tenantId}|${typeParam}`,
            id,
            tenant: tenantId,
            type: typeParam,
            createdAt: now,
            updatedAt: now,
            gsi1pk: `${tenantId}|${typeParam}`,
            gsi1sk: now,
        };
        // copy user fields (skip reserved)
        const RESERVED = new Set(["pk", "sk", "id", "tenant", "type", "createdAt", "updatedAt", "gsi1pk", "gsi1sk"]);
        for (const [k, v] of Object.entries(body || {})) {
            if (RESERVED.has(k))
                continue;
            const cleaned = cleanValue(v);
            if (cleaned !== undefined)
                base[k] = cleaned;
        }
        // ---------- product path with SKU uniqueness ----------
        if (typeParam === "product") {
            const sku = typeof body?.sku === "string" ? body.sku.trim() : undefined;
            const skuLc = sku ? sku.toLowerCase() : undefined;
            if (skuLc) {
                const tokenKey = { pk: uniqPk(tenantId, skuLc), sk: "UNIQ" };
                const token = {
                    ...tokenKey,
                    tenant: tenantId,
                    entity: "uniq",
                    domain: "product",
                    field: "sku",
                    value: skuLc,
                    refId: id,
                    createdAt: now,
                };
                try {
                    // ✅ Put token with condition (no separate ConditionCheck) + Put product
                    await ddb_1.ddb.send(new lib_dynamodb_1.TransactWriteCommand({
                        TransactItems: [
                            {
                                Put: {
                                    TableName: ddb_1.tableObjects,
                                    Item: token,
                                    ConditionExpression: "attribute_not_exists(pk)"
                                }
                            },
                            {
                                Put: {
                                    TableName: ddb_1.tableObjects,
                                    Item: base
                                }
                            }
                        ]
                    }));
                    return (0, responses_1.ok)(base);
                }
                catch (e) {
                    if ((e?.name || "").includes("ConditionalCheckFailed")) {
                        return (0, responses_1.conflict)("SKU already exists for this tenant");
                    }
                    return (0, responses_1.error)(e);
                }
            }
        }
        // ---------- generic create (non-product or product w/o sku) ----------
        const sanitized = {};
        for (const [k, v] of Object.entries(base))
            if (v !== undefined)
                sanitized[k] = v;
        await ddb_1.ddb.send(new lib_dynamodb_1.PutCommand({ TableName: ddb_1.tableObjects, Item: sanitized }));
        return (0, responses_1.ok)(sanitized);
    }
    catch (e) {
        return (0, responses_1.error)(e);
    }
};
exports.handler = handler;
