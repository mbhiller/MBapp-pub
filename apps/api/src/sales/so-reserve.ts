// ...imports unchanged...
// (full file shown for clarity)
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { ddb, tableObjects } from "../common/ddb";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import * as InvOnHandBatch from "../inventory/onhand-batch";

type LineReq = { lineId: string; deltaQty: number };
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

const tid = (e: APIGatewayProxyEventV2) =>
  (e as any)?.requestContext?.authorizer?.mbapp?.tenantId || (e.headers?.["X-Tenant-Id"] as string) || "";

const parse = <T=any>(e: APIGatewayProxyEventV2): T => { try { return JSON.parse(e.body||"{}"); } catch { return {} as any; } };

async function loadSO(tenantId: string, id: string): Promise<SalesOrder|null> {
  const res = await ddb.send(new GetCommand({ TableName: tableObjects, Key: { pk: tenantId, sk: `salesOrder#${id}` } }));
  return (res.Item as SalesOrder) ?? null;
}

function rid(prefix="mv") { return `${prefix}_${Math.random().toString(36).slice(2,8)}${Date.now().toString(36).slice(-4)}`; }

export async function handle(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  try {
    const tenantId = tid(event);
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

    // Availability check per item (batch)
    const itemIds = [...new Set(reqLines.map(r => soLines.get(r.lineId)!.itemId))];
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

    // Aggregate requested reserve per item
    const wantByItem = new Map<string, number>();
    for (const r of reqLines) {
      const it = soLines.get(r.lineId)!.itemId;
      wantByItem.set(it, (wantByItem.get(it) ?? 0) + Number(r.deltaQty));
    }

    const shortages: Array<{ itemId: string; requested: number; available: number }> = [];
    for (const [itemId, reqQty] of wantByItem) {
      const avail = availability[itemId] ?? 0;
      if (reqQty > avail) shortages.push({ itemId, requested: reqQty, available: avail });
    }
    if (shortages.length) return json(409, { message: "Insufficient availability to reserve", shortages });

    // Create inventory movement rows for each line request
    const now = new Date().toISOString();
    for (const r of reqLines) {
      const line = soLines.get(r.lineId)!;
      const mv = {
        pk: tenantId,
        sk: `inventoryMovement#${rid()}`,
        id: rid(),
        type: "inventoryMovement",
        action: "reserve",
        itemId: line.itemId,
        qty: Number(r.deltaQty),
        soId: so.id,
        soLineId: line.id,
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
