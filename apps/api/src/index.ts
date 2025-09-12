// Minimal router for HTTP API v2 events (Lambda proxy).
// Adds client-facing /products endpoints that delegate to existing objects handlers.

import type { APIGatewayProxyEventV2 } from "aws-lambda";

// Objects handlers
import * as ObjCreate from "./objects/create";
import * as ObjUpdate from "./objects/update";
import * as ObjGet from "./objects/get";
import * as ObjListByType from "./objects/listByType";
import * as ObjSearch from "./objects/search";

// Helpers
function httpInfo(evt: any) {
  const m = evt?.requestContext?.http?.method ?? evt?.httpMethod ?? "GET";
  const p = (evt?.rawPath ?? evt?.path ?? "/").replace(/\/+$/, "") || "/";
  return { method: m.toUpperCase(), path: p };
}
function withPathParams(evt: any, pathParameters: Record<string, string>) {
  return { ...evt, pathParameters: { ...(evt?.pathParameters ?? {}), ...pathParameters } };
}

export const handler = async (evt: APIGatewayProxyEventV2) => {
  const { method, path } = httpInfo(evt);

  // ————————————— OBJECTS (existing) —————————————
  if (path.startsWith("/objects/")) {
    // Let existing Lambda URLs / routes invoke the compiled handlers directly via API Gateway mapping
    // If you still come through here, we can do a simple switch:
    const parts = path.split("/").filter(Boolean); // ["objects", type, id?]
    const type = parts[1];
    const id = parts[2];

    if (method === "POST" && parts.length === 2) return ObjCreate.handler(withPathParams(evt, { type }));
    if (method === "PUT"  && parts.length === 3) return ObjUpdate.handler(withPathParams(evt, { type, id }));
    if (method === "GET"  && parts.length === 3) return ObjGet.handler(withPathParams(evt, { type, id }));
    if (method === "GET"  && parts.length === 2) return ObjListByType.handler(withPathParams(evt, { type }));
  }

  // ————————————— PRODUCTS (alias) —————————————
  // POST   /products                      -> POST /objects/product
  // PUT    /products/{id}                 -> PUT  /objects/product/{id}
  // GET    /products/{id}                 -> GET  /objects/product/{id}
  // GET    /products?sku=&q=&limit=&...   -> list/search (type=product)
  if (path === "/products" && method === "POST") {
    return ObjCreate.handler(withPathParams(evt, { type: "product" }));
  }
  const prodId = /^\/products\/([A-Za-z0-9._:-]+)$/.exec(path)?.[1];
  if (prodId && method === "PUT") {
    return ObjUpdate.handler(withPathParams(evt, { type: "product", id: prodId }));
  }
  if (prodId && method === "GET") {
    return ObjGet.handler(withPathParams(evt, { type: "product", id: prodId }));
  }
  if (path === "/products" && method === "GET") {
    const hasSearch = !!(evt.queryStringParameters?.sku || evt.queryStringParameters?.q);
    if (hasSearch) {
      // delegate to search with type=product
      const evt2: any = { ...evt, queryStringParameters: { ...(evt.queryStringParameters ?? {}), type: "product" } };
      return ObjSearch.handler(evt2);
    }
    return ObjListByType.handler(withPathParams(evt, { type: "product" }));
  }

  // Fallback
  return {
    statusCode: 404,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ error: "NotFound", method, path }),
  };
};
