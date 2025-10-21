// apps/src/api/index.ts
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { getAuth, requirePerm, policyFromAuth } from "./auth/middleware";
import { buildCtx, attachCtxToEvent } from "./shared/ctx";

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

// Actions
// Purchase Orders
import * as PoSubmit   from "./purchasing/po-submit";
import * as PoApprove  from "./purchasing/po-approve";
import * as PoReceive  from "./purchasing/po-receive";
import * as PoCancel   from "./purchasing/po-cancel";
import * as PoClose    from "./purchasing/po-close";
// Sales Orders
import * as SoSubmit   from "./sales/so-submit";
import * as SoCommit   from "./sales/so-commit";
import * as SoFulfill  from "./sales/so-fulfill";
import * as SoCancel   from "./sales/so-cancel";
import * as SoClose    from "./sales/so-close";
import * as SoReserve  from "./sales/so-reserve";
import * as SoRelease  from "./sales/so-release";

// Inventory on-hand (computed from movements)
import * as InvOnHandGet from "./inventory/onhand-get";
import * as InvOnHandBatch from "./inventory/onhand-batch";

// Inventory search (rich)
import * as InvSearch from "./inventory/search";

// Inventory computed endpoints
import * as InvMovements from "./inventory/movements";

// Registrations & Reservations actions
import * as RegCancel  from "./events/registration-cancel";
import * as RegCheckin from "./events/registration-checkin";
import * as RegCheckout from "./events/registration-checkout";
import * as ResCancel  from "./resources/reservation-cancel";
import * as ResStart   from "./resources/reservation-start";
import * as ResEnd     from "./resources/reservation-end";

// Tools
import * as GcList   from "./tools/gc-list-type";
import * as GcDelete from "./tools/gc-delete-type";
import * as GcListAll   from "./tools/gc-list-all";
import * as GcDeleteKeys from "./tools/gc-delete-keys";

// Routing & Delivery
import * as RoutingGraphUpsert from "./routing/graph-upsert";
import * as RoutingPlanCreate from "./routing/plan-create";
import * as RoutingPlanGet from "./routing/plan-get";

// EPC & SCANNERS (uncommented per request)
import * as EpcResolve from "./epc/resolve";
import * as ScannerSessions from "./scanner/sessions";
import * as ScannerActions from "./scanner/actions";
import * as ScannerSim from "./scanner/simulate";

// Purchasing suggestions
import * as PoSuggest from "./purchasing/suggest-po";
import * as PoCreateFromSuggestion from "./purchasing/po-create-from-suggestion";

// Backorders
import * as BoIgnore  from "./backorders/request-ignore";
import * as BoConvert from "./backorders/request-convert";

/* Helpers */
const json = (statusCode: number, body: unknown): APIGatewayProxyResultV2 => ({
  statusCode,
  headers: {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "OPTIONS,GET,POST,PUT,DELETE",
    "access-control-allow-headers": "Authorization,Content-Type,Idempotency-Key,X-Tenant-Id,Accept",
  },
  body: JSON.stringify(body),
});
const notFound = () => json(404, { message: "Not Found" });
const methodNotAllowed = () => json(405, { message: "Method Not Allowed" });
const match = (re: RegExp, s: string) => s.match(re)?.slice(1) ?? null;

/** Ensure action handlers see { pathParameters: { id } } */
function withId(event: APIGatewayProxyEventV2, id: string): APIGatewayProxyEventV2 {
  const e: any = { ...event };
  e.pathParameters = { ...(event.pathParameters || {}), id };
  return e;
}

/** Preflight CORS */
function isPreflight(e: APIGatewayProxyEventV2) {
  return e.requestContext.http.method === "OPTIONS";
}
const corsOk = (): APIGatewayProxyResultV2 => ({
  statusCode: 204,
  headers: {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "OPTIONS,GET,POST,PUT,DELETE",
    "access-control-allow-headers": "Authorization,Content-Type,Idempotency-Key,X-Tenant-Id,Accept",
  },
});

