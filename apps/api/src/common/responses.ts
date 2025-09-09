type Json = Record<string, any> | any[];

const baseHeaders = {
  "content-type": "application/json",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
  "access-control-allow-headers": "content-type,x-tenant-id"
};

const respond = (statusCode: number, body: any) => ({
  statusCode,
  headers: baseHeaders,
  body: typeof body === "string" ? body : JSON.stringify(body)
});

export const ok = (data: Json, status = 200) => respond(status, data);
export const bad = (message: string, status = 400) =>
  respond(status, { error: "BadRequest", message });
export const notfound = (message: string) =>
  respond(404, { error: "NotFound", message });
export const conflict = (message: string) =>
  respond(409, { error: "Conflict", message });
export const notimpl = (route?: string) =>
  respond(501, { error: "NotImplemented", message: route ? `Unsupported route ${route}` : "Not implemented" });
export const error = (err: unknown) => {
  const message =
    typeof err === "string" ? err :
    (err as any)?.message ? (err as any).message :
    "Internal error";
  return respond(500, { error: "Internal", message });
};

// CORS preflight (OPTIONS)
export const preflight = () =>
  ({ statusCode: 204, headers: { ...baseHeaders, "access-control-max-age": "86400" }, body: "" });
