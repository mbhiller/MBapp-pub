import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { ddb, tableObjects } from "../common/ddb";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { createMovement } from "../inventory/movements";
import { resolveTenantId } from "../common/tenant";
import { logger } from "../common/logger";

type LineReq = { id?: string; lineId?: string; deltaQty: number; reason?: string; locationId?: string; lot?: string };
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
    const normalizedLines: Array<{ lineKey: string; deltaQty: number; reason?: string; locationId?: string; lot?: string }> = [];
    const lineIdUsage: boolean[] = [];
    for (let i = 0; i < reqLines.length; i++) {
      const l = reqLines[i];
      const lineKey = l.id ?? l.lineId;
      if (!lineKey || typeof l.deltaQty !== "number" || l.deltaQty < 0) {
        return json(400, { message: "Each line requires { id or lineId, deltaQty>=0 }" });
      }
      if (!soLines.has(lineKey)) {
        return json(404, { message: `Unknown line id=${lineKey}` });
      }
      normalizedLines.push({ lineKey, deltaQty: l.deltaQty, reason: l.reason, locationId: l.locationId, lot: l.lot });
      lineIdUsage[i] = !l.id && !!l.lineId;
    }

    // Log if any requests used legacy lineId
    const legacyCount = lineIdUsage.filter(Boolean).length;
    if (legacyCount > 0) {
      logger.info({ tenantId }, "so-release.legacy_lineId", { legacyLineIdCount: legacyCount, totalLines: normalizedLines.length });
    }

    // Emit inventory movements with action 'release' using shared dual-write helper
    const now = new Date().toISOString();
    for (const r of normalizedLines) {
      const line = soLines.get(r.lineKey)!;
      try {
        await createMovement({
          tenantId,
          itemId: line.itemId,
          action: "release" as any,
          qty: Number(r.deltaQty),
          note: r.reason ?? "release",
          soId: so.id,
          soLineId: line.id,
          locationId: r.locationId ?? undefined,
          lot: r.lot ?? undefined,
        });
      } catch (err) {
        // Log error but don't fail the entire release (best-effort semantics)
        logger.warn({ tenantId }, "so-release: movement write error", { 
          lineId: r.lineKey, 
          itemId: line.itemId, 
          error: String(err) 
        });
      }
    }

    return json(200, so);
  } catch (err: any) {
    return json(500, { message: err?.message ?? "Internal Server Error" });
  }
}
