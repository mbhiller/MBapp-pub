// apps/api/src/index.ts
import { handler as getObject } from "./objects/get";
import { handler as createObject } from "./objects/create";
import { handler as updateObject } from "./objects/update";
import { bad } from "./common/responses";

export const handler = async (evt: any) => {
  // HTTP API v2 gives routeKey like "GET /objects/{type}/{id}"
  const routeKey: string = evt?.routeKey || evt?.requestContext?.routeKey || "";
  const method: string = evt?.requestContext?.http?.method || "";

  switch (routeKey) {
    case "GET /objects/{type}/{id}":
      return getObject(evt);

    // (Optional) legacy shape: GET /objects/{id}?type=...
    case "GET /objects/{id}":
      return getObject(evt);

    case "POST /objects/{type}":
      return createObject(evt);

    case "PUT /objects/{type}/{id}":
      return updateObject(evt);

    // Not implemented yet – keep API consistent with 501s
    case "GET /objects/{type}":
    case "GET /objects":
    case "GET /objects/search":
    case "GET /objects/{type}/list":
    case "DELETE /objects/{type}/{id}":
      return { statusCode: 501, headers: { "content-type": "application/json" }, body: JSON.stringify({ error: "NotImplemented", route: routeKey }) };

    // Tenants or others – optionally stub
    case "GET /tenants":
      return { statusCode: 200, headers: { "content-type": "application/json" }, body: JSON.stringify([{ id: "DemoTenant", name: "DemoTenant" }]) };

    default:
      // $default and everything else – fail explicitly
      return bad(`Unsupported route ${method} ${evt?.rawPath || ""}`);
  }
};
