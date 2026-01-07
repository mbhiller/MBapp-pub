// apps/src/api/index.ts
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { notFound as respondNotFound, unauthorized, forbidden, internalError } from "./common/responses";
import { getAuth, requirePerm, policyFromAuth } from "./auth/middleware";
import { buildCtx, attachCtxToEvent } from "./shared/ctx";
import { normalizeTypeParam } from "./objects/type-alias";

/* Routes */
// Views
import * as ViewsList   from "./views/list";
import * as ViewsGet    from "./views/get";
import * as ViewsCreate from "./views/create";
import * as ViewsUpdate from "./views/update";
import * as ViewsPatch  from "./views/patch";
import * as ViewsDelete from "./views/delete";

// Workspaces
import * as WsList   from "./workspaces/list";
import * as WsGet    from "./workspaces/get";
import * as WsCreate from "./workspaces/create";
import * as WsUpdate from "./workspaces/update";
import * as WsPatch  from "./workspaces/patch";
import * as WsDelete from "./workspaces/delete";

// Registrations
import * as RegList   from "./registrations/list";
import * as RegGet    from "./registrations/get";
import * as RegCreate from "./registrations/create";
import * as RegUpdate from "./registrations/update";
import * as RegDelete from "./registrations/delete";

// Objects
import * as ObjList   from "./objects/list";
import * as ObjGet    from "./objects/get";
import * as ObjCreate from "./objects/create";
import * as ObjUpdate from "./objects/update";
import * as ObjDelete from "./objects/delete";
import * as ObjSearch from "./objects/search";
import * as PartyBatch from "./objects/party-batch";
// Messages
import * as MessageList from "./messages/list";
import * as MessageRetry from "./messages/retry";
import * as MessageRetryFailed from "./messages/retry-failed";
// Dev auth
import * as DevLogin from "./auth/dev-login";

// Actions
// Purchase Orders
import * as PoSubmit   from "./purchasing/po-submit";
import * as PoApprove  from "./purchasing/po-approve";
import * as PoReceive  from "./purchasing/po-receive";
import * as PoCancel   from "./purchasing/po-cancel";
import * as PoClose    from "./purchasing/po-close";
import * as PoPatchLines from "./purchasing/po-patch-lines";
// Sales Orders
import * as SoSubmit   from "./sales/so-submit";
import * as SoCommit   from "./sales/so-commit";
import * as SoFulfill  from "./sales/so-fulfill";
import * as SoCancel   from "./sales/so-cancel";
import * as SoClose    from "./sales/so-close";
import * as SoReserve  from "./sales/so-reserve";
import * as SoRelease  from "./sales/so-release";
// Use require to avoid transient TS module resolution hiccup for hyphenated filename
const SoPatchLines = require("./sales/so-patch-lines");

// Inventory on-hand (computed from movements)
import * as InvOnHandGet from "./inventory/onhand-get";
import * as InvOnHandBatch from "./inventory/onhand-batch";
import * as InvOnHandByLocation from "./inventory/onhand-by-location";

// Inventory search (rich)
import * as InvSearch from "./inventory/search";

// Inventory computed endpoints
import * as InvMovements from "./inventory/movements";

// Inventory actions
import * as InvPutaway from "./inventory/putaway";
import * as InvCycleCount from "./inventory/cycle-count";
import * as InvAdjust from "./inventory/adjust";

// Reservations & Resources
import * as ReservationsCheckConflicts from "./reservations/check-conflicts";
import * as ResourcesAvailability from "./resources/availability";
import * as ReservationHoldsList from "./reservations/holds-list";


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

// Webhooks
import * as StripeWebhook from "./webhooks/stripe-handler";

// Public endpoints (Sprint AU)
import * as EventsPublicList from "./events/public-list";
import * as RegPublicCreate from "./registrations/public-create";
import * as RegCheckout from "./registrations/checkout";
import * as RegPublicGet from "./registrations/public-get";
import * as RegPublicResend from "./registrations/public-resend";
import * as RegCleanupExpiredHolds from "./registrations/cleanup-expired-holds";
import * as RegCancel from "./registrations/cancel";
import * as RegCancelRefund from "./registrations/cancel-refund";
import * as RegAssignStalls from "./registrations/assign-stalls";
import * as RegAssignRvSites from "./registrations/assign-rv-sites";
// Internal jobs
import * as JobsRun from "./jobs/run";
import { runBackgroundJobs } from "./jobs/background";

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
const methodNotAllowed = () => json(405, { message: "Method Not Allowed" });
const match = (re: RegExp, s: string) => s.match(re)?.slice(1) ?? null;

