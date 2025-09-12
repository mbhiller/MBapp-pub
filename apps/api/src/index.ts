// apps/api/src/index.ts
import * as ObjCreate from "./objects/create";
import * as ObjUpdate from "./objects/update";
import * as ObjGet from "./objects/get";
import * as ObjListByType from "./objects/listByType";
import * as ObjSearch from "./objects/search";

function httpInfo(evt: any) {
  const m = evt?.requestContext?.http?.method ?? evt?.httpMethod ?? "GET";
  const p = (evt?.rawPath ?? evt?.path ?? "/").replace(/\/+$/, "") || "/";
  return { method: String(m).toUpperCase(), path: p };
}
const withParams = (evt: any, p: Record<string, string>) =>
  ({ ...evt, pathParameters: { ...(evt?.pathParameters ?? {}), ...p } });

export const handler = async (evt: any) => {
  const { method, path } = httpInfo(evt);

  // /objects/:type(/:id)
  if (path.startsWith("/objects/")) {
    const [_, type, id] = path.split("/").filter(Boolean); // objects, type, (id?)
    if (method === "POST" && type && !id)  return ObjCreate.handler(withParams(evt, { type }));
    if (method === "PUT"  && type && id)   return ObjUpdate.handler(withParams(evt, { type, id }));
    if (method === "GET"  && type && id)   return ObjGet.handler(withParams(evt,   { type, id }));
    if (method === "GET"  && type && !id)  return ObjListByType.handler(withParams(evt, { type }));
  }

  // /products alias → always pass type=product
  if (path === "/products" && method === "POST")
    return ObjCreate.handler(withParams(evt, { type: "product" }));

  const m = /^\/products\/([^/]+)$/.exec(path);
  if (m && method === "PUT")
    return ObjUpdate.handler(withParams(evt, { type: "product", id: m[1] }));
  if (m && method === "GET")
    return ObjGet.handler(withParams(evt, { type: "product", id: m[1] }));

  if (path === "/products" && method === "GET") {
    const hasSearch = !!(evt.queryStringParameters?.sku || evt.queryStringParameters?.q);
    if (hasSearch) {
      const e2 = { ...evt, queryStringParameters: { ...(evt.queryStringParameters ?? {}), type: "product" } };
      return ObjSearch.handler(e2 as any);
    }
    return ObjListByType.handler(withParams(evt, { type: "product" }));
  }

  return {
    statusCode: 404,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ error: "NotFound", method, path }),
  };
};
