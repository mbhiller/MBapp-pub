// apps/api/src/index.ts
import { handler as getObject } from "./objects/get";
import { handler as createObject } from "./objects/create";
import { handler as updateObject } from "./objects/update";
import { handler as listObjects } from "./objects/list";
import { handler as searchObjects } from "./objects/search";
import { ok, bad, notimpl, preflight, error as errResp } from "./common/responses";

export const handler = async (evt: any) => {
  // Basic context
  const method: string = evt?.requestContext?.http?.method || "";
  const routeKey: string = evt?.routeKey || evt?.requestContext?.routeKey || "";
  const rawPath: string = evt?.rawPath || "";

  // CORS preflight
  if (method.toUpperCase() === "OPTIONS") {
    return preflight();
  }

  const t0 = Date.now();
  let resp: any;

  try {
    switch (routeKey) {
      // Canonical GET (primary)
      case "GET /objects/{type}/{id}":
        resp = await getObject(evt);
        break;

      // Legacy shape: GET /objects/{id}?type=...
      case "GET /objects/{id}":
        resp = await getObject(evt);
        break;

      // Create + Update
      case "POST /objects/{type}":
        resp = await createObject(evt);
        break;
      case "PUT /objects/{type}/{id}":
        resp = await updateObject(evt);
        break;

      // Listing / Search
      case "GET /objects/{type}/list":
        resp = await listObjects(evt);
        break;
      case "GET /objects/{type}": // allow fallback to list
        resp = await listObjects(evt);
        break;
      case "GET /objects/search":
        resp = await searchObjects(evt);
        break;

      // Simple tenants stub
      case "GET /tenants":
        resp = ok([{ id: "DemoTenant", name: "DemoTenant" }]);
        break;

      // Explicitly not implemented
      case "GET /objects":
      case "DELETE /objects/{type}/{id}":
        resp = notimpl(routeKey);
        break;

      default:
        resp = bad(`Unsupported route ${method} ${rawPath}`);
        break;
    }
  } catch (e) {
    // Handlers already catch most errors; this is a safety net
    resp = errResp(e);
  } finally {
    const reqId: string = evt?.requestContext?.requestId || "";
    const dur = Date.now() - t0;

    // Ensure headers & add correlation id
    resp = resp || { statusCode: 500, headers: {}, body: JSON.stringify({ error: "Internal", message: "No response" }) };
    resp.headers = { ...(resp.headers || {}), "x-request-id": reqId };

    // Structured log
    console.log(JSON.stringify({
      level: "info",
      requestId: reqId,
      routeKey,
      method,
      path: rawPath,
      statusCode: resp.statusCode,
      durationMs: dur
    }));

    return resp;
  }
};
