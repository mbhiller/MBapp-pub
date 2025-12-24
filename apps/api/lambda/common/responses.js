"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.preflight = exports.error = exports.notimpl = exports.conflict = exports.notfound = exports.bad = exports.ok = void 0;
const baseHeaders = {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type,x-tenant-id,Idempotency-Key"
};
const respond = (statusCode, body) => ({
    statusCode,
    headers: baseHeaders,
    body: typeof body === "string" ? body : JSON.stringify(body),
});
const ok = (data, status = 200) => respond(status, data);
exports.ok = ok;
const bad = (message = "Bad Request") => respond(400, { error: "BadRequest", message });
exports.bad = bad;
const notfound = (message = "Not Found") => respond(404, { error: "NotFound", message });
exports.notfound = notfound;
const conflict = (message = "Conflict") => respond(409, { error: "Conflict", message });
exports.conflict = conflict;
const notimpl = (route) => respond(501, { error: "NotImplemented", message: route ? `Unsupported route ${route}` : "Not implemented" });
exports.notimpl = notimpl;
const error = (err) => {
    const message = typeof err === "string" ? err :
        err?.message ? err.message :
            "Internal error";
    return respond(500, { error: "Internal", message });
};
exports.error = error;
// CORS preflight (OPTIONS)
const preflight = () => ({ statusCode: 204, headers: { ...baseHeaders, "access-control-max-age": "86400" }, body: "" });
exports.preflight = preflight;
