// apps/api/src/auth/middleware.ts
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import jwt from "jsonwebtoken";

type JwtClaims = { sub: string; email?: string; roles?: string[]; tenants?: string[]; };
export type Policy = { user: { id: string; email?: string }; tenants: { id: string; default?: boolean }[]; roles: string[]; permissions: string[]; scopes?: Record<string, unknown>; version: number; issuedAt: string; };
export type AuthContext = { userId: string; tenantId: string; roles: string[]; policy: Policy; };

const PERM_MAP: Record<string, string[]> = {
  admin: ["product:read","product:write","inventory:read","inventory:adjust","event:read","event:update","registration:read","registration:checkin","reservation:read","reservation:write","view:read","view:write","workspace:read","workspace:write","user:read","user:write","role:write"],
  inventory_manager: ["inventory:read","inventory:adjust","product:read","product:write","view:read","view:write"],
  event_organizer: ["event:read","event:update","registration:read","registration:checkin","view:read","view:write"],
  judge: ["event:read","registration:read","score:write","view:read"],
  participant: ["event:read","registration:read","reservation:read","view:read"]
};
const rolesToPerms = (roles: string[]) => Array.from(new Set(roles.flatMap(r => PERM_MAP[r] || [])));
const dbg = (msg: string) => { if (process.env.DEBUG_AUTH === "true") console.log("[auth]", msg); };

function getPreAuth(event: APIGatewayProxyEventV2): AuthContext | null {
  const anyEvt = event as any;
  const mb = anyEvt?.requestContext?.authorizer?.mbapp;
  if (!mb) return null;
  if (mb?.userId && mb?.tenantId && Array.isArray(mb?.policy?.permissions)) return {
    userId: mb.userId, tenantId: mb.tenantId, roles: mb.roles || [], policy: mb.policy
  };
  return null;
}

export async function authMiddleware(event: APIGatewayProxyEventV2): Promise<AuthContext> {
  const pre = getPreAuth(event);
  if (pre) { dbg("using pre-auth"); return pre; }

  const headers: Record<string, string | undefined> = (event.headers as any) || {};
  const authz = headers.authorization || (headers as any).Authorization;
  if (!authz?.startsWith("Bearer ")) { dbg("missing bearer"); const e = new Error("Unauthorized"); (e as any).statusCode = 401; throw e; }

  const token = authz.slice("Bearer ".length);
  const secret = process.env.JWT_SECRET;
  const issuer = process.env.JWT_ISSUER || "mbapp";
  if (!secret) { dbg("no JWT_SECRET"); const e = new Error("Server auth not configured"); (e as any).statusCode = 500; throw e; }

  let claims: JwtClaims;
  try { claims = jwt.verify(token, secret, { issuer }) as JwtClaims; }
  catch (err: any) { dbg(`verify failed: ${err?.message || err}`); const e = new Error("Unauthorized"); (e as any).statusCode = 401; throw e; }

  const tenantId = (headers["x-tenant-id"] || (headers as any)["X-Tenant-Id"]) as string | undefined;
  if (!tenantId) { dbg("missing x-tenant-id"); const e = new Error("Missing x-tenant-id"); (e as any).statusCode = 400; throw e; }

  const roles = Array.isArray(claims.roles) ? claims.roles : [];
  const permissions = rolesToPerms(roles);
  const now = new Date().toISOString();

  const policy: Policy = { user: { id: claims.sub, email: claims.email }, tenants: [{ id: tenantId, default: true }], roles, permissions, version: 1, issuedAt: now };
  return { userId: claims.sub, tenantId, roles, policy };
}
export const getAuth = authMiddleware;
export function requirePerm(ctx: AuthContext, perm: string) { if (!ctx.policy.permissions.includes(perm)) { const e = new Error("Forbidden"); (e as any).statusCode = 403; throw e; } }
export function policyFromAuth(ctx: AuthContext) { return ctx.policy; }
