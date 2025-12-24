"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const lib_dynamodb_1 = require("@aws-sdk/lib-dynamodb");
const ddb_1 = require("../common/ddb");
const responses_1 = require("../common/responses");
const env_1 = require("../common/env");
const MAX_LIST_LIMIT = Math.max(1, parseInt(process.env.MAX_LIST_LIMIT ?? "100", 10) || 100);
// simple base64 cursor helpers
function enc(k) { if (!k)
    return undefined; try {
    return Buffer.from(JSON.stringify(k)).toString("base64");
}
catch {
    return undefined;
} }
function dec(s) { if (!s)
    return undefined; try {
    return JSON.parse(Buffer.from(s, "base64").toString("utf8"));
}
catch {
    return undefined;
} }
const handler = async (evt) => {
    try {
        const tenantId = (0, env_1.getTenantId)(evt);
        if (!tenantId)
            return (0, responses_1.bad)("x-tenant-id header required");
        const typeParam = evt?.pathParameters?.type?.trim();
        if (!typeParam)
            return (0, responses_1.bad)("type is required");
        const qs = evt?.queryStringParameters ?? {};
        const limit = Math.min(MAX_LIST_LIMIT, Math.max(1, parseInt(qs?.limit ?? "25", 10) || 25));
        const order = (qs?.order || "desc").toLowerCase(); // 'asc'|'desc'
        const cursor = dec(qs?.cursor);
        const params = {
            TableName: ddb_1.tableObjects,
            IndexName: ddb_1.GSI1_NAME,
            KeyConditionExpression: "gsi1pk = :gpk",
            ExpressionAttributeValues: { ":gpk": `${tenantId}|${typeParam}` },
            Limit: limit,
            ScanIndexForward: order === "asc",
        };
        if (cursor)
            params.ExclusiveStartKey = cursor;
        const r = await ddb_1.ddb.send(new lib_dynamodb_1.QueryCommand(params));
        const items = (r.Items ?? []).map((it) => ({
            id: it.id,
            tenant: it.tenant,
            type: typeParam,
            name: it.name,
            price: it.price,
            sku: it.sku,
            uom: it.uom,
            taxCode: it.taxCode,
            kind: it.kind,
            createdAt: it.createdAt,
            updatedAt: it.updatedAt,
        }));
        return (0, responses_1.ok)({ items, next: enc(r.LastEvaluatedKey) });
    }
    catch (e) {
        return (0, responses_1.error)(e);
    }
};
exports.handler = handler;
