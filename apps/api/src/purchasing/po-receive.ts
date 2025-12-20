// apps/api/src/purchasing/po-receive.ts
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { ddb, tableObjects } from "../common/ddb";
import { GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { getObjectById } from "../objects/repo";
import { getPurchaseOrder, updatePurchaseOrder } from "../shared/db";
import { featureVendorGuardEnabled, featureEventsSimulate } from "../flags";
import { maybeDispatch } from "../events/dispatcher";

/** Utilities */
const json = (statusCode: number, body: any): APIGatewayProxyResultV2 => ({
  statusCode,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});
const parse = <T = any>(e: APIGatewayProxyEventV2): T => { try { return JSON.parse(e.body || "{}"); } catch { return {} as any; } };
function rid(prefix = "mv") { return `${prefix}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`; }
function tid(e: APIGatewayProxyEventV2): string | null {
  const mb = (e as any)?.requestContext?.authorizer?.mbapp?.tenantId;
  if (mb) return String(mb);
  const claim = (e as any)?.requestContext?.authorizer?.jwt?.claims?.["custom:tenantId"];
  const hdr = e.headers?.["x-tenant-id"] || e.headers?.["X-Tenant-Id"];
  const t = mb || claim || hdr;
  return t ? String(t) : null;
}

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
    const tenantId = tid(event);
    const id = event.pathParameters?.id;
    if (!tenantId || !id) return json(400, { message: "Missing tenant or id" });

    const idk = (event.headers?.["Idempotency-Key"] || event.headers?.["idempotency-key"] || null) as string | null;

    const body = parse<{ lines: LineReq[] }>(event);
    const reqLines = Array.isArray(body?.lines) ? body.lines : [];
    if (reqLines.length === 0) return json(400, { message: "lines[] required" });

    const sig = hashStr(canonicalizeLines(reqLines));

    const po = await loadPO(tenantId, id);
    if (!po) return json(404, { message: "PO not found" });

    // Status guard
    if (!["approved", "partially_fulfilled"].includes(String(po.status))) {
      return json(409, { message: "PO not receivable in current status" });
    }

    // Idempotency short-circuit: same key OR same payload signature returns current PO
    if ((idk && await alreadyAppliedKey(tenantId, po.id, idk)) || await alreadyAppliedSig(tenantId, po.id, sig)) {
      const fresh = await loadPO(tenantId, po.id);
      return json(200, fresh ?? po);
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

    // Over-receive guard
    const prior = await receivedSoFar(tenantId, po.id);
    for (const r of reqLines) {
      const base = Number(linesById.get(r.lineId)?.qty ?? 0);
      const got = Number(prior[r.lineId] ?? 0);
      const next = got + Number(r.deltaQty ?? 0);
      if (next > base) {
        return json(409, { message: `Over-receive on line ${r.lineId}`, details: { base, got, delta: r.deltaQty } });
      }
    }

    // Persist movements
    const now = new Date().toISOString();
    const totals: Record<string, number> = { ...(prior ?? {}) };
    for (const r of reqLines) {
      totals[r.lineId] = (totals[r.lineId] ?? 0) + Number(r.deltaQty ?? 0);
      const mvId = rid("mv");
      const mv = {
        pk: tenantId,
        sk: `inventoryMovement#${mvId}`,
        id: mvId,
        type: "inventoryMovement",     // compatibility + spec
        docType: "inventoryMovement",
        at: now,
        action: "receive",
        qty: Number(r.deltaQty ?? 0),
        refId: po.id,                  // PO id
        poLineId: r.lineId,            // PO line id
        itemId: linesById.get(r.lineId)?.itemId,
        uom: linesById.get(r.lineId)?.uom ?? "ea",
        lot: r.lot ?? undefined,
        locationId: (r as any).location ?? r.locationId ?? undefined,
        createdAt: now,
        updatedAt: now,
      };
      await ddb.send(new PutCommand({ TableName: tableObjects, Item: mv as any }));
    }

    // Next status
    let allFull = true;
    for (const ln of po.lines ?? []) {
      const got = totals[ln.id] ?? 0;
      if (got < Number(ln.qty ?? 0)) { allFull = false; break; }
    }
    const nextStatus = allFull ? "fulfilled" : "partially_fulfilled";

    // Persist PO status using the same helper as submit/approve
    const updated = await updatePurchaseOrder(id, tenantId, { status: nextStatus } as any);

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
