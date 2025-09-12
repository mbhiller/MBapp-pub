// apps/api/src/index.ts
<<<<<<< HEAD
type EventV2 = {
  rawPath?: string;
  requestContext?: { http?: { method?: string } };
  queryStringParameters?: Record<string, string | undefined>;
  headers?: Record<string, string | undefined>;
  body?: string;
  isBase64Encoded?: boolean;
=======
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
>>>>>>> 86f138f
};
type ResultV2 = { statusCode: number; headers?: Record<string, string>; body: string };

import {
  // objects
  listObjectsByTypeQuery,
  getObjectByKey,
  createObject,
  updateObject,
  deleteObject,
  // products
  listProductsQuery,
  getProductById,
  createProduct,
  updateProduct,
} from "./db";

export async function handler(event: EventV2): Promise<ResultV2> {
  const method = event.requestContext?.http?.method?.toUpperCase() || "GET";
  const rawPath = (event.rawPath || "/").toLowerCase().replace(/\/+$/, "") || "/";
  const qs = event.queryStringParameters || {};
  const tenant = (event.headers?.["x-tenant-id"] || event.headers?.["X-Tenant-Id"] || "DemoTenant") as string;

  /* ------------------------------ Tenants (stub) ----------------------------- */
  if (method === "GET" && rawPath === "/tenants") {
    return ok({ items: [{ id: "DemoTenant", name: "Demo Tenant" }] });
  }

  /* -------------------------------- Objects --------------------------------- */
  if (method === "GET" && rawPath === "/objects") {
    const type = (qs.type || "").toString().trim();
    if (!type) return bad(400, { message: "Missing type" });
    try {
      const { items, nextCursor } = await listObjectsByTypeQuery({
        tenant,
        type,
        limit: qs.limit ? Number(qs.limit) : 25,
        cursor: qs.cursor,
        nameContains: qs.name,
      });
      return ok({ items, nextCursor, type });
    } catch (e: any) {
      console.error("DDB list error", e);
      return err({ message: "Dynamo error (list)", code: e?.name, detail: e?.message });
    }
  }

  const mTypeOnly = rawPath.match(/^\/objects\/([^/]+)$/);
  if (method === "GET" && mTypeOnly) {
    const type = decodeURIComponent(mTypeOnly[1]);
    try {
      const { items, nextCursor } = await listObjectsByTypeQuery({
        tenant,
        type,
        limit: qs.limit ? Number(qs.limit) : 25,
        cursor: qs.cursor,
        nameContains: qs.name,
      });
      return ok({ items, nextCursor, type });
    } catch (e: any) {
      console.error("DDB list[type] error", e);
      return err({ message: "Dynamo error (list[type])", code: e?.name, detail: e?.message });
    }
  }

  const mObj = rawPath.match(/^\/objects\/([^/]+)\/([^/]+)$/);
  if (method === "GET" && mObj) {
    const type = decodeURIComponent(mObj[1]);
    const id = decodeURIComponent(mObj[2]);
    try {
      const item = await getObjectByKey({ tenant, type, id });
      if (!item) return notFound({ message: "Not found" });
      return ok(item);
    } catch (e: any) {
      console.error("DDB get error", e);
      return err({ message: "Dynamo error (get)", code: e?.name, detail: e?.message });
    }
  }

  if (method === "POST" && mTypeOnly) {
    const type = decodeURIComponent(mTypeOnly[1]);
    try {
      const body = parseBody(event);
      const item = await createObject({ tenant, type, body });
      return ok(item);
    } catch (e: any) {
      console.error("DDB create error", e);
      return err({ message: "Dynamo error (create)", code: e?.name, detail: e?.message });
    }
  }

  if (method === "PUT" && mObj) {
    const type = decodeURIComponent(mObj[1]);
    const id = decodeURIComponent(mObj[2]);
    try {
      const body = parseBody(event);
      const item = await updateObject({ tenant, type, id, patch: body || {} });
      return ok(item);
    } catch (e: any) {
      console.error("DDB update error", e);
      if (e?.name === "ConditionalCheckFailedException") return notFound({ message: "Not found" });
      return err({ message: "Dynamo error (update)", code: e?.name, detail: e?.message });
    }
  }

  if (method === "DELETE" && mObj) {
    const type = decodeURIComponent(mObj[1]);
    const id = decodeURIComponent(mObj[2]);
    try {
      const deleted = await deleteObject({ tenant, type, id });
      if (!deleted) return notFound({ message: "Not found" });
      return ok({ ok: true, id, type });
    } catch (e: any) {
      console.error("DDB delete error", e);
      return err({ message: "Dynamo error (delete)", code: e?.name, detail: e?.message });
    }
  }

  /* -------------------------------- Products -------------------------------- */
  if (method === "GET" && rawPath === "/products") {
    try {
      const { items, nextCursor } = await listProductsQuery({
        tenant,
        limit: qs.limit ? Number(qs.limit) : 25,
        cursor: qs.cursor,
        q: qs.q,
        sku: qs.sku,
      });
      return ok({ items, nextCursor });
    } catch (e: any) {
      console.error("DDB products list error", e);
      return err({ message: "Dynamo error (products list)", code: e?.name, detail: e?.message });
    }
  }

  const mProd = rawPath.match(/^\/products\/([^/]+)$/);
  if (method === "GET" && mProd) {
    const id = decodeURIComponent(mProd[1]);
    try {
      const item = await getProductById({ tenant, id });
      if (!item) return notFound({ message: "Not found" });
      return ok(item);
    } catch (e: any) {
      console.error("DDB product get error", e);
      return err({ message: "Dynamo error (product get)", code: e?.name, detail: e?.message });
    }
  }

  if (method === "POST" && rawPath === "/products") {
    try {
      const body = parseBody(event);
      const item = await createProduct({ tenant, body });
      return ok(item);
    } catch (e: any) {
      console.error("DDB product create error", e);
      return err({ message: "Dynamo error (product create)", code: e?.name, detail: e?.message });
    }
  }

  if (method === "PUT" && mProd) {
    const id = decodeURIComponent(mProd[1]);
    try {
      const body = parseBody(event);
      const item = await updateProduct({ tenant, id, patch: body || {} });
      return ok(item);
    } catch (e: any) {
      console.error("DDB product update error", e);
      if (e?.name === "ConditionalCheckFailedException") return notFound({ message: "Not found" });
      return err({ message: "Dynamo error (product update)", code: e?.name, detail: e?.message });
    }
  }

  return notFound({ message: `Unsupported ${method} ${event.rawPath}` });
}

/* -------------------------------- helpers -------------------------------- */
function parseBody(event: EventV2): any {
  if (!event.body) return {};
  const text = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
  try { return JSON.parse(text); } catch { return {}; }
}
function ok(body: any): ResultV2 { return resp(200, body); }
function bad(status: number, body: any): ResultV2 { return resp(status, body); }
function notFound(body: any): ResultV2 { return resp(404, body); }
function err(body: any): ResultV2 { return resp(500, body); }
function resp(statusCode: number, body: any): ResultV2 {
  return { statusCode, headers: { "access-control-allow-origin": "*", "content-type": "application/json" }, body: JSON.stringify(body) };
}
