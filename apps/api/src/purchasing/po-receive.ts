// apps/api/src/purchasing/po-receive.ts
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { ddb, tableObjects } from "../common/ddb";
import { GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";

type LineReq = { lineId: string; deltaQty: number; locationId?: string; lot?: string };
type POLine = { id: string; itemId: string; qty: number; uom?: string };
type PurchaseOrder = {
  pk: string; sk: string; id: string; type: "purchaseOrder";
  status: "draft"|"submitted"|"approved"|"partially_fulfilled"|"fulfilled"|"cancelled"|"closed";
  vendorId: string;
  lines?: POLine[];
  [k: string]: any;
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

async function loadPO(tenantId: string, id: string): Promise<PurchaseOrder|null> {
  const res = await ddb.send(new GetCommand({ TableName: tableObjects, Key: { pk: tenantId, sk: `purchaseOrder#${id}` } }));
  return (res.Item as PurchaseOrder) ?? null;
}

function rid(prefix="mv") { return `${prefix}_${Math.random().toString(36).slice(2,8)}${Date.now().toString(36).slice(-4)}`; }

/** Sum prior 'receive' movements per PO line to enforce over-receive guard and compute status. */
async function receivedSoFar(tenantId: string, poId: string): Promise<Record<string, number>> {
  const q = await ddb.send(new QueryCommand({
    TableName: tableObjects,
    KeyConditionExpression: "pk = :pk AND begins_with(sk, :pref)",
    ExpressionAttributeValues: { ":pk": tenantId, ":pref": "inventoryMovement#" },
    ProjectionExpression: "#poId, #poLineId, #action, #qty",
    ExpressionAttributeNames: { "#poId":"poId", "#poLineId":"poLineId", "#action":"action", "#qty":"qty" },
  }));
  const out: Record<string, number> = {};
  for (const it of q.Items ?? []) {
    if ((it as any).poId !== poId) continue;
    if ((it as any).action === "receive") {
      const line = String((it as any).poLineId ?? "");
      out[line] = (out[line] ?? 0) + Number((it as any).qty ?? 0);
    }
  }
  return out;
}

export async function handle(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  try {
    const tenantId = tid(event);
    const id = event.pathParameters?.id;
    if (!tenantId || !id) return json(400, { message: "Missing tenant or id" });

    const body = parse<{ lines: LineReq[] }>(event);
    const reqLines = Array.isArray(body?.lines) ? body.lines : [];
    if (reqLines.length === 0) return json(400, { message: "lines[] required" });

    const po = await loadPO(tenantId, id);
    if (!po) return json(404, { message: "Purchase order not found" });

    // Receivable from approved or partially_fulfilled
    if (!["approved","partially_fulfilled"].includes(po.status)) {
      return json(409, { message: "PO not receivable in current status" });
    }

    const linesById = new Map<string, POLine>((po.lines ?? []).map(l => [l.id, l]));
    for (const l of reqLines) {
      if (!l?.lineId || typeof l.deltaQty !== "number" || l.deltaQty <= 0) {
        return json(400, { message: "Each line requires { lineId, deltaQty>0 }" });
      }
      if (!linesById.has(l.lineId)) return json(404, { message: `Unknown lineId ${l.lineId}` });
    }

    // Over-receive guard
    const prior = await receivedSoFar(tenantId, po.id);
    for (const r of reqLines) {
      const line = linesById.get(r.lineId)!;
      const already = prior[r.lineId] ?? 0;
      const willBe = already + Number(r.deltaQty);
      if (willBe > Number(line.qty ?? 0)) {
        return json(409, { message: "Over-receive", lineId: r.lineId });
      }
    }

    // Write movements (action: receive)
    const now = new Date().toISOString();
    for (const r of reqLines) {
      const line = linesById.get(r.lineId)!;
      const mv = {
        pk: tenantId,
        sk: `inventoryMovement#${rid()}`,
        id: rid(),
        type: "inventoryMovement",
        action: "receive",
        itemId: line.itemId,
        qty: Number(r.deltaQty),
        poId: po.id,
        poLineId: line.id,
        locationId: r.locationId,
        lot: r.lot,
        createdAt: now,
        updatedAt: now,
      };
      await ddb.send(new PutCommand({ TableName: tableObjects, Item: mv }));
    }

    // Recompute received totals to decide status
    const totals = await receivedSoFar(tenantId, po.id);
    let allFull = true;
    for (const ln of po.lines ?? []) {
      const got = totals[ln.id] ?? 0;
      if (got < Number(ln.qty ?? 0)) { allFull = false; break; }
    }
    const next = allFull ? "fulfilled" : "partially_fulfilled";

    const updated: PurchaseOrder = { ...po, status: next, updatedAt: now };
    await ddb.send(new PutCommand({ TableName: tableObjects, Item: updated }));
    return json(200, updated);
  } catch (err: any) {
    return json(500, { message: err?.message ?? "Internal Server Error" });
  }
}
