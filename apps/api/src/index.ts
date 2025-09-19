// apps/api/src/index.ts
import { preflight, notimpl, ok, error } from "./common/responses";
import * as ObjCreate from "./objects/create";
import * as ObjUpdate from "./objects/update";
import * as ObjGet from "./objects/get";
import * as ObjList from "./objects/list";
import * as ObjSearch from "./objects/search";

// Accept both HTTP API v2 and REST v1 shapes (keep types loose to avoid build issues)
type ApiEvt = {
  rawPath?: string;
  path?: string;
  requestContext?: { http?: { method?: string; path?: string } };
  httpMethod?: string;
  queryStringParameters?: Record<string, string | undefined>;
  pathParameters?: Record<string, string | undefined>;
  headers?: Record<string, string | undefined>;
};

function methodOf(evt: ApiEvt): string {
  return (evt.requestContext?.http?.method || evt.httpMethod || "GET").toUpperCase();
}
function pathOf(evt: ApiEvt): string {
  const p = evt.requestContext?.http?.path || evt.rawPath || evt.path || "/";
  return p.startsWith("/") ? p : `/${p}`;
}
function withParams<T extends ApiEvt>(evt: T, params: Record<string, string | undefined>): T {
  return { ...evt, pathParameters: { ...(evt.pathParameters ?? {}), ...params } };
}

// ----- Alias → canonical (/objects/:type)
const aliasToType: Record<string, string> = {
  "/clients": "client",
  "/resources": "resource",
  "/employees": "employee",
  "/vendors": "vendor",
  "/reservations": "reservation",
  "/events": "event",
  "/products": "product",
  "/registrations": "registration",
};

function rewriteAlias(path: string): string {
  for (const alias of Object.keys(aliasToType)) {
    if (path === alias || path.startsWith(alias + "/")) {
      const suffix = path.slice(alias.length); // "" or "/{id}" or "/list"
      return `/objects/${aliasToType[alias]}${suffix}`;
    }
  }
  // INVENTORY convenience: treat as products
  if (path === "/inventory" || path.startsWith("/inventory/")) {
    const suffix = path.slice("/inventory".length);
    return `/objects/product${suffix}`;
  }
  // /events/:id/registrations -> /objects/registration?eventId=:id
  if (/^\/events\/[^/]+\/registrations$/.test(path)) {
    const id = path.split("/")[2];
    return `/objects/registration?eventId=${encodeURIComponent(id)}`;
  }
  return path;
}

function splitObjectsPath(path: string): { type?: string; tail: string[] } {
  const parts = path.split("/").filter(Boolean);
  if (parts[0] !== "objects") return { tail: parts.slice() };
  const type = parts[1];
  const tail = parts.slice(2); // [], ["list"], [":id"]
  return { type, tail };
}

export const handler = async (evt: ApiEvt) => {
  const method = methodOf(evt);
  try {
    if (method === "OPTIONS") return preflight();

    const rawPath = pathOf(evt);
    if (rawPath === "/health") return ok({ ok: true });

    const path = rewriteAlias(rawPath);

    // /objects/search (and allow ?type=&id= to fall through to GET by id)
    if (path === "/objects/search" && method === "GET") {
      const qs = evt.queryStringParameters ?? {};
      if (qs?.id && qs?.type) {
        return ObjGet.handler(withParams(evt, { type: String(qs.type), id: String(qs.id) }) as any);
      }
      return ObjSearch.handler(evt as any);
    }

    // Canonical /objects/:type router
    if (path.startsWith("/objects/")) {
      const { type, tail } = splitObjectsPath(path);
      if (!type) return notimpl(`${method} ${path} (missing type)`);

      // POST /objects/:type
      if (method === "POST" && tail.length === 0) {
        return ObjCreate.handler(withParams(evt, { type }) as any);
      }

      // PUT /objects/:type/:id
      if (method === "PUT" && tail.length === 1) {
        return ObjUpdate.handler(withParams(evt, { type, id: tail[0] }) as any);
      }

      // GET /objects/:type/:id
      if (method === "GET" && tail.length === 1 && tail[0] !== "list") {
        return ObjGet.handler(withParams(evt, { type, id: tail[0] }) as any);
      }

      // GET /objects/:type/list
      if (method === "GET" && tail.length === 1 && tail[0] === "list") {
        return ObjList.handler(withParams(evt, { type }) as any);
      }

      // GET /objects/:type  (treat as list)
      if (method === "GET" && tail.length === 0) {
        return ObjList.handler(withParams(evt, { type }) as any);
      }

      return notimpl(`${method} ${path}`);
    }

    // Fallback (legacy explicit routes can be handled elsewhere)
    return notimpl(`${method} ${path}`);
  } catch (e: any) {
    console.error("router error", {
      err: e?.message,
      stack: e?.stack,
      method,
      rawPath: pathOf(evt),
    });
    return error(e?.message || "router");
  }
};
