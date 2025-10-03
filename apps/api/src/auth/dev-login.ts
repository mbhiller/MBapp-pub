// apps/src/api/auth/dev-login.ts
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import jwt from "jsonwebtoken";

const json = (statusCode: number, body: unknown): APIGatewayProxyResultV2 => ({
  statusCode,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

function env(name: string, fallback?: string) {
  const v = process.env[name];
  return (v == null || v === "") ? fallback : v;
}

/**
 * Dev-only login. Gated by DEV_LOGIN_ENABLED=true.
 * Body: { email?: string, tenantId?: string, roles?: string[], policy?: Record<string, boolean> }
 * Returns: { token }
 */
export async function handle(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const enabled = env("DEV_LOGIN_ENABLED", "false") === "true";
  if (!enabled) return json(403, { message: "dev-login disabled" });

  const JWT_SECRET = env("JWT_SECRET");
  if (!JWT_SECRET) return json(500, { message: "JWT_SECRET missing" });

  // Parse body
  let body: any = {};
  try { body = event.body ? JSON.parse(event.body) : {}; } catch { /* ignore */ }

  const email    = String(body.email ?? "dev@example.com");
  const tenantId = String(body.tenantId ?? "DemoTenant");  // <- default to DemoTenant
  const roles: string[] = Array.isArray(body.roles) && body.roles.length ? body.roles : ["admin"];

  // Use caller policy if provided; otherwise a full dev policy (boolean map only)
  const policy: Record<string, boolean> =
    (body.policy && typeof body.policy === "object")
      ? body.policy
      : {
          "*": true,                 // full access in dev
          "*:read": true,
          "*:write": true,
          "*:approve": true,
          "*:commit": true,
          "*:receive": true,
          "*:fulfill": true,
          "tools:seed": true,
          "admin:reset": true,
        };

  const issuer   = env("JWT_ISSUER", "mbapp");
  const audience = env("JWT_AUDIENCE", "mbapp");
  const userId   = email;

  const token = jwt.sign(
    {
      sub: userId,
      iss: issuer,
      aud: audience,
      mbapp: {
        userId,
        tenantId,
        roles,
        policy,
      },
    },
    JWT_SECRET,
    { algorithm: "HS256", expiresIn: "12h" }
  );

  return json(200, { token });
}
