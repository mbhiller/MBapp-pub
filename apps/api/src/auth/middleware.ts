// apps/src/api/auth/middleware.ts
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import jwt from "jsonwebtoken";

export type AuthContext = {
  userId: string;
  tenantId: string;
  roles: string[];
  policy: Record<string, boolean>;
};

export function policyFromAuth(auth: AuthContext) {
  return auth.policy || {};
}

export async function getAuth(event: APIGatewayProxyEventV2): Promise<AuthContext> {
  const authz = event.headers?.authorization || event.headers?.Authorization;
  if (!authz?.startsWith("Bearer ")) throw withStatus(401, "Missing bearer token");
  const token = authz.slice("Bearer ".length);

  const secret = env("JWT_SECRET");
  if (!secret) throw withStatus(500, "JWT_SECRET missing");

  let decoded: any;
  try {
    decoded = jwt.verify(token, secret, { algorithms: ["HS256"] });
  } catch (e: any) {
    throw withStatus(401, "Invalid token");
  }

  const mb = decoded?.mbapp || {};
  const userId: string = mb.userId || decoded?.sub || "unknown";
  const tenantId: string = mb.tenantId || "unknown";
  const roles: string[] = Array.isArray(mb.roles) ? mb.roles : [];
  const policy: Record<string, boolean> = isObject(mb.policy) ? mb.policy : {};

  return { userId, tenantId, roles, policy };
}

/**
 * requirePerm(auth, "product:write")
 * Supports wildcards in policy:
 *   "*:read", "*:write", "*:*", "*" (any)
 */
export function requirePerm(auth: AuthContext, perm: string) {
  const p = auth.policy || {};
  if (hasPerm(p, perm)) return true;
  throw withStatus(403, `Forbidden (missing permission: ${perm})`);
}

function hasPerm(policy: Record<string, boolean>, perm: string): boolean {
  if (policy[perm]) return true;
  // wildcard support
  const [type, action = ""] = perm.split(":");
  // Exact action wildcard, e.g., "*:write" or "product:*"
  if (policy[`${type}:*`]) return true;
  if (policy[`*:${action}`]) return true;
  // Global wildcards
  if (policy["*:*"]) return true;
  if (policy["*"]) return true;
  return false;
}

function env(name: string, fallback?: string) {
  const v = process.env[name];
  return (v == null || v === "") ? fallback : v;
}
function isObject(x: any): x is Record<string, unknown> {
  return x && typeof x === "object" && !Array.isArray(x);
}
function withStatus(statusCode: number, message: string) {
  const err: any = new Error(message);
  err.statusCode = statusCode;
  return err;
}
