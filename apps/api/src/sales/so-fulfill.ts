// apps/api/src/sales/so-fulfill.ts
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { ddb, tableObjects } from "../common/ddb";
import { GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { resolveTenantId } from "../common/tenant";

type LineReq = { lineId: string; deltaQty: number; locationId?: string; lot?: string };
type SOLine = { id: string; itemId: string; qty: number; uom?: string };
type SalesOrder = {
  pk: string; sk: string; id: string; type: "salesOrder";
  status: "draft"|"submitted"|"approved"|"committed"|"partially_fulfilled"|"fulfilled"|"cancelled"|"closed";
  lines?: SOLine[];
  [k: string]: any;
};

const DEBUG = process.env.MBAPP_DEBUG === "1" || process.env.DEBUG === "1";
const log = (event: APIGatewayProxyEventV2, tag: string, data: Record<string, any>) => {
  if (!DEBUG) return;
  const reqId = (event.requestContext as any)?.requestId;
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
    log(event, "so-fulfill.load", { id: so.id, status: so.status, reqCount: reqLines.length });

    // Guard status: allow fulfill from committed or partially_fulfilled
    if (!["committed", "partially_fulfilled"].includes(so.status)) {
      return json(409, { message: `Cannot fulfill from status=${so.status}` });
    }

    const linesById = new Map<string, SOLine>((so.lines ?? []).map(l => [l.id, l]));
    for (const l of reqLines) {
      if (!l?.lineId || typeof l.deltaQty !== "number" || l.deltaQty <= 0) {
        return json(400, { message: "Each line requires { lineId, deltaQty>0 }" });
      }
      if (!linesById.has(l.lineId)) {
        return json(404, { message: `Unknown lineId ${l.lineId}` });
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
        log(event, "so-fulfill.guard", { lineId: r.lineId, qtyOrdered: line.qty, already, attempt: r.deltaQty });
        return json(409, { message: "Over-fulfillment blocked", lineId: r.lineId, ordered: line.qty, fulfilledSoFar: already, attempt: r.deltaQty });
      }
    }

    // Write inventoryMovement rows (action: fulfill)
    let mvCount = 0;
    for (const r of reqLines) {
      const line = linesById.get(r.lineId)!;
      const item = {
        pk: tenantId,
        sk: `inventoryMovement#${rid()}`,
        id: rid(),
        type: "inventoryMovement",
        docType: "inventoryMovement",
        action: "fulfill",
        itemId: line.itemId,
        qty: Number(r.deltaQty),
        soId: so.id,
        soLineId: line.id,
        locationId: r.locationId,
        lot: r.lot,
        createdAt: now,
        updatedAt: now,
      };
      await ddb.send(new PutCommand({ TableName: tableObjects, Item: item }));
      mvCount++;
    }
    log(event, "so-fulfill.movements", { count: mvCount });

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
    log(event, "so-fulfill.saved", { id: so.id, status: nextStatus });

    return json(200, updated);
  } catch (err: any) {
    log(event, "so-fulfill.error", { message: err?.message });
    return json(500, { message: err?.message ?? "Internal Server Error" });
  }
}
