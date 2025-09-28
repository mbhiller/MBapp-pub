import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ok, bad, error } from "../common/responses";
import jwt from "jsonwebtoken";

/**
 * POST /auth/dev-login
 * Body (optional): { sub?: string, email?: string, roles?: string[]; ttlSec?: number }
 * Requires: process.env.DEV_LOGIN_ENABLED === "true"
 * Signs a JWT using server-side JWT_SECRET/JWT_ISSUER so the token always verifies here.
 */
export async function handle(evt: APIGatewayProxyEventV2) {
  try {
    if (process.env.DEV_LOGIN_ENABLED !== "true") {
      return bad("dev_login_disabled");
    }

    const SECRET = process.env.JWT_SECRET;
    const ISSUER = process.env.JWT_ISSUER || "mbapp";
    if (!SECRET) return error("server_auth_not_configured");

    const body = evt.body ? JSON.parse(evt.body) : {};
    const sub   = body.sub   || "dev-user";
    const email = body.email || "dev@example.com";
    const roles = Array.isArray(body.roles) && body.roles.length ? body.roles : ["admin"];
    const ttlSec = typeof body.ttlSec === "number" ? body.ttlSec : 3600;

    const now = Math.floor(Date.now() / 1000);
    const payload = { sub, email, roles, iat: now, exp: now + ttlSec };

    const token = jwt.sign(payload, SECRET, { issuer: ISSUER });
    return ok({ token, roles, iss: ISSUER, exp: payload.exp });
  } catch (e: any) {
    if (e instanceof SyntaxError) return bad("invalid_json");
    return error(e?.message || "dev_login_failed");
  }
}
