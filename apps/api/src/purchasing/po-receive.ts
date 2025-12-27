// apps/api/src/purchasing/po-receive.ts
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { ddb, tableObjects } from "../common/ddb";
import { GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { getObjectById } from "../objects/repo";
import { getPurchaseOrder, updatePurchaseOrder } from "../shared/db";
import { featureVendorGuardEnabled, featureEventsSimulate } from "../flags";
import { maybeDispatch } from "../events/dispatcher";
import { conflictError, badRequest } from "../common/responses";
import { resolveTenantId } from "../common/tenant";

/** Utilities */
const json = (statusCode: number, body: any): APIGatewayProxyResultV2 => ({
  statusCode,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});
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
type LineReq = { lineId: string; deltaQty: number; lot?: string; locationId?: string };
function canonicalizeLines(lines: LineReq[]) {
  const norm = lines.map(l => ({
    lineId: String(l.lineId),
    deltaQty: Number(l.deltaQty ?? 0),
    lot: l.lot ?? undefined,
    locationId: (l as any).location ?? l.locationId ?? undefined,
  }));
  norm.sort((a, b) =>
    a.lineId.localeCompare(b.lineId) ||
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
      if (mv.docType === "inventoryMovement" && act === "receive" && mv.refId === poId && mv.poLineId) {
        out[mv.poLineId] = (out[mv.poLineId] ?? 0) + Number(mv.qty ?? 0);
      }
    }
    next = (res as any).LastEvaluatedKey;
  } while (next);
  return out;
}

