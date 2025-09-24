import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import jwt from "jsonwebtoken";

type Body = { userId?: string; email?: string; roles?: string[]; tenants?: string[] };

export async function devLogin(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const secret = process.env.JWT_SECRET;
  const issuer = process.env.JWT_ISSUER || "mbapp";
  if (!secret) return { statusCode: 500, body: "Server auth not configured" };

  let body: Body = {};
  try { if (event.body) body = JSON.parse(event.body); } catch { 
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON body" }) };
  }

  const sub = body.userId || "dev-user";
  const email = body.email || "dev@example.com";
  const roles = (Array.isArray(body.roles) && body.roles.length ? body.roles : ["admin"]);
  const tenants = (Array.isArray(body.tenants) && body.tenants.length ? body.tenants : ["DemoTenant"]);

  const token = jwt.sign({ sub, email, roles, tenants }, secret, { issuer, expiresIn: "12h" });
  return { statusCode: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) };
}
