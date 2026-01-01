// apps/api/src/sales/so-fulfill.ts
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { ddb, tableObjects } from "../common/ddb";
import { GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { createMovement } from "../inventory/movements";
import { resolveTenantId } from "../common/tenant";
import { badRequest, conflictError, internalError, notFound } from "../common/responses";
import { logger, emitDomainEvent } from "../common/logger";

type LineReq = { id?: string; lineId?: string; deltaQty: number; locationId?: string; lot?: string };
type SOLine = { id: string; itemId: string; qty: number; uom?: string; fulfilledQty?: number };
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

/** Idempotency ledger: (tenant, soId) × Idempotency-Key */
async function alreadyAppliedKey(tenantId: string, soId: string, idk?: string | null) {
  if (!idk) return false;
  const key = { pk: `IDEMP#${tenantId}#so-fulfill#${soId}`, sk: `idk#${idk}` };
  const got = await ddb.send(new GetCommand({ TableName: tableObjects, Key: key as any }));
  return Boolean(got.Item);
}
async function markAppliedKey(tenantId: string, soId: string, idk?: string | null) {
  if (!idk) return;
  const now = new Date().toISOString();
  await ddb.send(new PutCommand({
    TableName: tableObjects,
    Item: { pk: `IDEMP#${tenantId}#so-fulfill#${soId}`, sk: `idk#${idk}`, createdAt: now } as any
  }));
}

/** Canonical signature of request lines for payload-based idempotency */
function canonicalizeLines(lines: LineReq[]) {
  const norm = lines.map(l => ({
    id: l.id ?? undefined,
    lineId: l.lineId ?? undefined,
    deltaQty: Number(l.deltaQty ?? 0),
    locationId: l.locationId ?? undefined,
    lot: l.lot ?? undefined,
  }));
  norm.sort((a, b) =>
    String(a.id ?? a.lineId).localeCompare(String(b.id ?? b.lineId)) ||
    a.deltaQty - b.deltaQty ||
    String(a.lot ?? "").localeCompare(String(b.lot ?? "")) ||
    String(a.locationId ?? "").localeCompare(String(b.locationId ?? ""))
  );
  return JSON.stringify(norm);
}
function hashStr(s: string) {
  // tiny stable hash (djb2 xor variant) -> base36
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return (h >>> 0).toString(36);
}
async function alreadyAppliedSig(tenantId: string, soId: string, sig: string) {
  const key = { pk: `IDEMP#${tenantId}#so-fulfill#${soId}`, sk: `sig#${sig}` };
  const got = await ddb.send(new GetCommand({ TableName: tableObjects, Key: key as any }));
  return Boolean(got.Item);
}
async function markAppliedSig(tenantId: string, soId: string, sig: string) {
  const now = new Date().toISOString();
  await ddb.send(new PutCommand({
    TableName: tableObjects,
    Item: { pk: `IDEMP#${tenantId}#so-fulfill#${soId}`, sk: `sig#${sig}`, createdAt: now } as any
  }));
}

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

    // Extract idempotency key early
    const idk = (event.headers?.["Idempotency-Key"] || event.headers?.["idempotency-key"] || null) as string | null;

    const body = parse<{ lines: LineReq[] }>(event);
    const reqLines = Array.isArray(body?.lines) ? body.lines : [];
    if (reqLines.length === 0) return json(400, { message: "lines[] required" });

    const so = await loadSO(tenantId, id);
    if (!so) return notFound("Sales order not found", requestId);
    logger.info(logCtx, "so-fulfill.load", { soId: so.id, status: so.status, reqCount: reqLines.length, idempotencyKey: idk });

    // Early idempotency check (safe to short-circuit before validation)
    if (idk && await alreadyAppliedKey(tenantId, so.id, idk)) {
      logger.info(logCtx, "so-fulfill.idempotency-key-hit", { soId: so.id, idempotencyKey: idk });
      const fresh = await loadSO(tenantId, so.id);
      return json(200, fresh ?? so);
    }

    // Guard status: allow fulfill from committed or partially_fulfilled
    if (!["committed", "partially_fulfilled"].includes(so.status)) {
      logger.warn(logCtx, "so-fulfill.guard", { reason: "bad_status", status: so.status });
      // Emit failure event
      emitDomainEvent(logCtx, "SalesOrderFulfilled", {
        objectType: "salesOrder",
        objectId: so.id,
        lineCount: reqLines.length,
        totalQtyFulfilled: 0,
        statusBefore: so.status,
        statusAfter: so.status,
        result: "fail",
        errorCode: "INVALID_STATUS",
      });
      return conflictError(`Cannot fulfill from status=${so.status}`, undefined, requestId);
    }

    const linesById = new Map<string, SOLine>((so.lines ?? []).map(l => [l.id, l]));
    const normalizedLines: Array<{ lineKey: string; deltaQty: number; locationId?: string; lot?: string }> = [];
    const lineIdUsage: boolean[] = [];
    for (let i = 0; i < reqLines.length; i++) {
      const l = reqLines[i];
      const lineKey = l.id ?? l.lineId;
      // Explicit validation: lineKey required, deltaQty must be positive integer
      if (!lineKey) {
        return badRequest("Each line requires { id or lineId }", undefined, requestId);
      }
      if (typeof l.deltaQty !== "number" || !Number.isFinite(l.deltaQty) || l.deltaQty <= 0) {
        return badRequest(`Line ${lineKey}: deltaQty must be a positive number`, { code: "INVALID_QTY", lineKey, deltaQty: l.deltaQty }, requestId);
      }
      if (!linesById.has(lineKey)) {
        return badRequest(`Unknown line id=${lineKey}`, { code: "UNKNOWN_LINE", lineKey }, requestId);
      }
      normalizedLines.push({ lineKey, deltaQty: l.deltaQty, locationId: l.locationId, lot: l.lot });
      lineIdUsage[i] = !l.id && !!l.lineId;
    }

    // Log if any requests used legacy lineId
    const legacyCount = lineIdUsage.filter(Boolean).length;
    if (legacyCount > 0) {
      logger.info(logCtx, "so-fulfill.legacy_lineId", { legacyLineIdCount: legacyCount, totalLines: normalizedLines.length });
    }

    // Payload signature idempotency (AFTER validation - only mark successful operations as idempotent)
    const sig = hashStr(`${so.id ?? id}::${canonicalizeLines(reqLines)}`);
    if (await alreadyAppliedSig(tenantId, so.id, sig)) {
      logger.info(logCtx, "so-fulfill.payload-signature-hit", { soId: so.id, signature: sig });
      const fresh = await loadSO(tenantId, so.id);
      return json(200, fresh ?? so);
    }

    // Prevent over-fulfillment & update SO lines in-memory
    const shipped = await fulfilledSoFar(tenantId, so.id);
    const now = new Date().toISOString();

    for (const r of normalizedLines) {
      const line = linesById.get(r.lineKey)!;
      const already = shipped[r.lineKey] ?? 0;
      const willBe = already + Number(r.deltaQty);
      if (willBe > Number(line.qty ?? 0)) {
        logger.warn(logCtx, "so-fulfill.guard", { lineId: r.lineKey, qtyOrdered: line.qty, already, attempt: r.deltaQty });
        // Emit failure event
        const totalQtyAttempted = normalizedLines.reduce((sum, req) => sum + Number(req.deltaQty), 0);
        emitDomainEvent(logCtx, "SalesOrderFulfilled", {
          objectType: "salesOrder",
          objectId: so.id,
          lineCount: normalizedLines.length,
          totalQtyFulfilled: 0,
          statusBefore: so.status,
          statusAfter: so.status,
          result: "fail",
          errorCode: "OVER_FULFILLMENT",
        });
        return conflictError("Over-fulfillment blocked", { code: "OVER_FULFILLMENT", lineId: r.lineKey, ordered: line.qty, fulfilledSoFar: already, attempt: r.deltaQty }, requestId);
      }
    }

    // Write inventoryMovement rows (action: fulfill) using shared dual-write helper
    let mvCount = 0;
    for (const r of normalizedLines) {
      const line = linesById.get(r.lineKey)!;
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
          lineId: r.lineKey, 
          itemId: line.itemId, 
          error: String(err) 
        });
      }
    }
    logger.info(logCtx, "so-fulfill.movements", { count: mvCount });

    // Update SO lines in-memory with new fulfilledQty (do NOT rely on querying movements)
    // This avoids eventual consistency issues where the movement GSI query may miss newly-written data
    for (const r of normalizedLines) {
      const line = linesById.get(r.lineKey)!;
      const prevFulfilled = line.fulfilledQty ?? 0;
      const newFulfilled = prevFulfilled + Number(r.deltaQty);
      line.fulfilledQty = newFulfilled;
    }

    // Decide new status based on updated in-memory state: if all lines fully fulfilled → fulfilled
    let allFull = true;
    for (const ln of so.lines ?? []) {
      const qtyOrdered = Number(ln.qty ?? 0);
      const fulfilledQty = Number(ln.fulfilledQty ?? 0);
      if (fulfilledQty < qtyOrdered) { allFull = false; break; }
    }
    const nextStatus = allFull ? "fulfilled" : "partially_fulfilled";

    const updated: SalesOrder = { ...so, status: nextStatus, updatedAt: now };
    await ddb.send(new PutCommand({ TableName: tableObjects, Item: updated }));
    logger.info(logCtx, "so-fulfill.saved", { soId: so.id, status: nextStatus });

    // Emit domain event for successful fulfill
    const totalQtyFulfilled = normalizedLines.reduce((sum, r) => sum + Number(r.deltaQty), 0);
    emitDomainEvent(logCtx, "SalesOrderFulfilled", {
      objectType: "salesOrder",
      objectId: so.id,
      lineCount: normalizedLines.length,
      totalQtyFulfilled,
      statusBefore: so.status,
      statusAfter: nextStatus,
      result: "success",
    });

    // Mark idempotency AFTER successful write (both key and payload signature)
    if (idk) await markAppliedKey(tenantId, so.id, idk);
    await markAppliedSig(tenantId, so.id, sig);

    logger.info(logCtx, "so-fulfill.success", { soId: so.id, status: nextStatus, lineCount: normalizedLines.length });
    return json(200, updated);
  } catch (err: any) {
    logger.error({ requestId }, "so-fulfill.error", { message: err?.message });
    return internalError(err, requestId);
  }
}
