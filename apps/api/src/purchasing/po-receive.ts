// apps/api/src/purchasing/po-receive.ts
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import * as ObjGet from "../objects/get";
import * as ObjUpdate from "../objects/update";
import * as ObjCreate from "../objects/create";
import { upsertDelta } from "../inventory/counters";

const json = (c: number, b: unknown): APIGatewayProxyResultV2 => ({
  statusCode: c,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(b),
});

const withTypeId = (e: any, type: string, id?: string, body?: any) => {
  const out: any = { ...e };
  out.queryStringParameters = { ...(e.queryStringParameters || {}), type };
  out.pathParameters = { ...(e.pathParameters || {}), type, ...(id ? { id } : {}) };
  if (body !== undefined) out.body = JSON.stringify(body);
  return out;
};

const bodyOf = <T = any>(e: APIGatewayProxyEventV2) => (e.body ? JSON.parse(e.body) as T : ({} as any));
const header = (e: APIGatewayProxyEventV2, k: string) => e.headers?.[k] || e.headers?.[k.toLowerCase()];

const STRICT_COUNTERS = true; // set true to hard-fail if counters update fails

export async function handle(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const id = event.pathParameters?.id || "";
  if (!id) return json(400, { message: "Missing id" });

  try {
    const idemKey = header(event, "Idempotency-Key") || bodyOf(event).idempotencyKey;

    // Load PO
    const getRes = await ObjGet.handle(withTypeId(event, "purchaseOrder", id));
    if (getRes.statusCode !== 200 || !getRes.body) {
      return json(getRes.statusCode || 500, { where: "getPO", body: getRes.body || null });
    }
    const po = JSON.parse(getRes.body);

    // Guard invalid states
    if (po.status === "cancelled" || po.status === "closed") {
      return json(409, { message: `Cannot receive when status is ${po.status}` });
    }

    // Idempotency: bail if already applied
    const appliedKeys: string[] = (po.metadata?.receiveIdemKeys ?? []) as string[];
    if (idemKey && appliedKeys.includes(idemKey)) return json(200, po);

    // Request
    const req = bodyOf<{ lines: Array<{ lineId: string; deltaQty: number; locationId?: string; lot?: string }> }>(event);
    const reqLines = Array.isArray(req.lines) ? req.lines : [];
    if (reqLines.length === 0) return json(400, { message: "No lines to receive" });

    // Work on a copy
    const next = {
      ...po,
      lines: Array.isArray(po.lines) ? po.lines.map((l: any) => ({ ...l })) : [],
    };

    // Apply each requested receive
    for (const r of reqLines) {
      const idx = next.lines.findIndex((l: any) => String(l.id) === String(r.lineId));
      if (idx === -1) continue;

      const line = next.lines[idx];
      const ordered  = Number(line.qty ?? 0);
      const received = Number(line.qtyReceived ?? 0);
      const delta    = Math.max(0, Math.min(Number(r.deltaQty ?? 0), Math.max(0, ordered - received)));
      if (delta <= 0) continue;

      line.qtyReceived = received + delta;

      // Create inventory movement
      const mv = {
        type: "inventoryMovement",
        ts: new Date().toISOString(),
        itemId: String(line.itemId),
        deltaQty: delta,
        uom: String(line.uom || "each"),
        locationId: r.locationId,
        lot: r.lot,
        sourceType: "PO",
        sourceId: String(po.id),
        lineId: String(line.id),
        notes: "PO receive",
      };

      try {
        const createMv = await ObjCreate.handle(withTypeId(event, "inventoryMovement", undefined, mv));
        if (createMv.statusCode !== 200) {
          const msg = createMv.body ? JSON.parse(String(createMv.body)) : {};
          return json(createMv.statusCode || 500, { where: "createMovement", msg });
        }
      } catch (e: any) {
        return json(500, { where: "createMovement:exception", err: String(e?.message || e), mv });
      }

      // Update counters (onHand += delta)
      try {
        await upsertDelta(event, String(line.itemId), delta, 0);
      } catch (e: any) {
        if (STRICT_COUNTERS) {
          return json(500, {
            where: "upsertDelta(receive)",
            itemId: String(line.itemId),
            err: String(e?.message || e),
          });
        }
        console.error("upsertDelta(receive) failed", { itemId: String(line.itemId), err: e });
      }
    }

    // Status transitions
    const anyReceived = next.lines.some((l: any) => Number(l.qtyReceived ?? 0) > 0);
    const allReceived = next.lines.length > 0 && next.lines.every(
      (l: any) => Number(l.qtyReceived ?? 0) >= Number(l.qty ?? 0)
    );
    if (allReceived) next.status = "received";
    else if (anyReceived) next.status = "partially_received";

    // Persist idempotency key
    if (idemKey) {
      const set = new Set([...(po.metadata?.receiveIdemKeys ?? []), idemKey]);
      next.metadata = { ...(next.metadata || {}), receiveIdemKeys: Array.from(set).slice(-50) };
    }

    // Save PO
    const putRes = await ObjUpdate.handle(withTypeId(event, "purchaseOrder", id, next));
    if (putRes.statusCode !== 200) {
      return json(putRes.statusCode || 500, { where: "updatePO", body: putRes.body || null });
    }
    return putRes;
  } catch (e: any) {
    return json(500, { where: "po-receive:outer", err: String(e?.message || e) });
  }
}
