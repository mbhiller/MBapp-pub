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
