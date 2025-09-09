// apps/api/src/index.ts
import { handler as getObject } from "./objects/get";
import { handler as createObject } from "./objects/create";
import { handler as updateObject } from "./objects/update";
import { handler as listObjects } from "./objects/list";
import { handler as searchObjects } from "./objects/search";
import { ok, bad, notimpl, preflight } from "./common/responses";

export const handler = async (evt: any) => {
  // Basic context
  const method: string = evt?.requestContext?.http?.method || "";
  const routeKey: string = evt?.routeKey || evt?.requestContext?.routeKey || "";
  const rawPath: string = evt?.rawPath || "";

  // CORS preflight
  if (method.toUpperCase() === "OPTIONS") {
    return preflight();
  }

  switch (routeKey) {
    // Canonical GET (primary)
    case "GET /objects/{type}/{id}":
      return getObject(evt);

    // Legacy shape: GET /objects/{id}?type=...
    case "GET /objects/{id}":
      return getObject(evt);

    // Create + Update
    case "POST /objects/{type}":
      return createObject(evt);
    case "PUT /objects/{type}/{id}":
      return updateObject(evt);

    // Listing / Search
    case "GET /objects/{type}/list":
      return listObjects(evt);
    case "GET /objects/{type}": // allow fallback to list
      return listObjects(evt);
    case "GET /objects/search":
      return searchObjects(evt);

    // Simple tenants stub
    case "GET /tenants":
      return ok([{ id: "DemoTenant", name: "DemoTenant" }]);

    // Explicitly not implemented
    case "GET /objects":
    case "DELETE /objects/{type}/{id}":
      return notimpl(routeKey);

    default:
      // Unknown route
      return bad(`Unsupported route ${method} ${rawPath}`);
  }
};
