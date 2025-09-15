// apps/api/src/index.ts
import { preflight, notimpl } from "./common/responses";
import * as ObjCreate from "./objects/create";
import * as ObjUpdate from "./objects/update";
import * as ObjGet from "./objects/get";
import * as ObjList from "./objects/list";
import * as ObjSearch from "./objects/search";

type EventV2 = {
  rawPath?: string;
  requestContext?: { http?: { method?: string } };
  queryStringParameters?: Record<string, string | undefined>;
  pathParameters?: Record<string, string | undefined>;
  headers?: Record<string, string | undefined>;
  body?: string;
  isBase64Encoded?: boolean;
};

// attach/override path parameters without mutating the original object
function withParams(evt: EventV2, patch: Record<string, string>) {
  return {
    ...evt,
    pathParameters: { ...(evt.pathParameters ?? {}), ...patch },
  };
}

export const handler = async (evt: EventV2) => {
  const method = (evt?.requestContext?.http?.method || "GET").toUpperCase();
  const path = (evt?.rawPath || "/").replace(/\/+$/, "") || "/";

  // CORS preflight
  if (method === "OPTIONS") return preflight();

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
    return ObjSearch.handler(patched as any);
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
    return ObjSearch.handler(evt as any);
  }

  // Legacy: GET /objects?id=...&type=...
  if (path === "/objects" && method === "GET") {
    const qs = evt.queryStringParameters ?? {};
    if (qs?.id && qs?.type) {
      return ObjGet.handler(withParams(evt, { type: String(qs.type), id: String(qs.id) }));
    }
    // fallback to search (supports ?type=&q=&sku=) or list when only type is present
    return ObjSearch.handler(evt as any);
  }

  return notimpl(`${method} ${path}`);
};
