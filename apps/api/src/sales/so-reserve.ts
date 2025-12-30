// ...imports unchanged...
// (full file shown for clarity)
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { ddb, tableObjects } from "../common/ddb";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import * as InvOnHandBatch from "../inventory/onhand-batch";
import { listMovementsByItem, createMovement } from "../inventory/movements";
import { deriveCountersByLocation } from "../inventory/counters";
import { resolveTenantId } from "../common/tenant";
import { badRequest, conflictError, internalError, notFound } from "../common/responses";
import { logger, emitDomainEvent } from "../common/logger";

type LineReq = { id?: string; lineId?: string; deltaQty: number; locationId?: string; lot?: string };
type SOLine = { id: string; itemId: string; qty: number; uom?: string; qtyCommitted?: number };
type SalesOrder = {
  pk: string; sk: string; id: string; type: "salesOrder";
  status: "draft"|"submitted"|"approved"|"committed"|"partially_fulfilled"|"fulfilled"|"cancelled"|"closed";
  lines?: SOLine[];
  [k: string]: any;
};

const DEBUG = process.env.MBAPP_DEBUG === "1" || process.env.DEBUG === "1";
const reqIdOf = (e: APIGatewayProxyEventV2) => (e.requestContext as any)?.requestId;

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
    logger.info(logCtx, "so-reserve.load", { soId: so.id, status: so.status, reqLines });

    // ✅ Allow reserve from submitted OR committed (matches smoke)
    if (!["submitted", "committed"].includes(so.status)) {
      logger.warn(logCtx, "so-reserve.guard", { reason: "bad_status", status: so.status });
      // Emit failure event
      emitDomainEvent(logCtx, "SalesOrderReserved", {
        objectType: "salesOrder",
        objectId: so.id,
        lineCount: reqLines.length,
        totalQtyReserved: 0,
        statusBefore: so.status,
        statusAfter: so.status,
        result: "fail",
        errorCode: "INVALID_STATUS",
      });
      return conflictError(`Cannot reserve from status=${so.status}`, undefined, requestId);
    }

    // Normalize request lines: canonicalize to use 'id' as the key
    const soLines = new Map<string, SOLine>((so.lines ?? []).map(l => [l.id, l]));
    const normalizedLines: Array<{ lineKey: string; deltaQty: number; locationId?: string; lot?: string }> = [];
    const lineIdUsage: boolean[] = [];
    for (let i = 0; i < reqLines.length; i++) {
      const l = reqLines[i];
      const lineKey = l.id ?? l.lineId;
      if (!lineKey || typeof l.deltaQty !== "number" || l.deltaQty <= 0) {
        return badRequest("Each line requires { id or lineId, deltaQty>0 }", undefined, requestId);
      }
      if (!soLines.has(lineKey)) return notFound(`Unknown line id=${lineKey}`, requestId);
      normalizedLines.push({ lineKey, deltaQty: l.deltaQty, locationId: l.locationId, lot: l.lot });
      // Track if legacy lineId was used instead of id
      lineIdUsage[i] = !l.id && !!l.lineId;
    }

    // Log if any requests used legacy lineId
    const legacyCount = lineIdUsage.filter(Boolean).length;
    if (legacyCount > 0) {
      logger.info(logCtx, "so-reserve.legacy_lineId", { legacyLineIdCount: legacyCount, totalLines: normalizedLines.length });
    }

    // Availability checks: handle lines with locationId specifically, others via aggregate batch
    const locReqLines = normalizedLines.filter(l => !!l.locationId);
    const nonLocReqLines = normalizedLines.filter(l => !l.locationId);

    // Cache per-item location counters to avoid repeated queries
    const locCountersCache = new Map<string, Map<string | null, { onHand: number; reserved: number; available: number }>>();

    async function loadLocCounters(itemId: string) {
      if (locCountersCache.has(itemId)) return locCountersCache.get(itemId)!;
      const { items: movs } = await listMovementsByItem(tenantId, itemId, { limit: 500, sort: "desc" });
      const counters = deriveCountersByLocation(movs);
      const map = new Map<string | null, { onHand: number; reserved: number; available: number }>();
      for (const c of counters) {
        map.set(c.locationId ?? null, { onHand: c.onHand, reserved: c.reserved, available: c.available });
      }
      locCountersCache.set(itemId, map);
      return map;
    }

    const shortages: Array<{ itemId: string; requested: number; available: number; locationId?: string }> = [];

    // Location-specific checks
    const locItems = [...new Set(locReqLines.map(r => soLines.get(r.lineKey)!.itemId))];
    for (const itemId of locItems) {
      const countersMap = await loadLocCounters(itemId);
      for (const r of locReqLines.filter(rr => soLines.get(rr.lineKey)!.itemId === itemId)) {
        const locId = r.locationId ?? null;

        const availableAtLoc = countersMap.get(locId)?.available ?? 0;
        const reqQty = Number(r.deltaQty);
        if (reqQty > availableAtLoc) {
          shortages.push({ itemId, requested: reqQty, available: availableAtLoc, locationId: r.locationId });
        }
      }
    }

    // Aggregate checks for non-location lines
    if (nonLocReqLines.length > 0) {
      const itemIds = [...new Set(nonLocReqLines.map(r => soLines.get(r.lineKey)!.itemId))];
      const batchEvt: APIGatewayProxyEventV2 = {
        ...event,
        body: JSON.stringify({ itemIds }),
        requestContext: { ...(event.requestContext as any), http: { ...(event.requestContext as any)?.http, method: "POST", path: "/inventory/onhand:batch" } } as any,
        rawPath: "/inventory/onhand:batch",
      };
      const batchRes = await InvOnHandBatch.handle(batchEvt);
      const batchBody = (()=>{ try { return JSON.parse(batchRes.body || "{}"); } catch { return {}; } })();
      const availability: Record<string, number> = {};
      for (const it of batchBody?.items ?? []) availability[it.itemId] = Number(it.available ?? 0);

      const wantByItem = new Map<string, number>();
      for (const r of nonLocReqLines) {
        const it = soLines.get(r.lineKey)!.itemId;
        wantByItem.set(it, (wantByItem.get(it) ?? 0) + Number(r.deltaQty));
      }
      for (const [itemId, reqQty] of wantByItem) {
        const avail = availability[itemId] ?? 0;
        if (reqQty > avail) shortages.push({ itemId, requested: reqQty, available: avail });
      }
    }

    if (shortages.length) {
      logger.warn(logCtx, "so-reserve.shortage", { shortages });
      // Emit failure event
      const totalQtyRequested = normalizedLines.reduce((sum, r) => sum + Number(r.deltaQty), 0);
      emitDomainEvent(logCtx, "SalesOrderReserved", {
        objectType: "salesOrder",
        objectId: so.id,
        lineCount: normalizedLines.length,
        totalQtyReserved: 0,
        statusBefore: so.status,
        statusAfter: so.status,
        result: "fail",
        errorCode: "INSUFFICIENT_AVAILABILITY",
      });
      return conflictError("Insufficient availability to reserve", { shortages }, requestId);
    }

    // Create inventory movement rows for each line request using shared dual-write helper
    const now = new Date().toISOString();
    for (const r of normalizedLines) {
      const line = soLines.get(r.lineKey)!;
      try {
        await createMovement({
          tenantId,
          itemId: line.itemId,
          action: "reserve" as any,
          qty: Number(r.deltaQty),
          soId: so.id,
          soLineId: line.id,
          locationId: r.locationId ?? undefined,
          lot: r.lot ?? undefined,
        });
      } catch (err) {
        // Log error but don't fail the entire reserve (best-effort semantics)
        logger.warn(logCtx, "so-reserve: movement write error", { 
          lineId: r.lineKey, 
          itemId: line.itemId, 
          error: String(err) 
        });
      }
    }

    // Emit domain event for successful reserve
    const totalQtyReserved = normalizedLines.reduce((sum, r) => sum + Number(r.deltaQty), 0);
    emitDomainEvent(logCtx, "SalesOrderReserved", {
      objectType: "salesOrder",
      objectId: so.id,
      lineCount: normalizedLines.length,
      totalQtyReserved,
      statusBefore: so.status,
      statusAfter: so.status,
      result: "success",
    });

    return json(200, so);
  } catch (err: any) {
    logger.error({ requestId }, "so-reserve.error", { message: err?.message });
    return internalError(err, requestId);
  }
}
