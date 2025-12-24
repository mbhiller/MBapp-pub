import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { ddb, tableObjects } from "../common/ddb";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { resolveTenantId } from "../common/tenant";

type LineReq = { lineId: string; deltaQty: number; reason?: string };
type SOLine = { id: string; itemId: string; qty: number; uom?: string };
type SalesOrder = {
  pk: string; sk: string; id: string; type: "salesOrder";
  status: "draft"|"submitted"|"approved"|"committed"|"partially_fulfilled"|"fulfilled"|"cancelled"|"closed";
  lines?: SOLine[];
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
const tid = (e: APIGatewayProxyEventV2) => resolveTenantId(e);
const parse = <T=any>(e: APIGatewayProxyEventV2): T => { try { return JSON.parse(e.body||"{}"); } catch { return {} as any; } };

async function loadSO(tenantId: string, id: string): Promise<SalesOrder|null> {
  const res = await ddb.send(new GetCommand({ TableName: tableObjects, Key: { pk: tenantId, sk: `salesOrder#${id}` } }));
  return (res.Item as SalesOrder) ?? null;
}

function rid(prefix="imv") { return `${prefix}_${Math.random().toString(36).slice(2,8)}${Date.now().toString(36).slice(-4)}`; }

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

    // Release makes sense only if previously reserved/committed; we allow from 'committed' and onward (not cancelled/closed)
    if (["cancelled","closed"].includes(so.status)) {
      return json(409, { message: `Cannot release in status=${so.status}` });
    }

    const soLines = new Map<string, SOLine>((so.lines ?? []).map(l => [l.id, l]));
    for (const l of reqLines) {
      if (!l?.lineId || typeof l.deltaQty !== "number" || l.deltaQty < 0) {
        return json(400, { message: "Each line requires { lineId, deltaQty>=0 }" });
      }
      if (!soLines.has(l.lineId)) {
        return json(404, { message: `Unknown lineId ${l.lineId}` });
      }
    }

    // Emit inventory movements with action 'release'
    const now = new Date().toISOString();
    for (const r of reqLines) {
      const line = soLines.get(r.lineId)!;
      const mv = {
        pk: tenantId,
        sk: `inventoryMovement#${rid()}`,
        id: rid("mv"),
        type: "inventoryMovement",
        action: "release",
        itemId: line.itemId,
        qty: Number(r.deltaQty),
        reason: r.reason ?? "release",
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
