// apps/src/api/index.ts
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { getAuth, requirePerm, policyFromAuth } from "../../api/src/auth/middleware";

/* Routes */
// Views
import * as ViewsList   from "./views/list";
import * as ViewsGet    from "./views/get";
import * as ViewsCreate from "./views/create";
import * as ViewsUpdate from "./views/update";
import * as ViewsDelete from "./views/delete";
// Workspaces
import * as WsList   from "./workspaces/list";
import * as WsGet    from "./workspaces/get";
import * as WsCreate from "./workspaces/create";
import * as WsUpdate from "./workspaces/update";
import * as WsDelete from "./workspaces/delete";
// Objects
import * as ObjList   from "./objects/list";
import * as ObjGet    from "./objects/get";
import * as ObjCreate from "./objects/create";
import * as ObjUpdate from "./objects/update";
import * as ObjDelete from "./objects/delete";
import * as ObjSearch from "./objects/search";
// Dev auth
import * as DevLogin from "./auth/dev-login";

/* Helpers */
const json = (statusCode: number, body: unknown): APIGatewayProxyResultV2 => ({
  statusCode,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});
const notFound = () => json(404, { message: "Not Found" });
const methodNotAllowed = () => json(405, { message: "Method Not Allowed" });
const match = (re: RegExp, s: string) => s.match(re)?.slice(1) ?? null;

function injectPreAuth(
  event: APIGatewayProxyEventV2,
  auth: { userId: string; tenantId: string; roles: string[]; policy: any }
) {
  const anyEvt = event as any;
  anyEvt.requestContext = anyEvt.requestContext || {};
  anyEvt.requestContext.authorizer = anyEvt.requestContext.authorizer || {};
  anyEvt.requestContext.authorizer.mbapp = {
    userId: auth.userId,
    tenantId: auth.tenantId,
    roles: auth.roles,
    policy: auth.policy,
  };
}

/** Back-compat adapter: ensure handlers see type/id in query/path params */
function withTypeId(
  event: APIGatewayProxyEventV2,
  opts: { type?: string; id?: string }
): APIGatewayProxyEventV2 {
  const e: any = { ...event };
  e.queryStringParameters = { ...(event.queryStringParameters || {}) };
  e.pathParameters = { ...(event.pathParameters || {}) };
  if (opts.type && !e.queryStringParameters.type) e.queryStringParameters.type = opts.type;
  if (opts.type && !e.pathParameters.type) e.pathParameters.type = opts.type;
  if (opts.id && !e.pathParameters.id) e.pathParameters.id = opts.id;
  return e;
}

/** Map object method→permission (e.g., product:read / product:write) */
function permForObject(method: string, typeRaw: string) {
  const type = (typeRaw || "").toLowerCase();
  if (method === "GET") return `${type}:read`;
  if (method === "POST" || method === "PUT" || method === "DELETE") return `${type}:write`;
  return "";
}

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  try {
    const method = event.requestContext.http.method;
    const path = event.rawPath || event.requestContext.http.path;

    // Public
    if (method === "GET" && (path === "/health" || path === "/")) {
      return json(200, { ok: true, service: "mbapp-api", now: new Date().toISOString() });
    }
    if (method === "POST" && path === "/auth/dev-login") {
      return DevLogin.handle(event); // gated by DEV_LOGIN_ENABLED
    }

    // Authenticated
    const auth = await getAuth(event);
    injectPreAuth(event, auth);

    if (method === "GET" && path === "/auth/policy") {
      return json(200, policyFromAuth(auth));
    }

    // Views
    if (path === "/views") {
      if (method === "GET")  { requirePerm(auth, "view:read");  return ViewsList.handle(event); }
      if (method === "POST") { requirePerm(auth, "view:write"); return ViewsCreate.handle(event); }
      return methodNotAllowed();
    }
    if (match(/^\/views\/([^/]+)$/i, path)) {
      if (method === "GET")    { requirePerm(auth, "view:read");  return ViewsGet.handle(event); }
      if (method === "PUT")    { requirePerm(auth, "view:write"); return ViewsUpdate.handle(event); }
      if (method === "DELETE") { requirePerm(auth, "view:write"); return ViewsDelete.handle(event); }
      return methodNotAllowed();
    }

    // Workspaces
    if (path === "/workspaces") {
      if (method === "GET")  { requirePerm(auth, "workspace:read");  return WsList.handle(event); }
      if (method === "POST") { requirePerm(auth, "workspace:write"); return WsCreate.handle(event); }
      return methodNotAllowed();
    }
    if (match(/^\/workspaces\/([^/]+)$/i, path)) {
      if (method === "GET")    { requirePerm(auth, "workspace:read");  return WsGet.handle(event); }
      if (method === "PUT")    { requirePerm(auth, "workspace:write"); return WsUpdate.handle(event); }
      if (method === "DELETE") { requirePerm(auth, "workspace:write"); return WsDelete.handle(event); }
      return methodNotAllowed();
    }

    /* ========= Objects ========= */

    // /objects/:type/search
    const searchParts = match(/^\/objects\/([^/]+)\/search$/i, path);
    if (searchParts) {
      const [type] = searchParts;
      requirePerm(auth, permForObject("GET", type));
      return ObjSearch.handle(withTypeId(event, { type }));
    }

    // /objects/:type (list or create)
    const collParts = match(/^\/objects\/([^/]+)$/i, path);
    if (collParts) {
      const [type] = collParts;
      if (method === "GET")  { requirePerm(auth, permForObject("GET", type));  return ObjList.handle(withTypeId(event, { type })); }
      if (method === "POST") { requirePerm(auth, permForObject("POST", type)); return ObjCreate.handle(withTypeId(event, { type })); }
      return methodNotAllowed();
    }

    // /objects/:type/:id (get/update/delete)
    const itemParts = match(/^\/objects\/([^/]+)\/([^/]+)$/i, path);
    if (itemParts) {
      const [type, id] = itemParts;
      if (method === "GET")    { requirePerm(auth, permForObject("GET", type));    return ObjGet.handle(withTypeId(event, { type, id })); }
      if (method === "PUT")    { requirePerm(auth, permForObject("PUT", type));    return ObjUpdate.handle(withTypeId(event, { type, id })); }
      if (method === "DELETE") { requirePerm(auth, permForObject("DELETE", type)); return ObjDelete.handle(withTypeId(event, { type, id })); }
      return methodNotAllowed();
    }

    return notFound();
  } catch (e: any) {
    const status = e?.statusCode ?? 500;
    return json(status, { message: e?.message ?? "Internal Server Error" });
  }
}
