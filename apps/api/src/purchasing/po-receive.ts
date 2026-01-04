// apps/api/src/purchasing/po-receive.ts
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { ddb, tableObjects } from "../common/ddb";
import { GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { getObjectById } from "../objects/repo";
import { normalizeTypeParam } from "../objects/type-alias";
import { getPurchaseOrder, updatePurchaseOrder } from "../shared/db";
import { createMovement } from "../inventory/movements";
import { featureVendorGuardEnabled, featureEventsSimulate } from "../flags";
import { maybeDispatch } from "../events/dispatcher";
import { conflictError, badRequest, internalError, notFound } from "../common/responses";
import { resolveTenantId } from "../common/tenant";
import { logger, emitDomainEvent } from "../common/logger";

/** Utilities */
const json = (statusCode: number, body: any): APIGatewayProxyResultV2 => ({
  statusCode,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});
const reqIdOf = (event: APIGatewayProxyEventV2) => (event.requestContext as any)?.requestId;
const parse = <T = any>(e: APIGatewayProxyEventV2): T => { try { return JSON.parse(e.body || "{}"); } catch { return {} as any; } };
function rid(prefix = "mv") { return `${prefix}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`; }

/** Safe numeric extraction from unknown values */
const num = (v: unknown, fallback = 0): number => {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
};

/** Idempotency ledger: (tenant, poId) × { Idempotency-Key | payload signature } */
async function alreadyAppliedKey(tenantId: string, poId: string, idk?: string | null) {
  if (!idk) return false;
  const key = { pk: `IDEMP#${tenantId}#po-receive#${poId}`, sk: `idk#${idk}` };
  const got = await ddb.send(new GetCommand({ TableName: tableObjects, Key: key as any }));
  return Boolean(got.Item);
}
async function markAppliedKey(tenantId: string, poId: string, idk?: string | null) {
  if (!idk) return;
  const now = new Date().toISOString();
  await ddb.send(new PutCommand({
    TableName: tableObjects,
    Item: { pk: `IDEMP#${tenantId}#po-receive#${poId}`, sk: `idk#${idk}`, createdAt: now } as any
  }));
}

/** Simple canonical signature of request lines so same payload is idempotent even with a different key */
type LineReq = { id?: string; lineId?: string; deltaQty: number; lot?: string; locationId?: string };
function canonicalizeLines(lines: LineReq[]) {
  const norm = lines.map(l => ({
    id: l.id ?? undefined,
    lineId: l.lineId ?? undefined,
    deltaQty: Number(l.deltaQty ?? 0),
    lot: l.lot ?? undefined,
    locationId: (l as any).location ?? l.locationId ?? undefined,
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
async function alreadyAppliedSig(tenantId: string, poId: string, sig: string) {
  const key = { pk: `IDEMP#${tenantId}#po-receive#${poId}`, sk: `sig#${sig}` };
  const got = await ddb.send(new GetCommand({ TableName: tableObjects, Key: key as any }));
  return Boolean(got.Item);
}
async function markAppliedSig(tenantId: string, poId: string, sig: string) {
  const now = new Date().toISOString();
  await ddb.send(new PutCommand({
    TableName: tableObjects,
    Item: { pk: `IDEMP#${tenantId}#po-receive#${poId}`, sk: `sig#${sig}`, createdAt: now } as any
  }));
}

/** Load PO via shared DB (keeps status in the same store as submit/approve) */
async function loadPO(tenantId: string, poId: string) {
  return await getPurchaseOrder(tenantId, poId);
}

async function receivedSoFar(tenantId: string, poId: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  let next: any | undefined;
  do {
    const res = await ddb.send(new QueryCommand({
      TableName: tableObjects,
      KeyConditionExpression: "pk = :pk AND begins_with(#sk, :sk)",
      ExpressionAttributeNames: { "#sk": "sk" },
      ExpressionAttributeValues: { ":pk": tenantId, ":sk": "inventoryMovement#" },
      ExclusiveStartKey: next,
    } as any));
    for (const mv of (res.Items ?? []) as any[]) {
      const act = (mv.action ?? mv.type)?.toLowerCase?.();
      const isMovement = normalizeTypeParam(mv.docType as string) === "inventoryMovement" || normalizeTypeParam(mv.type as string) === "inventoryMovement";
      if (isMovement && act === "receive" && mv.refId === poId && mv.poLineId) {
        out[mv.poLineId] = (out[mv.poLineId] ?? 0) + Number(mv.qty ?? 0);
      }
    }
    next = (res as any).LastEvaluatedKey;
  } while (next);
  return out;
}

/** Handler */
export async function handle(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const requestId = reqIdOf(event);
  let logCtx: { requestId?: string; tenantId?: string; route?: string; path?: string; method?: string; userId?: string } = { requestId };
  try {
    let tenantId: string;
    try {
      tenantId = resolveTenantId(event);
    } catch (err: any) {
      const status = err?.statusCode ?? 400;
      return badRequest(err?.message ?? "Tenant resolution failed", { code: err?.code ?? "TenantError" }, requestId);
    }
    
    const id = event.pathParameters?.id;
    if (!id) return badRequest("Missing id", undefined, requestId);

    logCtx = { ...logCtx, tenantId, route: event.rawPath ?? event.requestContext?.http?.path, method: event.requestContext?.http?.method };

    const idk = (event.headers?.["Idempotency-Key"] || event.headers?.["idempotency-key"] || null) as string | null;

    const body = parse<{ lines: Array<{ id?: string; lineId?: string; deltaQty?: number; receivedQty?: number; lot?: string; locationId?: string }> }>(event);
    let reqLines: LineReq[] = [];
    const lineIdUsage: boolean[] = [];
    if (Array.isArray(body?.lines)) {
      for (let i = 0; i < body.lines.length; i++) {
        const l = body.lines[i];
        const lineKey = l.id ?? l.lineId;
        if (!lineKey) continue;
        // Support receivedQty for backward compatibility
        if (typeof l.receivedQty === "number") {
          const current = Number(l.deltaQty ?? 0);
          // We'll need to load prior received for this line
          reqLines.push({
            id: l.id,
            lineId: l.lineId,
            deltaQty: typeof l.deltaQty === "number" ? l.deltaQty : l.receivedQty - (current || 0),
            lot: l.lot,
            locationId: l.locationId
          });
        } else {
          reqLines.push({
            id: l.id,
            lineId: l.lineId,
            deltaQty: Number(l.deltaQty ?? 0),
            lot: l.lot,
            locationId: l.locationId
          });
        }
        lineIdUsage[reqLines.length - 1] = !l.id && !!l.lineId;
      }
    }
    if (reqLines.length === 0) {
      logger.warn(logCtx, "po.receive: missing lines", { tenantId, poId: id });
      return badRequest("lines[] required", { code: "LINES_REQUIRED" }, requestId);
    }

    logger.info(logCtx, "po.receive: loading PO", { tenantId, poId: id, idempotencyKey: idk, lineCount: reqLines.length });
    const po = await loadPO(tenantId, id);
    if (!po) {
      logger.warn(logCtx, "po.receive: PO not found", { tenantId, poId: id });
      return notFound("PO not found (PO_NOT_FOUND)", requestId);
    }
    const logExtra = { tenantId, poId: po.id, vendorId: po.vendorId, lineCount: reqLines.length, idempotencyKey: idk };

    // Key-based idempotency (safe to short-circuit before validation)
    if (idk && await alreadyAppliedKey(tenantId, po.id, idk)) {
      logger.info(logCtx, "po.receive: idempotency key hit", { ...logExtra, idempotencyKey: idk });
      const fresh = await loadPO(tenantId, po.id);
      return json(200, fresh ?? po);
    }

    // Status guard: PO receive is allowed from: approved, partially-received
    const allowedStatuses = ["approved", "partially-received"];
    const deniedStatuses = ["cancelled", "closed", "canceled"];
    const poStatusNorm = String(po.status ?? "").toLowerCase();
    if (!allowedStatuses.includes(poStatusNorm)) {
      logger.warn(logCtx, "po.receive: status not receivable", { ...logExtra, status: po.status });
      return conflictError(
        "PO not receivable in current status",
        { code: "PO_STATUS_NOT_RECEIVABLE", status: po.status },
        requestId
      );
    }

    // --- Vendor guard (friendly 400s) ----------------------------------------
    if (featureVendorGuardEnabled(event)) {
      if (!po.vendorId) {
        logger.warn(logCtx, "po.receive: vendor missing", { ...logExtra });
        return badRequest("Vendor required", { code: "VENDOR_REQUIRED" }, requestId);
      }
      try {
        const party = await getObjectById({ tenantId, type: "party", id: String(po.vendorId) });
        const hasVendorRole = Array.isArray((party as any)?.roles) && (party as any).roles.includes("vendor");
        if (!hasVendorRole) {
          logger.warn(logCtx, "po.receive: vendor role missing", { ...logExtra });
          return badRequest("Selected party is not a vendor", { code: "VENDOR_ROLE_MISSING" }, requestId);
        }
      } catch {
        logger.warn(logCtx, "po.receive: vendor load failed", { ...logExtra });
        return badRequest("Vendor required", { code: "VENDOR_REQUIRED" }, requestId);
      }
    }
    // -------------------------------------------------------------------------


    const linesById = new Map<string, any>((po.lines ?? []).map((ln: any) => [String(ln.id ?? ln.lineId), ln]));
    
    // Log if any requests used legacy lineId
    const legacyCount = lineIdUsage.filter(Boolean).length;
    if (legacyCount > 0) {
      logger.info(logCtx, "po-receive.legacy_lineId", { legacyLineIdCount: legacyCount, totalLines: reqLines.length });
    }

    // Normalize lines to use canonical lineKey and validate
    const normalizedLines: Array<{ lineKey: string; deltaQty: number; lot?: string; locationId?: string }> = [];
    for (const r of reqLines) {
      const lineKey = r.id ?? r.lineId;
      if (!lineKey || !linesById.has(lineKey)) {
        logger.warn(logCtx, "po.receive: unknown line", { ...logExtra, lineId: lineKey });
        return badRequest(`Unknown line id=${lineKey}`, { code: "UNKNOWN_LINE", lineId: lineKey }, requestId);
      }
      normalizedLines.push({ lineKey, deltaQty: r.deltaQty, lot: r.lot, locationId: r.locationId });
    }

    // Over-receive guard (BEFORE payload signature check to catch invalid retries with different keys)
    const prior = await receivedSoFar(tenantId, po.id);
    for (const r of normalizedLines) {
      const delta = Number(r.deltaQty ?? 0);
      if (delta <= 0) {
        logger.warn(logCtx, "po.receive: non-positive delta", { ...logExtra, lineId: r.lineKey, deltaQty: delta });
        return badRequest(`deltaQty must be positive for line ${r.lineKey}`, { lineId: r.lineKey, deltaQty: delta }, requestId);
      }
      const ordered = Number(linesById.get(r.lineKey)?.qty ?? 0);
      const received = Number(prior[r.lineKey] ?? 0);
      const remaining = Math.max(0, ordered - received);
      const next = received + delta;
      if (next > ordered) {
        logger.warn(logCtx, "po.receive: receive exceeds remaining", { ...logExtra, lineId: r.lineKey, ordered, received, remaining, attemptedDelta: delta });
        return conflictError(
          `Receive would exceed ordered quantity for line ${r.lineKey}`,
          {
            code: "RECEIVE_EXCEEDS_REMAINING",
            lineId: r.lineKey,
            ordered,
            received,
            remaining,
            attemptedDelta: delta,
          },
          requestId
        );
      }
    }

    // Payload signature idempotency (AFTER validation - only mark successful operations as idempotent)
    const sig = hashStr(`${po.id ?? id}::${canonicalizeLines(reqLines)}`);
    if (await alreadyAppliedSig(tenantId, po.id, sig)) {
      logger.info(logCtx, "po.receive: payload signature hit", { ...logExtra, signature: sig });
      const fresh = await loadPO(tenantId, po.id);
      return json(200, fresh ?? po);
    }

    // Persist movements and update counters
    const now = new Date().toISOString();
    const totals: Record<string, number> = { ...(prior ?? {}) };
    for (const r of normalizedLines) {
      totals[r.lineKey] = (totals[r.lineKey] ?? 0) + Number(r.deltaQty ?? 0);
      const line = linesById.get(r.lineKey);
      if (line) line.receivedQty = (Number(line.receivedQty ?? 0) + Number(r.deltaQty ?? 0));
      
      // Write movement via shared dual-write helper (canonical + timeline index)
      const rawItemId = linesById.get(r.lineKey)?.itemId;
      try {
        await createMovement({
          tenantId,
          itemId: rawItemId == null ? "" : String(rawItemId),
          action: "receive" as any,
          qty: Number(r.deltaQty ?? 0),
          refId: po.id,
          poLineId: line?.id ?? r.lineKey,
          lot: r.lot ?? undefined,
          locationId: (r as any).location ?? r.locationId ?? undefined,
        });
      } catch (err) {
        // Log error but don't fail the entire receive (best-effort semantics)
        logger.warn(logCtx, "po.receive: movement write error", { 
          lineId: r.lineKey, 
          itemId: rawItemId, 
          error: String(err) 
        });
      }
    }

    // --- Backorder fulfillment ---
    for (const r of normalizedLines) {
      const line = linesById.get(r.lineKey);
      if (line?.backorderRequestIds && Array.isArray(line.backorderRequestIds)) {
        for (const backorderId of line.backorderRequestIds) {
          // Minimal logic: load backorder, decrement remainingQty, set status to fulfilled if 0
          // Use helper if available, else inline
          // (Assume getObjectById can load backorder request)
          try {
            const backorder = await getObjectById({ tenantId, type: "backorderRequest", id: backorderId });
            if (backorder) {
              const bo: any = backorder as any;
              const qty = num(bo.qty);
              const fulfilled = num(bo.fulfilledQty);
              const remainingExisting = bo.remainingQty;
              let remaining =
                typeof remainingExisting === "number"
                  ? remainingExisting
                  : Math.max(0, qty - fulfilled);
              remaining -= Number(r.deltaQty ?? 0);
              if (remaining <= 0) {
                // Fulfill
                const newFulfilled = qty;
                await ddb.send(new PutCommand({
                  TableName: tableObjects,
                  Item: { ...bo, status: "fulfilled", remainingQty: 0, fulfilledQty: newFulfilled, updatedAt: now }
                }));
              } else {
                const newFulfilled = Math.max(0, qty - remaining);
                await ddb.send(new PutCommand({
                  TableName: tableObjects,
                  Item: { ...bo, remainingQty: remaining, fulfilledQty: newFulfilled, updatedAt: now }
                }));
              }
            }
          } catch (e) {
            // Ignore missing backorder for this sprint
          }
        }
      }
    }

    // Next status: emit only 'fulfilled' or 'partially-received' (never 'partially_fulfilled' from receive)
    let allFull = true;
    for (const ln of po.lines ?? []) {
      const lineId = ln.id;
      const got = num(totals[lineId] ?? (ln as any).receivedQty ?? 0);
      if (got < Number(ln.qty ?? 0)) { allFull = false; break; }
    }
    const nextStatus = allFull ? "fulfilled" : "partially-received";
    logger.info(logCtx, "po.receive: computed next status", { ...logExtra, nextStatus });

    // Persist PO status using the same helper as submit/approve
    const updated = await updatePurchaseOrder(id, tenantId, { status: nextStatus, lines: po.lines } as any);

    logger.info(logCtx, "po.receive: updated PO", { ...logExtra, nextStatus });

    // Emit domain event
    const totalQtyReceived = reqLines.reduce((sum, r) => sum + Number(r.deltaQty ?? 0), 0);
    emitDomainEvent(logCtx, "PurchaseOrderReceived", {
      objectType: "purchaseOrder",
      objectId: po.id,
      lineCount: reqLines.length,
      totalQtyReceived,
      statusBefore: po.status,
      statusAfter: nextStatus,
      result: "success",
    });

    // Mark idempotency AFTER successful write (both key and payload signature)
    if (idk) await markAppliedKey(tenantId, po.id, idk);
    await markAppliedSig(tenantId, po.id, sig);

    // Emit system events (no-op dispatcher; safe even without a bus)
    let devMeta: { emitted?: boolean; provider?: string } | undefined;
    try {
      const nowIso = now;
      const metaRoot = await maybeDispatch(event, { type: "po.received", payload: { poId: String(po.id), actorId: null, at: nowIso } });
      if (metaRoot?.emitted) devMeta = { ...(devMeta || {}), ...metaRoot };
      for (const r of reqLines) {
        const qty = Number(r.deltaQty ?? 0);
        if (qty > 0) {
          const metaLine = await maybeDispatch(event, {
            type: "po.line.received",
            payload: {
              poId: String(po.id),
              lineId: String(r.lineId),
              qty,
              lot: r.lot,
              locationId: (r as any).location ?? r.locationId ?? undefined,
              actorId: null,
              at: nowIso,
            },
          });
          if (metaLine?.emitted) devMeta = { ...(devMeta || {}), ...metaLine };
        }
      }
    } catch (e) {
      logger.warn(logCtx, "po.receive: dispatchEvent failed", { ...logExtra, error: (e as any)?.message });
    }

    const out = devMeta ? { ...updated, _dev: { ...((updated as any)._dev || {}), ...devMeta } } : updated;
    logger.info(logCtx, "po.receive: success", { ...logExtra, nextStatus });
    return json(200, out);
  } catch (err: any) {
    logger.error(logCtx, "po.receive: unhandled error", { error: err?.message, stack: err?.stack });
    return internalError(err?.message ?? "Internal Server Error", requestId);
  }
}
