// apps/api/src/index.ts
import type { APIGatewayProxyEventV2, Context } from "aws-lambda";
import { preflight, notimpl, ok, error } from "./common/responses";

import * as ObjCreate from "./objects/create";
import * as ObjUpdate from "./objects/update";
import * as ObjGet from "./objects/get";
import * as ObjList from "./objects/list";
import * as ObjSearch from "./objects/search";
import * as ObjDelete from "./objects/delete";

import { withCors } from "./cors";

// Auth endpoints you already have
import { getPolicy } from "./auth/policy";
import { devLogin } from "./auth/login";

// Use your existing middleware (no util/http or requireAuth)
import { authMiddleware /* , requirePerm */ } from "./auth/middleware";

// ---------------- helpers ----------------
function pathOf(evt: APIGatewayProxyEventV2): string {
  return (evt as any).rawPath || evt.requestContext?.http?.path || "/";
}
function methodOf(evt: APIGatewayProxyEventV2): string {
  return evt.requestContext?.http?.method || (evt as any).requestContext?.httpMethod || "GET";
}

function isHealth(evt: APIGatewayProxyEventV2) {
  const p = pathOf(evt);
  const m = methodOf(evt);
  return (m === "GET" && (p === "/health" || p === "/tools/ping"));
}

// Make a shallow-cloned event with a different path (so we can reuse object handlers)
function withPath(evt: APIGatewayProxyEventV2, newPath: string): APIGatewayProxyEventV2 {
  const rc = evt.requestContext as any;
  return {
    ...evt,
    rawPath: newPath,
    requestContext: {
      ...evt.requestContext,
      http: rc?.http ? { ...rc.http, path: newPath } : (rc || {}),
    } as any,
  };
}

// A resilient dispatcher so we don't assume specific exported names from your object modules
async function dispatch(mod: any, evt: APIGatewayProxyEventV2, ctx?: any) {
  const candidates = ["handle", "handler", "main", "router", "default"];
  for (const k of candidates) {
    if (typeof mod?.[k] === "function") {
      try {
        return mod[k].length >= 2 ? await mod[k](evt, ctx) : await mod[k](evt);
      } catch (e: any) {
        return error(e?.message || "handler_error");
      }
    }
  }
  return notimpl("module handler not found");
}

// ---------------- tools (inline handlers) ----------------
async function toolsEcho(evt: APIGatewayProxyEventV2) {
  const body = evt.body ? JSON.parse(evt.body) : {};
  return ok({ ok: true, now: new Date().toISOString(), received: body });
}

// NOTE: placeholder safe reset; wire to real purgeTenant when ready.
async function toolsReset(_evt: APIGatewayProxyEventV2) {
  return ok({ ok: true, cleared: 0, note: "reset is a no-op placeholder; implement purge when ready" });
}

// ---------------- actions (inline handler) ----------------
/**
 * POST /objects/{type}/{id}/actions/{action}
 * Minimal scaffold: validates & echoes request.
 * Replace with Purchasing/Sales/Integrations FSM logic as you implement.
 */
async function objectAction(evt: APIGatewayProxyEventV2) {
  const m = pathOf(evt).match(/^\/objects\/([^/]+)\/([^/]+)\/actions\/([^/]+)$/);
  if (!m) return notimpl("invalid action route");
  const [, type, id, action] = m;
  const payload = evt.body ? JSON.parse(evt.body) : {};
  // Example of RBAC when you’re ready:
  // const ctx = await authMiddleware(evt);
  // requirePerm(ctx, `action:${type}:${action}`);
  return ok({ ok: true, type, id, action, payload, at: new Date().toISOString() });
}

// ---------------- alias helpers for Views & Workspaces ----------------
// We reuse the generic objects engine by rewriting the path.
async function routeViews(evt: APIGatewayProxyEventV2, authCtx: any) {
  const path = pathOf(evt);
  const method = methodOf(evt);

  // POST /views -> POST /objects/view
  if (method === "POST" && path === "/views") {
    return dispatch(ObjCreate, withPath(evt, "/objects/view"), authCtx);
  }

  // GET /views -> GET /objects/view/list
  if (method === "GET" && path === "/views") {
    return dispatch(ObjList, withPath(evt, "/objects/view/list"), authCtx);
  }

  // /views/{id}
  const idMatch = path.match(/^\/views\/([^/]+)$/);
  if (idMatch) {
    const idPath = idMatch[1];
    if (method === "GET")  return dispatch(ObjGet,    withPath(evt, `/objects/view/${idPath}`), authCtx);
    if (method === "PUT")  return dispatch(ObjUpdate, withPath(evt, `/objects/view/${idPath}`), authCtx);
    if (method === "PATCH")return dispatch(ObjUpdate, withPath(evt, `/objects/view/${idPath}`), authCtx); // passthrough
    if (method === "DELETE")return dispatch(ObjDelete, withPath(evt, `/objects/view/${idPath}`), authCtx);
  }

  return undefined; // not a /views route
}

