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

function withParams(evt: EventV2, adds: Record<string, string>) {
  return { ...evt, pathParameters: { ...(evt.pathParameters ?? {}), ...adds } };
}

export const handler = async (evt: EventV2) => {
  const method = (evt?.requestContext?.http?.method ?? "GET").toUpperCase();
  const path = (evt?.rawPath ?? "").replace(/\/+$/, "") || "/";

  // CORS preflight
  if (method === "OPTIONS") return preflight();

  // ------- “/products” aliases mapped to objects(type=product) -------
  // Create
  if (path === "/products" && method === "POST") {
    return ObjCreate.handler(withParams(evt, { type: "product" }));
  }

  // List / search
  if (path === "/products" && method === "GET") {
    // Reuse search; force type=product. Pass through q, sku, limit, cursor.
    const qs = evt.queryStringParameters ?? {};
    const patched = {
      ...evt,
      queryStringParameters: {
        ...qs,
        type: "product",
      },
    };
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

  // GET /objects (search & list)
  if (path === "/objects" && method === "GET") {
    const qs = evt.queryStringParameters ?? {};
    // If you ever want pure list by type, ObjList.handler is available;
    // search currently handles q/sku/name and also “just type” listings.
    if (qs?.q || qs?.sku || qs?.name || qs?.type) {
      return ObjSearch.handler(evt as any);
    }
    return ObjList.handler(evt as any);
  }

  return notimpl(`${method} ${path}`);
};
