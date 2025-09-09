// apps/api/src/index.ts
import { handler as getObject } from "./objects/get";
import { handler as createObject } from "./objects/create";
import { handler as updateObject } from "./objects/update";
import { handler as listObjects } from "./objects/list";
import { handler as searchObjects } from "./objects/search";
import { bad } from "./common/responses";

export const handler = async (evt: any) => {
  const routeKey: string = evt?.routeKey || evt?.requestContext?.routeKey || "";
  const method: string = evt?.requestContext?.http?.method || "";
  const rawPath: string = evt?.rawPath || "";

  switch (routeKey) {
    // Canonical GET (primary)
    case "GET /objects/{type}/{id}":
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
    case "GET /objects/search":
      return searchObjects(evt);

    // Optional alias: treat GET /objects/{type} as list
    case "GET /objects/{type}":
      return listObjects(evt);

    // Tenants (simple stub)
    case "GET /tenants":
      return {
        statusCode: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify([{ id: "DemoTenant", name: "DemoTenant" }]),
      };

    // Not implemented (keep explicit)
    case "GET /objects":
    case "DELETE /objects/{type}/{id}":
      return { statusCode: 501, headers: { "content-type": "application/json" }, body: JSON.stringify({ error: "NotImplemented", route: routeKey }) };

    default:
      return bad(`Unsupported route ${method} ${rawPath}`);
  }
};