async function routeWorkspaces(evt: APIGatewayProxyEventV2, authCtx: any) {
  const path = pathOf(evt);
  const method = methodOf(evt);

  // POST /workspaces -> POST /objects/workspace
  if (method === "POST" && path === "/workspaces") {
    return dispatch(ObjCreate, withPath(evt, "/objects/workspace"), authCtx);
  }

  // GET /workspaces -> GET /objects/workspace/list
  if (method === "GET" && path === "/workspaces") {
    return dispatch(ObjList, withPath(evt, "/objects/workspace/list"), authCtx);
  }

  // /workspaces/{id}
  const idMatch = path.match(/^\/workspaces\/([^/]+)$/);
  if (idMatch) {
    const idPath = idMatch[1];
    if (method === "GET")   return dispatch(ObjGet,    withPath(evt, `/objects/workspace/${idPath}`), authCtx);
    if (method === "PUT")   return dispatch(ObjUpdate, withPath(evt, `/objects/workspace/${idPath}`), authCtx);
    if (method === "PATCH") return dispatch(ObjUpdate, withPath(evt, `/objects/workspace/${idPath}`), authCtx); // passthrough
    if (method === "DELETE")return dispatch(ObjDelete, withPath(evt, `/objects/workspace/${idPath}`), authCtx);
  }

  return undefined; // not a /workspaces route
}

// ---------------- router ----------------
// NOTE: we intentionally type this as Promise<any> to avoid APIGatewayProxyResult vs V2 mismatches
const baseHandler = async (evt: APIGatewayProxyEventV2, _ctx: Context): Promise<any> => {
  const path = pathOf(evt);
  const method = methodOf(evt);

  try {
    // CORS preflight
    if (method === "OPTIONS") return preflight();

    // Public/dev auth endpoints (they may return V2-shaped results)
    if (path === "/auth/login" && method === "POST") return await devLogin(evt) as any;
    // ---- health check (public) ----
    if (isHealth(evt)) {
      return ok({ ok: true, ts: new Date().toISOString(), route: path });
    }
    if (path === "/auth/policy" && method === "GET") return await getPolicy(evt) as any;
    // AuthN (have context ready for later checks if desired)
    const authCtx = await authMiddleware(evt);

    // -------- Tools --------
    if (path === "/tools/echo" && method === "POST") return await toolsEcho(evt);
    if (path === "/tools/reset" && method === "POST") {
      // Example: gate behind admin if desired
      // requirePerm(authCtx, "admin:write");
      return await toolsReset(evt);
    }

    // -------- Views & Workspaces (aliases to generic objects engine) --------
    const v = await routeViews(evt, authCtx);
    if (v) return v;
    const w = await routeWorkspaces(evt, authCtx);
    if (w) return w;

    // -------- Object Actions --------
    if (method === "POST" && /^\/objects\/[^/]+\/[^/]+\/actions\/[^/]+$/.test(path)) {
      return await objectAction(evt);
    }

    // -------- Objects CRUD + list/search (existing flow) --------
    // Create: POST /objects/{type}
    if (method === "POST" && /^\/objects\/[^/]+$/.test(path)) {
      return await dispatch(ObjCreate, evt, authCtx);
    }

    // Get: GET /objects/{type}/{id}
    if (method === "GET" && /^\/objects\/[^/]+\/[^/]+$/.test(path)) {
      return await dispatch(ObjGet, evt, authCtx);
    }

    // Update: PUT /objects/{type}/{id} (PATCH also routed to update module)
    if ((method === "PUT" || method === "PATCH") && /^\/objects\/[^/]+\/[^/]+$/.test(path)) {
      return await dispatch(ObjUpdate, evt, authCtx);
    }

    // Delete: DELETE /objects/{type}/{id}
    if (method === "DELETE" && /^\/objects\/[^/]+\/[^/]+$/.test(path)) {
      return await dispatch(ObjDelete, evt, authCtx);
    }

    // List: GET /objects/{type}/list
    if (method === "GET" && /^\/objects\/[^/]+\/list$/.test(path)) {
      return await dispatch(ObjList, evt, authCtx);
    }

    // Search: GET /objects/{type}/search
    if (method === "GET" && /^\/objects\/[^/]+\/search$/.test(path)) {
      return await dispatch(ObjSearch, evt, authCtx);
    }

    // no match
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

// Cast to satisfy any wrapper expectations
export const handler = withCors(baseHandler as any);
