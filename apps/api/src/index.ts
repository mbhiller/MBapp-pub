import { ok, bad } from "./common/responses";
import * as createObj from "./objects/create";
import * as getObj from "./objects/get";
import * as listObj from "./objects/list";

export { handler as listByType } from "./objects/listByType";
export { handler as searchByTag } from "./objects/searchByTag";
export const handler = async (evt: any) => {
  const method = evt?.requestContext?.http?.method;
  const path = evt?.rawPath || evt?.requestContext?.http?.path || "";

  try {
    // Tenants (keeps mobile happy if it pings /tenants)
    if (method === "GET" && path === "/tenants") {
      const h = evt?.headers || {};
      const tenant =
        h["x-tenant-id"] ||
        h["X-Tenant-Id"] ||
        h["x-tenant"] ||
        process.env.DEFAULT_TENANT ||
        "DemoTenant";
      return ok({
        items: [{ id: String(tenant), name: String(tenant) }],
        defaultTenant: String(tenant),
      });
    }

    // Create / Update
    if ((method === "POST" || method === "PUT") && path?.startsWith("/objects/")) {
      return await createObj.handler(evt);
    }

    // List by type (query style): GET /objects?type=horse&limit=20&cursor=...
    if (method === "GET" && path === "/objects") {
      return await listObj.handler(evt);
    }

    // Fetch single (canonical & non-canonical)
    if (method === "GET" && path?.startsWith("/objects/") && !path.endsWith("/search")) {
      return await getObj.handler(evt);
    }

    return bad(`no route for ${method} ${path}`);
  } catch (err: any) {
    console.error("handler error", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "internal error", detail: err?.message }),
    };
  }
};
