// apps/api/src/sales/so-fulfill.ts
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { ddb, tableObjects } from "../common/ddb";
import { GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { createMovement } from "../inventory/movements";
import { resolveTenantId } from "../common/tenant";
import { badRequest, conflictError, internalError, notFound } from "../common/responses";
import { logger } from "../common/logger";

type LineReq = { lineId: string; deltaQty: number; locationId?: string; lot?: string };
type SOLine = { id: string; itemId: string; qty: number; uom?: string };
type SalesOrder = {
  pk: string; sk: string; id: string; type: "salesOrder";
  status: "draft"|"submitted"|"approved"|"committed"|"partially_fulfilled"|"fulfilled"|"cancelled"|"closed";
  lines?: SOLine[];
  [k: string]: any;
};

const DEBUG = process.env.MBAPP_DEBUG === "1" || process.env.DEBUG === "1";
const reqIdOf = (event: APIGatewayProxyEventV2) => (event.requestContext as any)?.requestId;

const json = (s: number, b: unknown): APIGatewayProxyResultV2 => ({
  statusCode: s,
  headers: {
    "content-type":"application/json",
    "access-control-allow-origin":"*",
    "access-control-allow-methods":"OPTIONS,GET,POST,PUT,DELETE",
    "access-control-allow-headers":"Authorization,Content-Type,Idempotency-Key,X-Tenant-Id,Accept",
  },
  body: JSON.stringify(b)
});
const tid = (e: APIGatewayProxyEventV2) => resolveTenantId(e);
const parse = <T=any>(e: APIGatewayProxyEventV2): T => { try { return JSON.parse(e.body||"{}"); } catch { return {} as any; } };

async function loadSO(tenantId: string, id: string): Promise<SalesOrder|null> {
  const res = await ddb.send(new GetCommand({ TableName: tableObjects, Key: { pk: tenantId, sk: `salesOrder#${id}` } }));
  return (res.Item as SalesOrder) ?? null;
}

function rid(prefix="mv") { return `${prefix}_${Math.random().toString(36).slice(2,8)}${Date.now().toString(36).slice(-4)}`; }

/** Sum prior fulfill movements per line for this SO to prevent over-ship. */
/** Sum prior fulfill movements per line for this SO to prevent over-ship. */
async function fulfilledSoFar(tenantId: string, soId: string): Promise<Record<string, number>> {
  const q = await ddb.send(new QueryCommand({
    TableName: tableObjects,
    KeyConditionExpression: "pk = :pk AND begins_with(sk, :pref)",
    ExpressionAttributeValues: { ":pk": tenantId, ":pref": "inventoryMovement#" },
    // alias reserved words
    ProjectionExpression: "#soId, #soLineId, #action, #qty",
    ExpressionAttributeNames: {
      "#soId": "soId",
      "#soLineId": "soLineId",
      "#action": "action", // reserved word fix
      "#qty": "qty",
    },
  }));
  const out: Record<string, number> = {};
  for (const it of q.Items ?? []) {
    const a = (it as any)["action"];
    if ((it as any)["soId"] === soId && a === "fulfill") {
      const line = String((it as any)["soLineId"] ?? "");
      out[line] = (out[line] ?? 0) + Number((it as any)["qty"] ?? 0);
    }
  }
  return out;
}


export async function handle(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const requestId = reqIdOf(event);
  const baseCtx = { requestId };
  try {
    let tenantId: string;
    try { tenantId = tid(event); } catch (err: any) {
      const status = err?.statusCode ?? 400;
      return badRequest(err?.message ?? "Tenant header mismatch", undefined, requestId);
    }
    const id = event.pathParameters?.id;
    if (!tenantId || !id) return badRequest("Missing tenant or id", undefined, requestId);
    const logCtx = { ...baseCtx, tenantId, route: event.rawPath ?? event.requestContext?.http?.path, method: event.requestContext?.http?.method };

    const body = parse<{ lines: LineReq[] }>(event);
    const reqLines = Array.isArray(body?.lines) ? body.lines : [];
    if (reqLines.length === 0) return json(400, { message: "lines[] required" });

    const so = await loadSO(tenantId, id);
    if (!so) return notFound("Sales order not found", requestId);
    logger.info(logCtx, "so-fulfill.load", { soId: so.id, status: so.status, reqCount: reqLines.length });

    // Guard status: allow fulfill from committed or partially_fulfilled
    if (!["committed", "partially_fulfilled"].includes(so.status)) {
      logger.warn(logCtx, "so-fulfill.guard", { reason: "bad_status", status: so.status });
      return conflictError(`Cannot fulfill from status=${so.status}`, undefined, requestId);
    }

    const linesById = new Map<string, SOLine>((so.lines ?? []).map(l => [l.id, l]));
    for (const l of reqLines) {
      if (!l?.lineId || typeof l.deltaQty !== "number" || l.deltaQty <= 0) {
        return badRequest("Each line requires { lineId, deltaQty>0 }", undefined, requestId);
      }
      if (!linesById.has(l.lineId)) {
        return notFound(`Unknown lineId ${l.lineId}`, requestId);
      }
    }

    // Prevent over-fulfillment
    const shipped = await fulfilledSoFar(tenantId, so.id);
    const now = new Date().toISOString();

    for (const r of reqLines) {
      const line = linesById.get(r.lineId)!;
      const already = shipped[r.lineId] ?? 0;
      const willBe = already + Number(r.deltaQty);
      if (willBe > Number(line.qty ?? 0)) {
        logger.warn(logCtx, "so-fulfill.guard", { lineId: r.lineId, qtyOrdered: line.qty, already, attempt: r.deltaQty });
        return conflictError("Over-fulfillment blocked", { lineId: r.lineId, ordered: line.qty, fulfilledSoFar: already, attempt: r.deltaQty }, requestId);
      }
    }

    // Write inventoryMovement rows (action: fulfill) using shared dual-write helper
    let mvCount = 0;
    for (const r of reqLines) {
      const line = linesById.get(r.lineId)!;
      try {
        await createMovement({
          tenantId,
          itemId: line.itemId,
          action: "fulfill" as any,
          qty: Number(r.deltaQty),
          soId: so.id,
          soLineId: line.id,
          locationId: r.locationId ?? undefined,
          lot: r.lot ?? undefined,
        });
        mvCount++;
      } catch (err) {
        // Log error but don't fail the entire fulfill (best-effort semantics)
        logger.warn(logCtx, "so-fulfill: movement write error", { 
          lineId: r.lineId, 
          itemId: line.itemId, 
          error: String(err) 
        });
      }
    }
    logger.info(logCtx, "so-fulfill.movements", { count: mvCount });

    // Decide new status: if all lines fully shipped → fulfilled, else partially_fulfilled
    const shippedNow = await fulfilledSoFar(tenantId, so.id);
    let allFull = true;
    for (const ln of so.lines ?? []) {
      const qtyOrdered = Number(ln.qty ?? 0);
      const got = shippedNow[ln.id] ?? 0;
      if (got < qtyOrdered) { allFull = false; break; }
    }
    const nextStatus = allFull ? "fulfilled" : "partially_fulfilled";

    const updated: SalesOrder = { ...so, status: nextStatus, updatedAt: now };
    await ddb.send(new PutCommand({ TableName: tableObjects, Item: updated }));
    logger.info(logCtx, "so-fulfill.saved", { soId: so.id, status: nextStatus });

    return json(200, updated);
  } catch (err: any) {
    logger.error({ requestId }, "so-fulfill.error", { message: err?.message });
    return internalError(err, requestId);
  }
}
