// Minimal AWS Lambda types (so we don't need @types/aws-lambda right now)
type HttpInfo = { method?: string; path?: string };
type RequestContext = { http?: HttpInfo };
type EventV2 = {
  version?: string;
  rawPath?: string;
  rawQueryString?: string;
  requestContext?: RequestContext;
  queryStringParameters?: Record<string, string | undefined>;
  headers?: Record<string, string | undefined>;
};
type ResultV2 = {
  statusCode: number;
  headers?: Record<string, string>;
  body: string;
  isBase64Encoded?: boolean;
};

// ---------- Handler ----------
export async function handler(event: EventV2): Promise<ResultV2> {
  const method = event.requestContext?.http?.method?.toUpperCase() || "GET";
  const rawPath = (event.rawPath || "/").toLowerCase().replace(/\/+$/, "") || "/";
  const qs = event.queryStringParameters || {};

  // --- Tenants ---
  if (method === "GET" && rawPath === "/tenants") {
    return ok({ items: [{ id: "DemoTenant", name: "Demo Tenant" }] });
  }

  // --- Objects ---
  // GET /objects?type=horse
  if (method === "GET" && rawPath === "/objects") {
    const type = (qs.type || "").toString().trim();
    return ok({ items: [], type });
  }
  // GET /objects/{type}
  const mType = rawPath.match(/^\/objects\/([^/]+)$/);
  if (method === "GET" && mType) {
    const type = decodeURIComponent(mType[1]);
    return ok({ items: [], type });
  }

  // --- Products ---
  // GET /products
  if (method === "GET" && rawPath === "/products") {
    return ok({ items: [] });
  }

  return notFound({ message: `Unsupported ${method} ${event.rawPath}` });
}

// ---------- Helpers ----------
const ok = (body: any) => resp(200, body);
const notFound = (body: any) => resp(404, body);
const resp = (statusCode: number, body: any): ResultV2 => ({
  statusCode,
  headers: {
    "access-control-allow-origin": "*",
    "content-type": "application/json",
  },
  body: JSON.stringify(body),
});