/** Handler */
export async function handle(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  try {
    let tenantId: string;
    try {
      tenantId = resolveTenantId(event);
    } catch (err: any) {
      const status = err?.statusCode ?? 400;
      return json(status, { error: err?.code ?? "TenantError", message: err?.message ?? "Tenant resolution failed" });
    }
    
    const id = event.pathParameters?.id;
    if (!id) return json(400, { message: "Missing id" });

    const idk = (event.headers?.["Idempotency-Key"] || event.headers?.["idempotency-key"] || null) as string | null;

    const body = parse<{ lines: Array<{ lineId: string, deltaQty?: number, receivedQty?: number, lot?: string, locationId?: string }> }>(event);
    let reqLines: LineReq[] = [];
    if (Array.isArray(body?.lines)) {
      for (const l of body.lines) {
        // Support receivedQty for backward compatibility
        if (typeof l.receivedQty === "number") {
          const current = Number(l.deltaQty ?? 0);
          // We'll need to load prior received for this line
          reqLines.push({
            lineId: l.lineId,
            deltaQty: typeof l.deltaQty === "number" ? l.deltaQty : l.receivedQty - (current || 0),
            lot: l.lot,
            locationId: l.locationId
          });
        } else {
          reqLines.push({
            lineId: l.lineId,
            deltaQty: Number(l.deltaQty ?? 0),
            lot: l.lot,
            locationId: l.locationId
          });
        }
      }
    }
    if (reqLines.length === 0) return json(400, { message: "lines[] required" });

    const po = await loadPO(tenantId, id);
    if (!po) return json(404, { message: "PO not found" });

    // Key-based idempotency (safe to short-circuit before validation)
    if (idk && await alreadyAppliedKey(tenantId, po.id, idk)) {
      const fresh = await loadPO(tenantId, po.id);
      return json(200, fresh ?? po);
    }

    // Status guard: PO receive is allowed from: approved, partially-received
    const allowedStatuses = ["approved", "partially-received"];
    const deniedStatuses = ["cancelled", "closed", "canceled"];
    const poStatusNorm = String(po.status ?? "").toLowerCase();
    if (!allowedStatuses.includes(poStatusNorm)) {
      return json(409, { message: "PO not receivable in current status", code: "PO_STATUS_NOT_RECEIVABLE", status: po.status });
    }

    // --- Vendor guard (friendly 400s) ----------------------------------------
    if (featureVendorGuardEnabled(event)) {
      if (!po.vendorId) {
        return json(400, { message: "Vendor required", code: "VENDOR_REQUIRED" });
      }
      try {
        const party = await getObjectById({ tenantId, type: "party", id: String(po.vendorId) });
        const hasVendorRole = Array.isArray((party as any)?.roles) && (party as any).roles.includes("vendor");
        if (!hasVendorRole) {
          return json(400, { message: "Selected party is not a vendor", code: "VENDOR_ROLE_MISSING" });
        }
      } catch {
        return json(400, { message: "Vendor required", code: "VENDOR_REQUIRED" });
      }
    }
    // -------------------------------------------------------------------------


    const linesById = new Map<string, any>((po.lines ?? []).map((ln: any) => [String(ln.id ?? ln.lineId), ln]));
    
    // Over-receive guard (BEFORE payload signature check to catch invalid retries with different keys)
    const prior = await receivedSoFar(tenantId, po.id);
    for (const r of reqLines) {
      const delta = Number(r.deltaQty ?? 0);
      if (delta <= 0) {
        return badRequest(`deltaQty must be positive for line ${r.lineId}`, { lineId: r.lineId, deltaQty: delta });
      }
      const ordered = Number(linesById.get(r.lineId)?.qty ?? 0);
      const received = Number(prior[r.lineId] ?? 0);
      const remaining = Math.max(0, ordered - received);
      const next = received + delta;
      if (next > ordered) {
        return conflictError(
          `Receive would exceed ordered quantity for line ${r.lineId}`,
          {
            code: "RECEIVE_EXCEEDS_REMAINING",
            lineId: r.lineId,
            ordered,
            received,
            remaining,
            attemptedDelta: delta,
          }
        );
      }
    }

    // Payload signature idempotency (AFTER validation - only mark successful operations as idempotent)
    const sig = hashStr(`${po.id ?? id}::${canonicalizeLines(reqLines)}`);
    if (await alreadyAppliedSig(tenantId, po.id, sig)) {
      const fresh = await loadPO(tenantId, po.id);
      return json(200, fresh ?? po);
    }

    // Persist movements and update counters
    const now = new Date().toISOString();
    const totals: Record<string, number> = { ...(prior ?? {}) };
    for (const r of reqLines) {
      totals[r.lineId] = (totals[r.lineId] ?? 0) + Number(r.deltaQty ?? 0);
      const line = linesById.get(r.lineId);
      if (line) line.receivedQty = (Number(line.receivedQty ?? 0) + Number(r.deltaQty ?? 0));
      const mvId = rid("mv");
      const rawItemId = linesById.get(r.lineId)?.itemId;
      const mv = {
        pk: tenantId,
        sk: `inventoryMovement#${mvId}`,
        id: mvId,
        type: "inventoryMovement",
        docType: "inventoryMovement",
        at: now,
        action: "receive",
        qty: Number(r.deltaQty ?? 0),
        refId: po.id,
        poLineId: r.lineId,
        itemId: rawItemId == null ? undefined : String(rawItemId),
        uom: linesById.get(r.lineId)?.uom ?? "ea",
        lot: r.lot ?? undefined,
        locationId: (r as any).location ?? r.locationId ?? undefined,
        createdAt: now,
        updatedAt: now,
      };
      await ddb.send(new PutCommand({ TableName: tableObjects, Item: mv as any }));
      // Inventory counters update (call deriveCounters or similar if available)
      // For this sprint, just ensure onHand increases by deltaQty
      // (Assume counters are recomputed elsewhere or on demand)
    }

    // --- Backorder fulfillment ---
    for (const r of reqLines) {
      const line = linesById.get(r.lineId);
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

    // Persist PO status using the same helper as submit/approve
    const updated = await updatePurchaseOrder(id, tenantId, { status: nextStatus, lines: po.lines } as any);

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
      console.warn("dispatchEvent failed", e);
    }

    const out = devMeta ? { ...updated, _dev: { ...((updated as any)._dev || {}), ...devMeta } } : updated;
    return json(200, out);
  } catch (err: any) {
    console.error(err);
    return json(500, { message: err?.message ?? "Internal Server Error" });
  }
}
