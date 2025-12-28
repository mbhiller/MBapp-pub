type Json = Record<string, any> | any[];

const baseHeaders = {
  "content-type": "application/json",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
  "access-control-allow-headers": "content-type,x-tenant-id,Idempotency-Key"
};

const respond = (statusCode: number, body: any) => ({
  statusCode,
  headers: baseHeaders,
  body: typeof body === "string" ? body : JSON.stringify(body),
});

// Inject requestId into error payloads when provided
const withRequestId = <T extends Record<string, any>>(body: T, requestId?: string) =>
  requestId ? { ...body, requestId } : body;

export const ok = (data: Json, status = 200) => respond(status, data);
export const noContent = () => ({ statusCode: 204, headers: baseHeaders, body: "" });

// Legacy helper (deprecated - use badRequest)
export const bad = (message: string | { message: string } = "Bad Request", requestId?: string) => {
  const msg = typeof message === "string" ? message : message.message;
  return respond(400, withRequestId({ code: "bad_request", message: msg }, requestId));
};

// Normalized 404 Not Found
export const notFound = (message = "Not Found", requestId?: string) =>
  respond(404, withRequestId({ code: "not_found", message, error: "NotFound" }, requestId));
export const conflict = (message = "Conflict", requestId?: string) =>
  respond(409, withRequestId({ code: "conflict", message, error: "Conflict" }, requestId));
export const notimpl = (route?: string, requestId?: string) =>
  respond(501, withRequestId({ code: "not_implemented", message: route ? `Unsupported route ${route}` : "Not implemented", error: "NotImplemented" }, requestId));
export const error = (err: unknown, requestId?: string) => {
  const message =
    typeof err === "string" ? err :
    (err as any)?.message ? (err as any).message :
    "Internal error";
  return respond(500, withRequestId({ code: "internal_error", message, error: "InternalError" }, requestId));
};

// CORS preflight (OPTIONS)
export const preflight = () =>
  ({ statusCode: 204, headers: { ...baseHeaders, "access-control-max-age": "86400" }, body: "" });

// ========================================
// Standardized Error Helpers (Sprint IV)
// ========================================

/**
 * 400 Bad Request - ValidationError shape per spec
 * @param message - Human-readable error message
 * @param details - Optional additional context (fieldErrors, etc.)
 */
export const badRequest = (message: string, details?: Record<string, any>, requestId?: string) =>
  respond(400, withRequestId({
    code: "validation_error",
    message,
    ...(details && { details }),
  }, requestId));

/**
 * 401 Unauthorized - Error shape per spec
 */
export const unauthorized = (message = "Unauthorized", requestId?: string) =>
  respond(401, withRequestId({
    code: "unauthorized",
    message,
  }, requestId));

/**
 * 403 Forbidden - Error shape per spec
 */
export const forbidden = (message = "Forbidden", requestId?: string) =>
  respond(403, withRequestId({
    code: "forbidden",
    message,
  }, requestId));

/**
 * 404 Not Found - Error shape per spec
 */
// Alias to normalized notFound
export const notFoundError = notFound;

/**
 * 409 Conflict - Error shape per spec
 * @param message - Human-readable error message
 * @param details - Optional additional context
 */
export const conflictError = (message: string, details?: Record<string, any>, requestId?: string) =>
  respond(409, withRequestId({
    code: "conflict",
    message,
    ...(details && { details }),
  }, requestId));

/**
 * 500 Internal Server Error - Error shape per spec
 * @param err - Error object or message
 */
export const internalError = (err: unknown, requestId?: string) => {
  const message =
    typeof err === "string" ? err :
    (err as any)?.message ? (err as any).message :
    "Internal server error";
  return respond(500, withRequestId({
    code: "internal_error",
    message,
    error: "InternalError",
  }, requestId));
};
