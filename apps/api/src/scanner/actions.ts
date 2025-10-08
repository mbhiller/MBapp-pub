//apps/api/src/scanner/actions.ts
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import crypto from "crypto";
import { createObject, getObjectById } from "../objects/repo";
import { upsertDelta } from "../inventory/counters";

type ActionType = "receive" | "pick" | "count" | "move";
type Body = {
  sessionId: string;
  epc: string;
  action: ActionType;
  fromLocationId?: string | null;
  toLocationId?: string | null;
};

export async function handle(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const { tenantId, userId } = getAuth(event);
  const headers = event.headers || {};
  const idem = header(headers, "Idempotency-Key");
  const now = new Date().toISOString();

  const body = parseBody<Body>(event);
  if (!body) return json(400, { error: "Invalid JSON" });

  const { sessionId, epc, action } = body;
  if (!sessionId || !epc || !action) return json(400, { error: "sessionId, epc, action are required" });

  const session = await getObjectById({ tenantId, type: "scannerSession", id: sessionId });
  if (!session) return json(404, { error: "Session not found" });

  const epcMap = await getObjectById({ tenantId, type: "epcMap", id: epc });
  if (!epcMap || (epcMap as any).status === "retired") return json(404, { error: "EPC not found" });

  const actionId = typeof idem === "string" && idem.length ? idem : crypto.randomUUID();

  // record first (idempotent key as id)
  const record = await createObject({
    tenantId,
    type: "scannerAction",
    body: {
      id: actionId,
      type: "scannerAction",
      sessionId,
      ts: now,
      epc,
      itemId: (epcMap as any).itemId,
      action,
      fromLocationId: body.fromLocationId ?? null,
      toLocationId: body.toLocationId ?? null,
      userId,
      createdAt: now,
      updatedAt: now,
    },
  });

  // apply effects with guardrail mapping
  const itemId = (epcMap as any).itemId as string;
  try {
    if (action === "receive") {
      await upsertDelta(tenantId, itemId, +1, 0);
    } else if (action === "pick") {
      // business rule: require reservation; this may throw a guardrail error
      await upsertDelta(tenantId, itemId, -1, -1);
    }
    // "count" and "move": no counter change yet
  } catch (err: any) {
    const { status, code, message } = isGuardrailError(err)
      ? { status: 409, code: "COUNTER_GUARD", message: String(err.message || err.code || "Guardrail violation") }
      : { status: 500, code: "INTERNAL", message: "Internal Error" };
    return json(status, { error: code, message });
  }

  return json(200, record);
}

/* ---------------- utils ---------------- */
function getAuth(event: APIGatewayProxyEventV2) {
  const rc: any = (event as any).requestContext || {};
  const auth: any = rc.authorizer || {};
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
function header(h: Record<string, string | undefined>, name: string) {
  const key = Object.keys(h).find(k => k.toLowerCase() === name.toLowerCase());
  return key ? h[key] : undefined;
}
function parseMaybe(v: unknown) {
  if (!v) return undefined;
  if (typeof v === "object") return v as any;
  if (typeof v === "string") { try { return JSON.parse(v); } catch {} }
  return undefined;
}
function parseBody<T>(event: APIGatewayProxyEventV2): T | null {
  try { return event.body ? (JSON.parse(event.body) as T) : null; } catch { return null; }
}
function isGuardrailError(e: any) {
  const msg = String(e?.message || e || "");
  // adjust patterns to your counters’ throws (examples below)
  return (
    /OVERFULFILL|OVER-FULFILL|RESERVED_NEGATIVE|RESERVED_UNDERFLOW|INSUFFICIENT/i.test(msg) ||
    /Guardrail|Conflict|409/.test(msg) ||
    e?.statusCode === 409 || e?.code === 409
  );
}
function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return { statusCode, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}
