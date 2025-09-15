// apps/api/src/index.ts
import { preflight, notimpl } from "./common/responses";
import * as ObjCreate from "./objects/create";
import * as ObjUpdate from "./objects/update";
import * as ObjGet from "./objects/get";
import * as ObjList from "./objects/list";
import * as ObjSearch from "./objects/search";

type ApiEvt = {
  rawPath?: string;
  path?: string; // REST API
  requestContext?: { http?: { method?: string } };
  queryStringParameters?: Record<string, string | undefined>;
  pathParameters?: Record<string, string | undefined>;
  headers?: Record<string, string | undefined>;
  body?: string;
  isBase64Encoded?: boolean;
};

function withParams(evt: ApiEvt, add: Record<string, string | undefined>): ApiEvt {
  return { ...evt, pathParameters: { ...(evt.pathParameters || {}), ...add } };
}
function withQuery(evt: ApiEvt, add: Record<string, string | undefined>): ApiEvt {
  return { ...evt, queryStringParameters: { ...(evt.queryStringParameters || {}), ...add } };
}
function withPath(evt: ApiEvt, newPath: string): ApiEvt {
  // also update rawPath so downstream libs that read it won't choke
  return { ...evt, path: newPath, rawPath: newPath };
}
function json(code: number, body: unknown) {
  return { statusCode: code, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

function norm(raw: string | undefined): string {
  const r = (raw || "/").split("?")[0];
  const noTrail = r.replace(/\/+$/, "") || "/";
  if (noTrail === "/") return "/";

  const parts = noTrail.split("/").filter(Boolean); // ["nonprod","products"] or ["products"]
  const KNOWN = new Set(["objects", "products", "events", "registrations", "__echo"]);
  if (KNOWN.has(parts[0])) return "/" + parts.join("/");

  // If first looks like a stage, strip it when the next is known
  if (parts.length > 1 && KNOWN.has(parts[1])) return "/" + parts.slice(1).join("/");
  return "/" + parts.join("/");
}

export const handler = async (evt: ApiEvt) => {
  const method = (evt?.requestContext?.http?.method ?? "GET").toUpperCase();
  if (method === "OPTIONS") return preflight();

  const raw = evt.rawPath || (evt as any).path || "/";
  const path = norm(raw);

  try {
    // ---------- DEBUG: echo what the router sees ----------
    if (path.startsWith("/__echo")) {
      return json(200, {
        method,
        rawPath: raw,
        normalized: path,
        queryString: evt.queryStringParameters || {},
        pathParameters: evt.pathParameters || {},
      });
    }

    // --------------------- PRODUCTS aliases ---------------------
    // POST /products  -> /objects/product
    if (path === "/products" && method === "POST") {
      const patched = withPath(withParams(evt, { type: "product" }), "/objects/product");
      return ObjCreate.handler(patched as any);
    }
    // GET /products    -> /objects/product (list)
    if (path === "/products" && method === "GET") {
      const patched = withPath(withParams(evt, { type: "product" }), "/objects/product");
      return ObjList.handler(patched as any);
    }
    // GET /products/search -> search with type=product
    if (path === "/products/search" && method === "GET") {
      const patched = withPath(withQuery(evt, { type: "product" }), "/objects");
      return ObjSearch.handler(patched as any);
    }
    // GET|PUT /products/:id -> /objects/product/:id
    {
      const m = /^\/products\/([^/]+)$/.exec(path);
      if (m && method === "GET") {
        const patched = withPath(withParams(evt, { type: "product", id: m[1] }), `/objects/product/${m[1]}`);
        return ObjGet.handler(patched as any);
      }
      if (m && method === "PUT") {
        const patched = withPath(withParams(evt, { type: "product", id: m[1] }), `/objects/product/${m[1]}`);
        return ObjUpdate.handler(patched as any);
      }
    }

    // ----------------------- EVENTS aliases ---------------------
    // POST /events  -> /objects/event
    if (path === "/events" && method === "POST") {
      const patched = withPath(withParams(evt, { type: "event" }), "/objects/event");
      return ObjCreate.handler(patched as any);
    }
    // GET /events    -> /objects/event (list)
    if (path === "/events" && method === "GET") {
      const patched = withPath(withParams(evt, { type: "event" }), "/objects/event");
      return ObjList.handler(patched as any);
    }
    // GET|PUT /events/:id -> /objects/event/:id
    {
      const m = /^\/events\/([^/]+)$/.exec(path);
      if (m && method === "GET") {
        const patched = withPath(withParams(evt, { type: "event", id: m[1] }), `/objects/event/${m[1]}`);
        return ObjGet.handler(patched as any);
      }
      if (m && method === "PUT") {
        const patched = withPath(withParams(evt, { type: "event", id: m[1] }), `/objects/event/${m[1]}`);
        return ObjUpdate.handler(patched as any);
      }
    }
    // GET /events/:id/registrations -> /objects/registration?eventId=...
    {
      const m = /^\/events\/([^/]+)\/registrations$/.exec(path);
      if (m && method === "GET") {
        const patched = withPath(
          withQuery(withParams(evt, { type: "registration" }), { eventId: m[1] }),
          "/objects/registration"
        );
        return ObjList.handler(patched as any);
      }
    }

    // ------------------- REGISTRATIONS aliases ------------------
    // POST /registrations -> /objects/registration
    if (path === "/registrations" && method === "POST") {
      const patched = withPath(withParams(evt, { type: "registration" }), "/objects/registration");
      return ObjCreate.handler(patched as any);
    }
    // GET /registrations   -> /objects/registration (list)
    if (path === "/registrations" && method === "GET") {
      const patched = withPath(withParams(evt, { type: "registration" }), "/objects/registration");
      return ObjList.handler(patched as any);
    }
    // GET|PUT /registrations/:id -> /objects/registration/:id
    {
      const m = /^\/registrations\/([^/]+)$/.exec(path);
      if (m && method === "GET") {
        const patched = withPath(withParams(evt, { type: "registration", id: m[1] }), `/objects/registration/${m[1]}`);
        return ObjGet.handler(patched as any);
      }
      if (m && method === "PUT") {
        const patched = withPath(withParams(evt, { type: "registration", id: m[1] }), `/objects/registration/${m[1]}`);
        return ObjUpdate.handler(patched as any);
      }
    }

    // --------------------- Native /objects routes ----------------
    {
      const m = /^\/objects\/([^/]+)$/.exec(path);
      if (m && method === "POST") return ObjCreate.handler(withParams(evt, { type: m[1] }) as any);
      if (m && method === "GET")  return ObjList.handler(withParams(evt, { type: m[1] }) as any);
    }
    {
      const m = /^\/objects\/([^/]+)\/([^/]+)$/.exec(path);
      if (m && method === "GET") return ObjGet.handler(withParams(evt, { type: m[1], id: m[2] }) as any);
      if (m && method === "PUT") return ObjUpdate.handler(withParams(evt, { type: m[1], id: m[2] }) as any);
    }

    // Legacy: GET /objects?id=...&type=...
    if (path === "/objects" && method === "GET") {
      const qs = evt.queryStringParameters ?? {};
      if (qs?.id && qs?.type) {
        return ObjGet.handler(withParams(evt, { type: String(qs.type), id: String(qs.id) }) as any);
      }
      return ObjSearch.handler(evt as any);
    }

    return notimpl(`${method} ${path}`);
  } catch (e: any) {
    console.error("router error", { method, raw, normalized: path, err: e?.message, stack: e?.stack });
    return json(500, { error: "router", method, rawPath: raw, normalized: path, message: e?.message });
  }
};
