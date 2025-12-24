"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTenantId = getTenantId;
function getTenantId(evt) {
    const h = evt?.headers || {};
    return h["x-tenant-id"] || h["X-Tenant-Id"] || process.env.EXPO_PUBLIC_TENANT_ID || process.env.DEFAULT_TENANT || "DemoTenant";
}
