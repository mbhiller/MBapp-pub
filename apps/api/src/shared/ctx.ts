import type { APIGatewayProxyEventV2 } from "aws-lambda";

export type Ctx = {
  userId: string;
  tenantId: string;
  roles: string[];
  policy: any;
  /** Pulled from Idempotency-Key header (any casing). */
  idempotencyKey?: string;
  /** API Gateway request id for logs/correlation. */
  requestId?: string;
};

/** Case-insensitive header getter. */
export function getHeader(
  event: APIGatewayProxyEventV2,
  name: string
): string | undefined {
  const h = event.headers || {};
  const key = Object.keys(h).find(k => k.toLowerCase() === name.toLowerCase());
  return key ? h[key] : undefined;
}

/** Build ctx from existing auth + headers; no handler changes required. */
export function buildCtx(
  event: APIGatewayProxyEventV2,
  auth: { userId: string; tenantId: string; roles: string[]; policy: any }
): Ctx {
  const idempotencyKey = getHeader(event, "Idempotency-Key");
  const requestId =
    // HTTP API v2 has requestId here:
    (event.requestContext as any)?.requestId ||
    // Fallback if you ever proxy v1:
    (event.requestContext as any)?.requestId;

  return {
    userId: auth.userId,
    tenantId: auth.tenantId,
    roles: auth.roles,
    policy: auth.policy,
    idempotencyKey,
    requestId,
  };
}

/** Attach ctx under authorizer.mbapp.ctx so existing handlers can access it if needed. */
export function attachCtxToEvent(event: APIGatewayProxyEventV2, ctx: Ctx) {
  const anyEvt = event as any;
  anyEvt.requestContext = anyEvt.requestContext || {};
  anyEvt.requestContext.authorizer = anyEvt.requestContext.authorizer || {};
  anyEvt.requestContext.authorizer.mbapp = {
    ...(anyEvt.requestContext.authorizer.mbapp || {}),
    ctx,
  };
}

/** Convenience accessor for handlers that want ctx now (optional). */
export function getCtx(event: APIGatewayProxyEventV2): Ctx | undefined {
  return (event as any)?.requestContext?.authorizer?.mbapp?.ctx;
}

/** Optional guard you can call from action handlers next sprint. */
export function requireIdempotency(event: APIGatewayProxyEventV2) {
  const k = getHeader(event, "Idempotency-Key");
  if (!k) {
    const err: any = new Error("Idempotency-Key header required");
    err.statusCode = 422;
    err.code = "idempotency_required";
    throw err;
  }
}
