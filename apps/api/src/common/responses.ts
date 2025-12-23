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

export const ok = (data: Json, status = 200) => respond(status, data);
export const noContent = () => ({ statusCode: 204, headers: baseHeaders, body: "" });

// Legacy helper (deprecated - use badRequest)
export const bad = (message: string | { message: string } = "Bad Request") => {
  const msg = typeof message === "string" ? message : message.message;
  return respond(400, { error: "BadRequest", message: msg });
};

// Normalized 404 Not Found
export const notFound = (message = "Not Found") =>
  respond(404, { code: "not_found", message, error: "NotFound" });
export const conflict = (message = "Conflict") => respond(409, { error: "Conflict", message });
export const notimpl = (route?: string) =>
  respond(501, { error: "NotImplemented", message: route ? `Unsupported route ${route}` : "Not implemented" });
export const error = (err: unknown) => {
  const message =
    typeof err === "string" ? err :
    (err as any)?.message ? (err as any).message :
    "Internal error";
  return respond(500, { code: "internal_error", message, error: "InternalError" });
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
export const badRequest = (message: string, details?: Record<string, any>) =>
  respond(400, {
    code: "validation_error",
    message,
    ...(details && { details }),
  });

/**
 * 401 Unauthorized - Error shape per spec
 */
export const unauthorized = (message = "Unauthorized") =>
  respond(401, {
    code: "unauthorized",
    message,
  });

/**
 * 403 Forbidden - Error shape per spec
 */
export const forbidden = (message = "Forbidden") =>
  respond(403, {
    code: "forbidden",
    message,
  });

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
export const conflictError = (message: string, details?: Record<string, any>) =>
  respond(409, {
    code: "conflict",
    message,
    ...(details && { details }),
  });

/**
 * 500 Internal Server Error - Error shape per spec
 * @param err - Error object or message
 */
export const internalError = (err: unknown) => {
  const message =
    typeof err === "string" ? err :
    (err as any)?.message ? (err as any).message :
    "Internal server error";
  return respond(500, {
    code: "internal_error",
    message,
    error: "InternalError",
  });
};
