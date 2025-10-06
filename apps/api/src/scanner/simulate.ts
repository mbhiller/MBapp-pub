// POST /scanner/simulate  { count = 10, itemId? } — Dev-only seeding
// Creates EPCMap rows with id === epc (type: "epcMap") for simple resolve.
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import crypto from "crypto";
import { createObject } from "../objects/repo";

type Body = { count?: number; itemId?: string };

export async function handle(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const { tenantId } = getAuth(event);
  const body = parseBody<Body>(event) || {};
  const count = clamp(body.count ?? 10, 1, 1000);
  const now = new Date().toISOString();

  for (let i = 0; i < count; i++) {
    const epc = genEpc();
    await createObject({
      tenantId,
      type: "epcMap",
      body: {
        id: epc,           // <= key-by-epc convention
        type: "epcMap",
        epc,
        itemId: body.itemId ?? randomItemId(),
        status: "active",
        createdAt: now,
        updatedAt: now,
      },
    });
  }

  return json(200, { created: count });
}

// ---------- local utils ----------
function getAuth(event: APIGatewayProxyEventV2) {
  // Cast to any so TypeScript doesn't complain about requestContext.authorizer
  const rc: any = (event as any).requestContext || {};
  const auth: any = rc.authorizer || {};

  // Try common places the mbapp payload might live
  // - dev-login might inject it directly as `authorizer.mbapp`
  // - JWT authorizer often exposes it under authorizer.jwt.claims
  const mbRaw =
    auth.mbapp ??
    auth.jwt?.mbapp ??
    auth.jwt?.claims?.mbapp ??
    auth.jwt?.claims?.["mbapp"];

  const mb = parseMaybe(mbRaw) || {};

  return {
    tenantId: String(mb.tenantId ?? "DemoTenant"),
    userId: String(mb.userId ?? "dev-user"),
  };
}

function parseMaybe(v: unknown) {
  if (!v) return undefined;
  if (typeof v === "object") return v as any;
  if (typeof v === "string") {
    try { return JSON.parse(v); } catch { /* claims may already be plain string */ }
  }
  return undefined;
}

function genEpc(): string {
  // 96-bit hex-like (not a real SGTIN encoding, fine for dev)
  return crypto.randomBytes(12).toString("hex").toUpperCase();
}
function randomItemId(): string {
  return crypto.randomUUID();
}
function clamp(n: number, min: number, max: number) { return Math.max(min, Math.min(max, n)); }
function parseBody<T>(event: APIGatewayProxyEventV2): T | null {
  try { return event.body ? (JSON.parse(event.body) as T) : null; } catch { return null; }
}
function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return { statusCode, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}
