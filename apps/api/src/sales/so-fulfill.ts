// apps/api/src/sales/so-fulfill.ts
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import * as ObjGet from "../objects/get";
import * as ObjUpdate from "../objects/update";
import { upsertDelta, getOnHand } from "../inventory/counters";
import { getAuth, requirePerm } from "../auth/middleware";

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

const bodyOf = <T = any>(e: APIGatewayProxyEventV2) => (e.body ? (JSON.parse(e.body) as T) : ({} as any));
const header = (e: APIGatewayProxyEventV2, k: string) => e.headers?.[k] || e.headers?.[k.toLowerCase()];

const STRICT_COUNTERS = true; // fail the call if counters update fails

type FulfillLineReq = { lineId: string; deltaQty: number };
type FulfillReq = { idempotencyKey?: string; lines: FulfillLineReq[] };

export async function handle(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const id = event.pathParameters?.id || "";
  if (!id) return json(400, { message: "Missing id" });

  try {
    const auth = await getAuth(event);
    requirePerm(auth, "sales:fulfill");
    const tenantId = String(auth?.tenantId || "").trim();
    if (!tenantId) return json(400, { message: "tenantId missing (auth)" });

    const idemKey = header(event, "Idempotency-Key") || bodyOf<FulfillReq>(event).idempotencyKey;

    // Load SO
    const getRes = await ObjGet.handle(withTypeId(event, "salesOrder", id));
    if (getRes.statusCode !== 200 || !getRes.body) return json(getRes.statusCode || 500, { where: "getSO", body: getRes.body || null });
    const so = JSON.parse(getRes.body);

    // Guard invalid states
    if (String(so.status) === "cancelled" || String(so.status) === "closed") {
      return json(409, { message: `Cannot fulfill when status is ${so.status}` });
    }
    const st = String(so.status);
    if (st === "cancelled" || st === "closed") {
      return json(409, { message: `Cannot fulfill when status is ${st}` });
    }
    if (st === "fulfilled") {
      return json(200, { message: "already_fulfilled", id });
    }
    if (!["committed", "partially_fulfilled"].includes(st)) {
      return json(409, { message: `Cannot fulfill unless committed or partially_fulfilled (status=${st})` });
    }

    // Parse request
    const req = bodyOf<FulfillReq>(event);
    const reqLines = Array.isArray(req.lines) ? req.lines : [];
    if (reqLines.length === 0) return json(400, { message: "No lines to fulfill" });

    // Defensive copies
    const next = {
      ...so,
      lines: Array.isArray(so.lines) ? so.lines.map((l: any) => ({ ...l })) : [],
      metadata: { ...(so.metadata || {}) },
    };
    const reservedMap: Record<string, number> = { ...(next.metadata.reservedMap || {}) };

    // Apply each requested fulfillment
    for (const r of reqLines) {
      
      const idx = next.lines.findIndex((l: any) => String(l.id) === String(r.lineId));
      if (idx === -1) continue;

      const line = next.lines[idx];
      const itemId = String(line.itemId);
      const ordered   = Number(line.qty ?? 0);
      const fulfilled = Number(line.qtyFulfilled ?? 0);
      const reserved  = Math.max(0, Number(reservedMap[String(line.id)] ?? 0));

      // 👇 The key change:
      // 1) Take the user's requested qty as-is (non-negative).
      const requested = Math.max(0, Number(r.deltaQty ?? 0));
      if (requested <= 0) continue;

      // 2) Preflight against *physical on-hand* with the *requested* qty.
      const counters = await getOnHand(tenantId, itemId);
      if (counters.onHand < requested) {
        return json(409, {
          message: "insufficient_onhand_to_fulfill",
          itemId,
          need: requested,
          onHand: counters.onHand,
        });
      }

      // 3) Only after passing on-hand guard, clamp to remaining order qty to ship.
      const remainingOrder = Math.max(0, ordered - fulfilled);
      const deltaToShip = Math.min(requested, remainingOrder);
      if (deltaToShip <= 0) continue;

      // Consume reserved up to the shipped amount
      const reservedToConsume = Math.min(deltaToShip, reserved);

      try {
        await upsertDelta(tenantId, itemId, -deltaToShip, -reservedToConsume);
      } catch (e: any) {
        const code = (e?.code || "").toString();
        const name = (e?.name || "").toString();
        const isQty = code === "INSUFFICIENT_QTY" || name.includes("ConditionalCheckFailed");
        const msg = isQty ? "insufficient_onhand_to_fulfill" : "upsert_failed";
        if (STRICT_COUNTERS) {
          return json(isQty ? 409 : 500, {
            message: msg,
            itemId,
            deltas: { dOnHand: -deltaToShip, dReserved: -reservedToConsume },
            err: String(e?.message || e),
          });
        }
        console.error("upsertDelta(fulfill) failed", { itemId, err: e });
      }

      // Update SO state
      line.qtyFulfilled = fulfilled + deltaToShip;
      reservedMap[String(line.id)] = Math.max(0, reserved - reservedToConsume);
    }

    // Status transitions
    const anyFulfilled = next.lines.some((l: any) => Number(l.qtyFulfilled ?? 0) > 0);
    const allFulfilled =
      next.lines.length > 0 && next.lines.every((l: any) => Number(l.qtyFulfilled ?? 0) >= Number(l.qty ?? 0));
    if (allFulfilled) next.status = "fulfilled";
    else if (anyFulfilled) next.status = "partially_fulfilled";

    // Persist reservedMap back
    next.metadata.reservedMap = reservedMap;

    // Save SO
    const putRes = await ObjUpdate.handle(withTypeId(event, "salesOrder", id, next));
    if (putRes.statusCode !== 200) {
      return json(putRes.statusCode || 500, { where: "updateSO", body: putRes.body || null });
    }
    return putRes;
  } catch (e: any) {
    return json(500, { where: "so-fulfill:outer", err: String(e?.message || e) });
  }
}
