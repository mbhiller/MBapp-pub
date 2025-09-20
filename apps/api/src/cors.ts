// apps/api/src/cors.ts
import type { APIGatewayProxyResult, Context } from "aws-lambda";

// Keep event flexible: supports HTTP API v2 and REST v1 shapes (or your custom ApiEvt)
type AnyEvent = {
  headers?: Record<string, string | undefined>;
  requestContext?: { http?: { method?: string } };
  httpMethod?: string;
};

export type LambdaHandler = (
  event: AnyEvent,
  context: Context
) => Promise<APIGatewayProxyResult> | APIGatewayProxyResult;

const DEV_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"];

function methodOf(e: AnyEvent): string {
  const m2 = e?.requestContext?.http?.method;
  const m1 = e?.httpMethod;
  return (m2 || m1 || "GET").toUpperCase();
}

function pickOrigin(e: AnyEvent): string | undefined {
  const h = e?.headers || {};
  return h.origin || h.Origin || h.ORIGIN;
}

function corsHeaders(origin?: string): Record<string, string> {
  const allowOrigin = origin && DEV_ORIGINS.includes(origin) ? origin : "*";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "content-type,x-tenant-id",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

export function withCors(handler: LambdaHandler): LambdaHandler {
  return async (event, context) => {
    const origin = pickOrigin(event);

    if (methodOf(event) === "OPTIONS") {
      return { statusCode: 204, headers: corsHeaders(origin), body: "" };
    }

    const resp = await handler(event, context);
    return {
      ...resp,
      headers: { ...(resp.headers || {}), ...corsHeaders(origin) },
    };
  };
}
