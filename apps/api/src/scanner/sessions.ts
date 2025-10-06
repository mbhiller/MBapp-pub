// POST /scanner/sessions  { op: "start" | "stop", sessionId?, workspaceId? }
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import crypto from "crypto";
import { createObject, getObjectById, updateObject } from "../objects/repo";

type Body = { op: "start" | "stop"; sessionId?: string; workspaceId?: string | null };

export async function handle(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const { tenantId, userId } = getAuth(event);
  const body = parseBody<Body>(event);
  if (!body?.op) return json(400, { error: "op is required" });

  if (body.op === "start") {
    const now = new Date().toISOString();
    const session = await createObject({
      tenantId,
      type: "scannerSession",
      body: {
        id: crypto.randomUUID(),
        type: "scannerSession",
        userId,
        workspaceId: body.workspaceId ?? null,
        startedAt: now,
        endedAt: null,
        createdAt: now,
        updatedAt: now,
      },
    });
    return json(200, session);
  }

  if (body.op === "stop") {
    if (!body.sessionId) return json(400, { error: "sessionId is required to stop" });
    const existing = await getObjectById({ tenantId, type: "scannerSession", id: body.sessionId });
    if (!existing) return json(404, { error: "Session not found" });
    if ((existing as any).endedAt) return json(200, existing); // idempotent

    const now = new Date().toISOString();
    const updated = await updateObject({
      tenantId,
      type: "scannerSession",
      id: body.sessionId,
      body: { endedAt: now, updatedAt: now },
    });
    return json(200, updated);
  }

  return json(400, { error: "Unsupported op" });
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

function parseBody<T>(event: APIGatewayProxyEventV2): T | null {
  try { return event.body ? (JSON.parse(event.body) as T) : null; } catch { return null; }
}
function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return { statusCode, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}
