// ...imports unchanged...
// (full file shown for clarity)
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { ddb, tableObjects } from "../common/ddb";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import * as InvOnHandBatch from "../inventory/onhand-batch";
import { listMovementsByItem } from "../inventory/movements";
import { deriveCountersByLocation } from "../inventory/counters";
import { resolveTenantId } from "../common/tenant";

type LineReq = { lineId: string; deltaQty: number; locationId?: string; lot?: string };
type SOLine = { id: string; itemId: string; qty: number; uom?: string; qtyCommitted?: number };
type SalesOrder = {
  pk: string; sk: string; id: string; type: "salesOrder";
  status: "draft"|"submitted"|"approved"|"committed"|"partially_fulfilled"|"fulfilled"|"cancelled"|"closed";
  lines?: SOLine[];
  [k: string]: any;
};

const DEBUG = process.env.MBAPP_DEBUG === "1" || process.env.DEBUG === "1";
const log = (e: APIGatewayProxyEventV2, tag: string, data: Record<string, any>) => {
  if (!(DEBUG)) return; const reqId = (e.requestContext as any)?.requestId;
  try { console.log(JSON.stringify({ tag, reqId, ...data })); } catch {}
};

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
  try {
    let tenantId: string;
    try { tenantId = tid(event); } catch (err: any) {
      const status = err?.statusCode ?? 400;
      return json(status, { message: err?.message ?? "Tenant header mismatch" });
    }
    const id = event.pathParameters?.id;
    if (!tenantId || !id) return json(400, { message: "Missing tenant or id" });

    const body = parse<{ lines: LineReq[] }>(event);
    const reqLines = Array.isArray(body?.lines) ? body.lines : [];
    if (reqLines.length === 0) return json(400, { message: "lines[] required" });

    const so = await loadSO(tenantId, id);
    if (!so) return json(404, { message: "Sales order not found" });
    log(event, "so-reserve.load", { id: so.id, status: so.status, reqLines });

    // ✅ Allow reserve from submitted OR committed (matches smoke)
    if (!["submitted", "committed"].includes(so.status)) {
      log(event, "so-reserve.guard", { reason: "bad_status", status: so.status });
      return json(409, { message: `Cannot reserve from status=${so.status}` });
    }

    const soLines = new Map<string, SOLine>((so.lines ?? []).map(l => [l.id, l]));
    for (const l of reqLines) {
      if (!l?.lineId || typeof l.deltaQty !== "number" || l.deltaQty <= 0) {
        return json(400, { message: "Each line requires { lineId, deltaQty>0 }" });
      }
      if (!soLines.has(l.lineId)) return json(404, { message: `Unknown lineId ${l.lineId}` });
    }

    // Availability checks: handle lines with locationId specifically, others via aggregate batch
    const locReqLines = reqLines.filter(l => !!l.locationId);
    const nonLocReqLines = reqLines.filter(l => !l.locationId);

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
    const locItems = [...new Set(locReqLines.map(r => soLines.get(r.lineId)!.itemId))];
    for (const itemId of locItems) {
      const countersMap = await loadLocCounters(itemId);
      for (const r of locReqLines.filter(rr => soLines.get(rr.lineId)!.itemId === itemId)) {
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
      const itemIds = [...new Set(nonLocReqLines.map(r => soLines.get(r.lineId)!.itemId))];
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
        const it = soLines.get(r.lineId)!.itemId;
        wantByItem.set(it, (wantByItem.get(it) ?? 0) + Number(r.deltaQty));
      }
      for (const [itemId, reqQty] of wantByItem) {
        const avail = availability[itemId] ?? 0;
        if (reqQty > avail) shortages.push({ itemId, requested: reqQty, available: avail });
      }
    }

    if (shortages.length) return json(409, { message: "Insufficient availability to reserve", shortages });

    // Create inventory movement rows for each line request
    const now = new Date().toISOString();
    for (const r of reqLines) {
      const line = soLines.get(r.lineId)!;
      const mvId = rid();
      const mv = {
        pk: tenantId,
        sk: `inventoryMovement#${mvId}`,
        id: mvId,
        type: "inventoryMovement",
        docType: "inventoryMovement",
        action: "reserve",
        itemId: line.itemId,
        qty: Number(r.deltaQty),
        soId: so.id,
        soLineId: line.id,
        ...(r.locationId ? { locationId: r.locationId } : {}),
        ...(r.lot ? { lot: r.lot } : {}),
        createdAt: now,
        updatedAt: now,
      };
      await ddb.send(new PutCommand({ TableName: tableObjects, Item: mv }));
    }

    return json(200, so);
  } catch (err: any) {
    return json(500, { message: err?.message ?? "Internal Server Error" });
  }
}
