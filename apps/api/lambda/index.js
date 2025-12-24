"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
// apps/api/src/index.ts
const responses_1 = require("./common/responses");
const ObjCreate = __importStar(require("./objects/create"));
const ObjUpdate = __importStar(require("./objects/update"));
const ObjGet = __importStar(require("./objects/get"));
const ObjList = __importStar(require("./objects/list"));
const ObjSearch = __importStar(require("./objects/search"));
// attach/override path parameters without mutating the original object
function withParams(evt, patch) {
    return {
        ...evt,
        pathParameters: { ...(evt.pathParameters ?? {}), ...patch },
    };
}
const handler = async (evt) => {
    const method = (evt?.requestContext?.http?.method || "GET").toUpperCase();
    const path = (evt?.rawPath || "/").replace(/\/+$/, "") || "/";
    // CORS preflight
    if (method === "OPTIONS")
        return (0, responses_1.preflight)();
    // ------- “/products” aliases mapped to objects(type=product) -------
    // Create
    if (path === "/products" && method === "POST") {
        return ObjCreate.handler(withParams(evt, { type: "product" }));
    }
    // List / search
    if (path === "/products" && method === "GET") {
        // Reuse search; force type=product. Pass through q, sku, limit, cursor, order.
        const qs = evt.queryStringParameters ?? {};
        const patched = { ...evt, queryStringParameters: { ...qs, type: "product" } };
        return ObjSearch.handler(patched);
    }
    // Get / Update by id
    const mProd = /^\/products\/([^/]+)$/.exec(path);
    if (mProd && method === "GET") {
        return ObjGet.handler(withParams(evt, { type: "product", id: mProd[1] }));
    }
    if (mProd && method === "PUT") {
        return ObjUpdate.handler(withParams(evt, { type: "product", id: mProd[1] }));
    }
    // --------------------- Native /objects routes ----------------------
    // POST /objects/:type
    const mCreate = /^\/objects\/([^/]+)$/.exec(path);
    if (mCreate && method === "POST") {
        return ObjCreate.handler(withParams(evt, { type: mCreate[1] }));
    }
    // PUT /objects/:type/:id   |   GET /objects/:type/:id
    const mId = /^\/objects\/([^/]+)\/([^/]+)$/.exec(path);
    if (mId && method === "PUT") {
        return ObjUpdate.handler(withParams(evt, { type: mId[1], id: mId[2] }));
    }
    if (mId && method === "GET") {
        return ObjGet.handler(withParams(evt, { type: mId[1], id: mId[2] }));
    }
    // GET /objects/:type  (paged list)
    const mList = /^\/objects\/([^/]+)$/.exec(path);
    if (mList && method === "GET") {
        return ObjList.handler(withParams(evt, { type: mList[1] }));
    }
    // GET /objects/search (list/search)
    if (path === "/objects/search" && method === "GET") {
        return ObjSearch.handler(evt);
    }
    // Legacy: GET /objects?id=...&type=...
    if (path === "/objects" && method === "GET") {
        const qs = evt.queryStringParameters ?? {};
        if (qs?.id && qs?.type) {
            return ObjGet.handler(withParams(evt, { type: String(qs.type), id: String(qs.id) }));
        }
        // fallback to search (supports ?type=&q=&sku=) or list when only type is present
        return ObjSearch.handler(evt);
    }
    return (0, responses_1.notimpl)(`${method} ${path}`);
};
exports.handler = handler;