/** Ensure action handlers see { pathParameters: { id } } */
function withId(event: APIGatewayProxyEventV2, id: string): APIGatewayProxyEventV2 {
  const e: any = { ...event };
  e.pathParameters = { ...(event.pathParameters || {}), id };
  return e;
}

/** Preflight CORS - universal fast-path (no auth required) */
function isPreflight(e: APIGatewayProxyEventV2) {
  return e.requestContext.http.method === "OPTIONS";
}
const corsOk = (): APIGatewayProxyResultV2 => ({
  statusCode: 204,
  headers: {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS,PUT,DELETE",
    "access-control-allow-headers": "*",
    "access-control-max-age": "600",
  },
  body: "",
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

/** Map object method→action for permission strings */
function actionForObjectMethod(method: string) {
  const m = method.toUpperCase();
  if (m === "GET" || m === "HEAD") return "read";
  if (m === "POST" || m === "PUT" || m === "DELETE") return "write";
  return "";
}

/**
 * Relaxed object-type gate for /objects routes.
 * Only reject missing/empty/invalid type strings; allow arbitrary types.
 * Special-case validation (e.g., inventoryMovement action allowlist) happens in handlers.
 */
function assertAllowedObjectType(typeRaw: string): APIGatewayProxyResultV2 | null {
  const t = String(typeRaw ?? "").trim();
  if (!t || t.toLowerCase() === "undefined" || t.toLowerCase() === "null") {
    return json(400, { message: "Missing or invalid object type", code: "INVALID_OBJECT_TYPE", type: typeRaw });
  }
  return null;
}

/**
 * Map object type to canonical module permission prefix.
 * Normalizes compound/camelCase types to match module-based permission keys.
 */
function typeToPermissionPrefix(typeRaw: string): string {
  // Normalize to canonical type first (handles casing variants and aliases)
  const canonicalType = normalizeTypeParam(typeRaw) ?? typeRaw.trim();
  
  // Map canonical object types to their permission module prefixes
  const moduleMap: Record<string, string> = {
    "salesOrder": "sales",
    "purchaseOrder": "purchase",
    "inventoryItem": "inventory",
  };
  
  // Return mapped prefix or fall back to canonical type for party, product, etc.
  return moduleMap[canonicalType] || canonicalType;
}

/** Require object access, allowing generic objects:* as a fallback for new types (e.g., location) */
function requireObjectPerm(auth: any, method: string, typeRaw: string) {
  const action = actionForObjectMethod(method);
  const prefix = typeToPermissionPrefix(typeRaw);
  const specific = action ? `${prefix}:${action}` : "";
  const generic = action ? `objects:${action}` : "";

  try {
    if (specific) requirePerm(auth, specific);
    else requirePerm(auth, "");
  } catch (err) {
    if (generic) {
      try {
        requirePerm(auth, generic);
        return;
      } catch {
        // fall through and rethrow original error
      }
    }
    throw err;
  }
}

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  try {
    // Allow EventBridge (or other non-HTTP) invokes to trigger background jobs.
    // Detect via lightweight event shape: source === "mbapp.jobs" or a top-level jobType.
    const anyEvt: any = event as any;
    if ((anyEvt && (anyEvt.source === "mbapp.jobs" || anyEvt.jobType)) && !anyEvt?.requestContext?.http) {
      const rawType = String(anyEvt.jobType || "all").toLowerCase();
      const limit = Number.isFinite(anyEvt.limit) ? Math.max(1, Math.floor(anyEvt.limit)) : undefined;
      const tenantId = typeof anyEvt.tenantId === "string" && anyEvt.tenantId.trim() ? anyEvt.tenantId.trim() : undefined;

      const run = async (t: "cleanup-expired-holds" | "retry-failed-messages") =>
        runBackgroundJobs({ jobType: t, ...(limit ? { limit } : {}), ...(tenantId ? { tenants: [tenantId] } : {}) });

      if (rawType === "all") {
        const a = await run("cleanup-expired-holds");
        const b = await run("retry-failed-messages");
        return json(200, { results: [...a.results, ...b.results] });
      }

      const allowed = rawType === "cleanup-expired-holds" || rawType === "retry-failed-messages" ? rawType : "cleanup-expired-holds";
      const group = await run(allowed as any);
      return json(200, { results: group.results });
    }

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
    // Stripe webhook (public, no auth - signature verified in handler)
    if (method === "POST" && path === "/webhooks/stripe") {
      return StripeWebhook.handle(event);
    }
    // Public event listing (Sprint AU)
    if (method === "GET" && path === "/events:public") {
      return EventsPublicList.handle(event);
    }
    // Public registration create (Sprint AU)
    if (method === "POST" && path === "/registrations:public") {
      return RegPublicCreate.handle(event);
    }
    // Public registration checkout (Sprint AU)
    {
      const m = path.match(/^\/events\/registration\/([^/]+):checkout$/i);
      if (method === "POST" && m) {
        const [, id] = m;
        return RegCheckout.handle(withId(event, id));
      }
    }
    // Public registration status (Sprint AY)
    {
      const m = path.match(/^\/registrations\/([^/]+):public$/i);
      if (method === "GET" && m) {
        const [, id] = m;
        return RegPublicGet.handle(withId(event, id));
      }
    }
    // Public registration resend (Sprint BC)
    {
      const m = path.match(/^\/registrations\/([^/]+):public-resend$/i);
      if (method === "POST" && m) {
        const [, id] = m;
        return RegPublicResend.handle(withId(event, id));
      }
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

    // Views (Sprint III)
    {
      const m = path.match(/^\/views(?:\/([^\/:]+))?$/i);
      if (m) {
        const [, id] = m;
        if (method === "GET" && !id)    { requirePerm(auth, "view:read");  return ViewsList.handle(event); }
        if (method === "GET" && id)     { requirePerm(auth, "view:read");  return ViewsGet.handle(withId(event, id)); }
        if (method === "POST" && !id)   { requirePerm(auth, "view:write"); return ViewsCreate.handle(event); }
        if (method === "PUT" && id)     { requirePerm(auth, "view:write"); return ViewsUpdate.handle(withId(event, id)); }
        if (method === "PATCH" && id)   { requirePerm(auth, "view:write"); return ViewsPatch.handle(withId(event, id)); }
        if (method === "DELETE" && id)  { requirePerm(auth, "view:write"); return ViewsDelete.handle(withId(event, id)); }
        return methodNotAllowed();
      }
    }

    // Workspaces (Sprint III v1: list only)
    {
      const m = path.match(/^\/workspaces(?:\/([^\/:]+))?$/i);
      if (m) {
        const [, id] = m;
        if (method === "GET" && !id)    { requirePerm(auth, "workspace:read");  return WsList.handle(event); }
        if (method === "GET" && id)     { requirePerm(auth, "workspace:read");  return WsGet.handle(withId(event, id)); }
        if (method === "POST" && !id)   { requirePerm(auth, "workspace:write"); return WsCreate.handle(event); }
        if (method === "PUT" && id)     { requirePerm(auth, "workspace:write"); return WsUpdate.handle(withId(event, id)); }
        if (method === "PATCH" && id)   { requirePerm(auth, "workspace:write"); return WsPatch.handle(withId(event, id)); }
        if (method === "DELETE" && id)  { requirePerm(auth, "workspace:write"); return WsDelete.handle(withId(event, id)); }
        return methodNotAllowed();
      }
    }

    // Registrations (Tier-1 foundation; feature-guarded per request)
    {
      // Exclude action suffixes like ":cancel"/":cancel-refund" from the base matcher by disallowing ':' in the id
      const m = path.match(/^\/registrations(?:\/([^\/:]+))?$/i);
      if (m) {
        const [, id] = m;
        if (method === "GET" && !id)    { return RegList.handle(event); }
        if (method === "GET" && id)     { return RegGet.handle(withId(event, id)); }
        if (method === "POST" && !id)   { return RegCreate.handle(event); }
        if (method === "PUT" && id)     { return RegUpdate.handle(withId(event, id)); }
        if (method === "DELETE" && id)  { return RegDelete.handle(withId(event, id)); }
        return methodNotAllowed();
      }
    }

    // Registrations: cleanup expired holds (Sprint AV)
    if (method === "POST" && path === "/registrations:cleanup-expired-holds") {
      requirePerm(auth, "registration:write");
      return RegCleanupExpiredHolds.handle(event);
    }

    // Registrations: operator cancel
    {
      const m = path.match(/^\/registrations\/([^/]+):cancel$/i);
      if (method === "POST" && m) {
        const [, id] = m;
        requirePerm(auth, "registration:write");
        return RegCancel.handle(withId(event, id));
      }
    }

    // Registrations: operator cancel+refund
    {
      const m = path.match(/^\/registrations\/([^/]+):cancel-refund$/i);
      if (method === "POST" && m) {
        const [, id] = m;
        requirePerm(auth, "registration:write");
        return RegCancelRefund.handle(withId(event, id));
      }
    }

    // Registrations: operator assign stalls
    {
      const m = path.match(/^\/registrations\/([^/]+):assign-stalls$/i);
      if (method === "POST" && m) {
        const [, id] = m;
        requirePerm(auth, "registration:write");
        return RegAssignStalls.handle(withId(event, id));
      }
    }

    // Registrations: operator assign RV sites
    {
      const m = path.match(/^\/registrations\/([^/]+):assign-rv-sites$/i);
      if (method === "POST" && m) {
        const [, id] = m;
        requirePerm(auth, "registration:write");
        return RegAssignRvSites.handle(withId(event, id));
      }
    }

    // Messages: retry failed message
    if (method === "POST") {
      const m = path.match(/^\/messages\/([^/]+):retry$/i);
      if (m) {
        const [, id] = m;
        requirePerm(auth, "message:write");
        return MessageRetry.handle(withId(event, id));
      }
    }

    // Messages: batch retry failed
    if (method === "POST" && path === "/messages:retry-failed") {
      requirePerm(auth, "message:write");
      return MessageRetryFailed.handle(event);
    }

    // Internal: on-demand background jobs
    if (method === "POST" && (path === "/internal/jobs:run" || path === "/jobs:run")) {
      requirePerm(auth, "ops:jobs:run");
      return JobsRun.handle(event);
    }

    // Messages: list
    if (method === "GET" && path === "/messages") {
      requirePerm(auth, "message:read");
      return MessageList.handle(event);
    }

    /* ========= Actions ========= */
    // Purchasing PO actions
    {
      const m = match(/^\/purchasing\/po\/([^/]+):(submit|approve|receive|cancel|close|patch-lines)$/i, path);
      if (m) {
        const [id, action] = m;
        switch (action) {
          case "submit":  requirePerm(auth, "purchase:write");   return PoSubmit.handle(withId(event, id));
          case "approve": requirePerm(auth, "purchase:approve"); return PoApprove.handle(withId(event, id));
          case "receive": requirePerm(auth, "purchase:receive"); return PoReceive.handle(withId(event, id));
          case "cancel":  requirePerm(auth, "purchase:cancel");  return PoCancel.handle(withId(event, id));
          case "close":   requirePerm(auth, "purchase:close");   return PoClose.handle(withId(event, id));
          case "patch-lines": requirePerm(auth, "purchase:write"); return PoPatchLines.handle(withId(event, id));
        }
        return methodNotAllowed();
      }
    }

    // Sales SO actions
    {
      const m = match(/^\/sales\/so\/([^/]+):(submit|commit|reserve|release|fulfill|cancel|close|patch-lines)$/i, path);
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
          case "patch-lines": requirePerm(auth, "sales:write"); return SoPatchLines.handle(withId(event, id));
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

    // Inventory — onhand by location (computed)
    {
      const m = path.match(/^\/inventory\/([^/]+)\/onhand:by-location$/i);
      if (method === "GET" && m) {
        const [, id] = m;
        requirePerm(auth, "inventory:read");
        return InvOnHandByLocation.handle({ ...event, pathParameters: { ...(event.pathParameters||{}), id } });
      }
    }

    // Objects — party batch
    if (method === "POST" && path === "/objects/party:batch") {
      requirePerm(auth, "party:read");
      const body = JSON.parse(event.body || "{}");
      const partyIds = Array.isArray(body?.partyIds) ? body.partyIds : [];
      return PartyBatch.handle({ ...event, body: JSON.stringify({ partyIds }) });
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

    // Inventory — movements by location
    if (path === "/inventory/movements" && method === "GET") {
      requirePerm(auth, "inventory:read");
      return InvMovements.handleByLocation(event);
    }

    // Rich inventory search (label + uom + counters)
    if (path === "/inventory/search" && method === "POST") {
      requirePerm(auth, "inventory:read");
      return InvSearch.handle(event);
    }

    // Inventory actions
    {
      const m = match(/^\/inventory\/([^/]+):(putaway|cycle-count|adjust)$/i, path);
      if (m) {
        const [id, action] = m;
        switch (action) {
          case "putaway": requirePerm(auth, "inventory:write"); return InvPutaway.handle({ ...event, pathParameters: { ...(event.pathParameters||{}), id } });
          case "cycle-count": requirePerm(auth, "inventory:adjust"); return InvCycleCount.handle({ ...event, pathParameters: { ...(event.pathParameters||{}), id } });
          case "adjust": requirePerm(auth, "inventory:write"); return InvAdjust.handle({ ...event, pathParameters: { ...(event.pathParameters||{}), id } });
        }
        return methodNotAllowed();
      }
    }

    // Optional alias: /inventory/{id}/adjust
    {
      const m = match(/^\/inventory\/([^/]+)\/adjust$/i, path);
      if (m && method === "POST") {
        const [id] = m;
        requirePerm(auth, "inventory:write");
        return InvAdjust.handle({ ...event, pathParameters: { ...(event.pathParameters||{}), id } });
      }
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

    // Reservations: check conflicts
    if (method === "POST" && path === "/reservations:check-conflicts") {
      requirePerm(auth, "reservation:read");
      return ReservationsCheckConflicts.handle(event);
    }

    // Reservation holds: by-owner listing
    if (method === "GET" && path === "/reservation-holds") {
      requirePerm(auth, "registration:read");
      return ReservationHoldsList.handle(event);
    }

    // Resources: availability query
    {
      const m = match(/^\/resources\/([^/]+)\/availability$/i, path);
      if (m && method === "GET") {
        const [id] = m;
        requirePerm(auth, "resource:read");
        return ResourcesAvailability.handle(withId(event, id));
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
      {
        const bad = assertAllowedObjectType(type);
        if (bad) return bad;
      }
      requireObjectPerm(auth, method, type);
      return ObjSearch.handle(withTypeId(event, { type }));
    }

    // /objects/:type (list or create)
    const collParts = match(/^\/objects\/([^/]+)$/i, path);
    if (collParts) {
      const [type] = collParts;
      {
        const bad = assertAllowedObjectType(type);
        if (bad) return bad;
      }
      if (method === "GET")  { requireObjectPerm(auth, method, type); return ObjList.handle(withTypeId(event, { type })); }
      if (method === "POST") { requireObjectPerm(auth, method, type); return ObjCreate.handle(withTypeId(event, { type })); }
      return methodNotAllowed();
    }

    // /objects/:type/:id (update|get|delete)
    const itemParts = match(/^\/objects\/([^/]+)\/([^/]+)$/i, path);
    if (itemParts) {
      const [type, id] = itemParts;
      {
        const bad = assertAllowedObjectType(type);
        if (bad) return bad;
      }
      if (method === "GET")    { requireObjectPerm(auth, method, type); return ObjGet.handle(withTypeId(event, { type, id })); }
      if (method === "PUT")    { requireObjectPerm(auth, method, type); return ObjUpdate.handle(withTypeId(event, { type, id })); }
      if (method === "DELETE") { requireObjectPerm(auth, method, type); return ObjDelete.handle(withTypeId(event, { type, id })); }
      return methodNotAllowed();
    }

    return respondNotFound();
  } catch (e: any) {
    const status = e?.statusCode ?? 500;
    const message = e?.message ?? "Internal Server Error";
    if (status === 401) return unauthorized(message);
    if (status === 403) return forbidden(message);
    if (status === 404) return respondNotFound(message);
    return internalError(e);
  }
}
