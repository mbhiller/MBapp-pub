"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const responses_1 = require("../common/responses");
const handler = async () => {
    // Return a simple list for now; expand later
    return (0, responses_1.ok)([{ id: 'DemoTenant', name: 'Demo Tenant' }]);
};
exports.handler = handler;
