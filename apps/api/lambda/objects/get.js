"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const lib_dynamodb_1 = require("@aws-sdk/lib-dynamodb");
const ddb_1 = require("../common/ddb");
const responses_1 = require("../common/responses");
const env_1 = require("../common/env");
const handler = async (evt) => {
    try {
        const tenantId = (0, env_1.getTenantId)(evt);
        if (!tenantId)
            return (0, responses_1.bad)("x-tenant-id header required");
        const id = evt?.pathParameters?.id?.trim();
        const typeParam = evt?.pathParameters?.type?.trim();
        if (!id)
            return (0, responses_1.bad)("id is required");
        if (!typeParam)
            return (0, responses_1.bad)("type is required");
        const res = await ddb_1.ddb.send(new lib_dynamodb_1.GetCommand({
            TableName: ddb_1.tableObjects,
            Key: { pk: id, sk: `${tenantId}|${typeParam}` },
        }));
        const it = res.Item;
        if (!it)
            return (0, responses_1.notfound)("object not found");
        // Normalize response type (guard against historical misuse of 'type' for kind)
        const kindFromType = it.type === "good" || it.type === "service" ? it.type : undefined;
        const kind = it.kind ?? kindFromType;
        const out = {
            id: it.id,
            tenant: it.tenant,
            type: typeParam,
            name: it.name,
            price: it.price,
            sku: it.sku,
            uom: it.uom,
            taxCode: it.taxCode,
            kind,
            createdAt: it.createdAt,
            updatedAt: it.updatedAt,
        };
        return (0, responses_1.ok)(out);
    }
    catch (e) {
        return (0, responses_1.error)(e);
    }
};
exports.handler = handler;