/** Inject pre-auth */
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
    if (isPreflight(event)) return corsOk();

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

    // Build a typed ctx (includes idempotencyKey + requestId) and attach it
    const ctx = buildCtx(event, auth);
    attachCtxToEvent(event, ctx);

    if (method === "GET" && path === "/auth/policy") {
      return json(200, policyFromAuth(auth));
    }

    // Views
    if (path === "/views") {
      if (method === "GET")  { requirePerm(auth, "view:read");  return ViewsList.handle(event); }
      if (method === "POST") { requirePerm(auth, "view:write"); return ViewsCreate.handle(event); }
      return methodNotAllowed();
    }
    {
      const m = match(/^\/views\/([^/]+)$/i, path);
      if (m) {
        const [id] = m;
        if (method === "GET")    { requirePerm(auth, "view:read");  return ViewsGet.handle(withId(event, id)); }
        if (method === "PUT")    { requirePerm(auth, "view:write"); return ViewsUpdate.handle(withId(event, id)); }
        if (method === "DELETE") { requirePerm(auth, "view:write"); return ViewsDelete.handle(withId(event, id)); }
        return methodNotAllowed();
      }
    }

    // Workspaces
    if (path === "/workspaces") {
      if (method === "GET")  { requirePerm(auth, "workspace:read");  return WsList.handle(event); }
      if (method === "POST") { requirePerm(auth, "workspace:write"); return WsCreate.handle(event); }
      return methodNotAllowed();
    }
    {
      const m = match(/^\/workspaces\/([^/]+)$/i, path);
      if (m) {
        const [id] = m;
        if (method === "GET")    { requirePerm(auth, "workspace:read");  return WsGet.handle(withId(event, id)); }
        if (method === "PUT")    { requirePerm(auth, "workspace:write"); return WsUpdate.handle(withId(event, id)); }
        if (method === "DELETE") { requirePerm(auth, "workspace:write"); return WsDelete.handle(withId(event, id)); }
        return methodNotAllowed();
      }
    }

    /* ========= Actions ========= */
    // Purchasing PO actions
    {
      const m = match(/^\/purchasing\/po\/([^/]+):(submit|approve|receive|cancel|close)$/i, path);
      if (m) {
        const [id, action] = m;
        switch (action) {
          case "submit":  requirePerm(auth, "purchase:write");   return PoSubmit.handle(withId(event, id));
          case "approve": requirePerm(auth, "purchase:approve"); return PoApprove.handle(withId(event, id));
          case "receive": requirePerm(auth, "purchase:receive"); return PoReceive.handle(withId(event, id));
          case "cancel":  requirePerm(auth, "purchase:cancel");  return PoCancel.handle(withId(event, id));
          case "close":   requirePerm(auth, "purchase:close");   return PoClose.handle(withId(event, id));
        }
        return methodNotAllowed();
      }
    }

    // Sales SO actions
    {
      const m = match(/^\/sales\/so\/([^/]+):(submit|commit|reserve|release|fulfill|cancel|close)$/i, path);
      if (m) {
        const [id, action] = m;
        switch (action) {
          case "submit":  requirePerm(auth, "sales:write");    return SoSubmit.handle(withId(event, id));
          case "commit":  requirePerm(auth, "sales:commit");   return SoCommit.handle(withId(event, id));
          case "reserve": requirePerm(auth, "sales:reserve");  return SoReserve.handle(withId(event, id));
          case "release": requirePerm(auth, "sales:reserve");  return SoRelease.handle(withId(event, id)); // same perm bucket as reserve
          case "fulfill": requirePerm(auth, "sales:fulfill");  return SoFulfill.handle(withId(event, id));
          case "cancel":  requirePerm(auth, "sales:cancel");   return SoCancel.handle(withId(event, id));
          case "close":   requirePerm(auth, "sales:close");    return SoClose.handle(withId(event, id));
        }
        return methodNotAllowed();
      }
    }

    // Inventory — onhand (computed)
    {
      const m = path.match(/^\/inventory\/([^/]+)\/onhand$/i);
      if (method === "GET" && m) {
        const [, id] = m;
        requirePerm(auth, "inventory:read");
        return InvOnHandGet.handle({ ...event, pathParameters: { ...(event.pathParameters||{}), id } });
      }
    }

    // Inventory — onhand batch (computed)
    if (method === "POST" && path === "/inventory/onhand:batch") {
      requirePerm(auth, "inventory:read");
      const body = JSON.parse(event.body || "{}");
      const itemIds = Array.isArray(body?.itemIds) ? body.itemIds : [];
      return InvOnHandBatch.handle({ ...event, body: JSON.stringify({ itemIds }) });
    }

    // Inventory — movements (computed)
    {
      const m = path.match(/^\/inventory\/([^/]+)\/movements$/i);
      if (method === "GET" && m) {
        const [, id] = m;
        requirePerm(auth, "inventory:read");
        return InvMovements.handle({ ...event, pathParameters: { ...(event.pathParameters||{}), id } });
      }
    }

    // Rich inventory search (label + uom + counters)
    if (path === "/inventory/search" && method === "POST") {
      requirePerm(auth, "inventory:read");
      return InvSearch.handle(event);
    }

    // Routing & Delivery 
    if (method === "POST" && path === "/routing/graph") {
      requirePerm(auth, "routing:write");
      return RoutingGraphUpsert.handle(event);
    }

    if (method === "POST" && path === "/routing/plan") {
      requirePerm(auth, "routing:write");
      return RoutingPlanCreate.handle(event);
    }

    {
      const m = match(/^\/routing\/plan\/([^/]+)$/i, path);
      if (m && method === "GET") {
        const [id] = m;
        requirePerm(auth, "routing:read");
        return RoutingPlanGet.handle(withId(event, id));
      }
    }

    // EPC: resolve a tag to an item
    if (method === "GET" && path === "/epc/resolve") {
      requirePerm(auth, "inventory:read");
      // Handler reads ?epc=... from event.queryStringParameters
      return EpcResolve.handle(event);
    }

    // Purchasing suggestion endpoints
    if (method === "POST" && path === "/purchasing/suggest-po") {
      requirePerm(auth, "purchase:write");
      return PoSuggest.handle(event);
    }
    if (method === "POST" && path === "/purchasing/po:create-from-suggestion") {
      requirePerm(auth, "purchase:write");
      return PoCreateFromSuggestion.handle(event);
    }

    // Backorder request actions
    {
      const m = match(/^\/objects\/backorderRequest\/([^/]+):(ignore|convert)$/i, path);
      if (m) {
        const [id, action] = m;
        if (action === "ignore")  { requirePerm(auth, "objects:write"); return BoIgnore.handle(withId(event, id)); }
        if (action === "convert") { requirePerm(auth, "objects:write"); return BoConvert.handle(withId(event, id)); }
        return methodNotAllowed();
      }
    }

    // Scanner sessions: start/stop
    if (method === "POST" && path === "/scanner/sessions") {
      requirePerm(auth, "scanner:use");
      return ScannerSessions.handle(event);
    }

    // Scanner actions: receive | pick | count | move
    if (method === "POST" && path === "/scanner/actions") {
      requirePerm(auth, "scanner:use");
      // If you pass idempotency in headers today, the handler will consume it.
      return ScannerActions.handle(event);
    }

    // Dev-only: simulate EPCs for testing
    if (method === "POST" && path === "/scanner/simulate") {
      requirePerm(auth, "admin:seed");
      return ScannerSim.handle(event);
    }

    // Tools: GC
    const gcList = match(/^\/tools\/gc\/([^/]+)$/i, path);
    if (gcList && method === "GET")    { requirePerm(auth, "admin:reset"); return GcList.handle(withTypeId(event, { type: gcList[0] })); }
    if (gcList && method === "DELETE") { requirePerm(auth, "admin:reset"); return GcDelete.handle(withTypeId(event, { type: gcList[0] })); }
    // Admin GC helpers
    if (path === "/tools/gc/list-all" && method === "GET") {
      requirePerm(auth, "admin:reset");
      return GcListAll.handle(event);
    }
    if (path === "/tools/gc/delete-keys" && method === "POST") {
      requirePerm(auth, "admin:reset");
      return GcDeleteKeys.handle(event);
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

    // /objects/:type/:id (update|get|delete)
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
