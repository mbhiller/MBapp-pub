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

  // Only include explicit policy if provided; otherwise let role derivation handle it
  const policy: Record<string, boolean> | undefined =
    (body.policy && typeof body.policy === "object" && !Array.isArray(body.policy))
      ? body.policy
      : undefined;

  const issuer   = env("JWT_ISSUER", "mbapp");
  const audience = env("JWT_AUDIENCE", "mbapp");
  const userId   = email;

  // Build mbapp claim: always include userId, tenantId, roles; only include policy if explicitly provided
  const mbappClaim: any = { userId, tenantId, roles };
  if (policy !== undefined) {
    mbappClaim.policy = policy;
  }

  const token = jwt.sign(
    {
      sub: userId,
      iss: issuer,
      aud: audience,
      mbapp: mbappClaim,
    },
    JWT_SECRET,
    { algorithm: "HS256", expiresIn: "12h" }
  );

  return json(200, { token });
}
