import { ok, bad } from "./common/responses";
import * as createObj from "./objects/create";
import * as getObj from "./objects/get";
import * as listByType from "./objects/listByType";
import * as searchByTag from "./objects/searchByTag";

/**
 * Single Lambda router for API Gateway HTTP API (payload v2)
 * Routes:
 *  POST   /objects
 *  GET    /objects                (requires ?type=horse)
 *  GET    /objects/{id}           (requires ?type=horse)
 *  GET    /objects/search         (requires ?tag=...)
 */
export const handler = async (evt: any) => {
  const method = evt?.requestContext?.http?.method;
  const path = evt?.rawPath || evt?.requestContext?.http?.path || "";

  try {
    if (method === "POST" && path === "/objects") return await createObj.handler(evt);
    if (method === "GET" && path === "/objects") return await listByType.handler(evt);
    if (method === "GET" && path?.startsWith("/objects/") && !path.endsWith("/search")) return await getObj.handler(evt);
    if (method === "GET" && path === "/objects/search") return await searchByTag.handler(evt);
    return bad(`no route for ${method} ${path}`);
  } catch (err: any) {
    console.error("handler error", err);
    return { statusCode: 500, body: JSON.stringify({ error: "internal error", detail: err?.message }) };
  }
};