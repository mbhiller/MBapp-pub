"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const responses_1 = require("../common/responses");
const env_1 = require("../common/env");
const handler = async (evt) => {
    try {
        const tenantId = (0, env_1.getTenantId)(evt);
        if (!tenantId)
            return (0, responses_1.bad)("x-tenant-id header required");
        const tag = evt?.queryStringParameters?.tag;
        if (!tag)
            return (0, responses_1.bad)("tag query param is required");
        return {
            statusCode: 501,
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ error: "NotImplemented", message: "searchByTag pending", tag })
        };
    }
    catch (err) {
        return (0, responses_1.error)(err);
    }
};
exports.handler = handler;
