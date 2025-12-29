type LogCtx = {
  requestId?: string;
  tenantId?: string;
  userId?: string;
  route?: string;
  path?: string;
  method?: string;
};

type Extra = Record<string, unknown> | undefined;

type Level = "info" | "warn" | "error";

function clean(obj: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    out[k] = v;
  }
  return out;
}

function log(level: Level, ctx: LogCtx | undefined, msg: string, extra?: Extra) {
  const target = level === "error" ? console.error : console.log;
  const base = clean({
    level,
    msg,
    requestId: ctx?.requestId,
    tenantId: ctx?.tenantId,
    userId: ctx?.userId,
    route: ctx?.route || ctx?.path,
    method: ctx?.method,
    ts: new Date().toISOString(),
  });
  const payload = extra ? { ...base, ...extra } : base;
  try {
    target(JSON.stringify(payload));
  } catch {
    // fallback to plain log if JSON stringify fails
    target(payload);
  }
}

export const logger = {
  info: (ctx: LogCtx | undefined, msg: string, extra?: Extra) => log("info", ctx, msg, extra),
  warn: (ctx: LogCtx | undefined, msg: string, extra?: Extra) => log("warn", ctx, msg, extra),
  error: (ctx: LogCtx | undefined, msg: string, extra?: Extra) => log("error", ctx, msg, extra),
};

/**
 * Sanitize telemetry payload to prevent PII leakage.
 * 
 * Rules:
 * - Drop PII-ish keys: name, email, phone, address, firstName, lastName (case-insensitive)
 * - Drop nested objects/arrays (keep primitives only)
 * - Keep primitives: string, number, boolean, null, undefined
 * - Keep keys ending in "Id" (e.g., soId, objectId, tenantId)
 */
function sanitizeTelemetryPayload(payload?: Record<string, unknown>): Record<string, unknown> {
  if (!payload) return {};

  const PII_KEYS = /^(name|email|phone|address|firstname|lastname|displayname)$/i;
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(payload)) {
    // Drop PII keys
    if (PII_KEYS.test(key)) continue;

    // Keep primitives only (drop objects/arrays)
    const type = typeof value;
    if (value === null || value === undefined) {
      sanitized[key] = value;
    } else if (type === "string" || type === "number" || type === "boolean") {
      sanitized[key] = value;
    }
    // Drop objects, arrays, functions, etc.
  }

  return sanitized;
}

/**
 * Emit a structured domain event backed by the logger.
 * Adds envelope fields and merges user-provided payload.
 */
export function emitDomainEvent(
  ctx: LogCtx | undefined,
  eventName: string,
  payload?: Record<string, unknown>
) {
  // Sanitize user-provided payload
  const sanitized = sanitizeTelemetryPayload(payload);

  const base = clean({
    eventName,
    ts: new Date().toISOString(),
    source: "api",
    tenantId: ctx?.tenantId,
    actorId: ctx?.userId,
    actorType: ctx?.userId ? undefined : "system",
  });
  const out = sanitized ? { ...base, ...sanitized } : base;
  log("info", ctx, `[DOMAIN_EVENT] ${eventName}`, out);
}
