// POST /sales/so/{id}:reserve
// Body: { lines: [{ lineId: string, deltaQty: number }] }
// Header: Idempotency-Key (optional)
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import * as ObjGet from "../objects/get";
import * as ObjUpdate from "../objects/update";
import { getOnHand, upsertDelta } from "../inventory/counters";
import { getAuth, requirePerm } from "../auth/middleware";

const json = (c: number, b: unknown): APIGatewayProxyResultV2 => ({
  statusCode: c, headers: { "content-type": "application/json" }, body: JSON.stringify(b),
});

const bodyOf = <T = any>(e: APIGatewayProxyEventV2) => (e.body ? (JSON.parse(e.body) as T) : ({} as any));
const header = (e: APIGatewayProxyEventV2, k: string) => e.headers?.[k] || e.headers?.[k.toLowerCase()];

type ReserveLine = { lineId: string; deltaQty: number };
type ReserveReq  = { idempotencyKey?: string; lines?: ReserveLine[]; strict?: boolean };

export async function handle(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const id = event.pathParameters?.id || "";
  if (!id) return json(400, { message: "Missing id" });

  try {
    const auth = await getAuth(event);
    requirePerm(auth, "sales:reserve");
    const tenantId = String(auth?.tenantId || "").trim();
    if (!tenantId) return json(400, { message: "tenantId missing (auth)" });

    // Load order
    const getRes = await ObjGet.handle(withTypeId(event, "salesOrder", id));
    if (getRes.statusCode !== 200 || !getRes.body) {
      return json(getRes.statusCode || 500, { where: "getSO", body: getRes.body || null });
    }
    const so = JSON.parse(getRes.body);

    const st = String(so.status);
    if (st === "cancelled" || st === "closed" || st === "fulfilled") {
      return json(409, { message: `Cannot reserve when status is ${st}` });
    }

    const req = bodyOf<ReserveReq>(event);
    const reqLines = Array.isArray(req.lines) ? req.lines : [];
    if (reqLines.length === 0) return json(400, { message: "No lines to reserve" });

    const next = {
      ...so,
      lines: Array.isArray(so.lines) ? so.lines.map((l: any) => ({ ...l })) : [],
      metadata: { ...(so.metadata || {}) },
    };
    const reservedMap: Record<string, number> = { ...(next.metadata.reservedMap || {}) };
    const results: Array<{ lineId: string; requested: number; applied: number; reason?: string }> = [];

    for (const r of reqLines) {
      const idx = next.lines.findIndex((l: any) => String(l.id) === String(r.lineId));
      if (idx === -1) { results.push({ lineId: r.lineId, requested: Number(r.deltaQty||0), applied: 0, reason: "line_not_found" }); continue; }

      const line = next.lines[idx];
      const itemId    = String(line.itemId);
      const ordered   = Number(line.qty ?? 0);
      const fulfilled = Number(line.qtyFulfilled ?? 0);
      const already   = Math.max(0, Number(reservedMap[String(line.id)] ?? 0));

      const requested = Math.max(0, Number(r.deltaQty ?? 0));
      if (requested <= 0) { results.push({ lineId: line.id, requested, applied: 0, reason: "non_positive_request" }); continue; }

      const remainingToShip = Math.max(0, ordered - fulfilled);
      const maxReservable = Math.max(0, remainingToShip - already);

      // Strict mode: reject over-request
      if (req.strict && requested > maxReservable) {
        return json(409, { message: "exceeds_remaining_to_ship", lineId: line.id, requested, remaining: maxReservable });
      }

      // Apply at most what remains
      const deltaToReserve = Math.min(requested, maxReservable);

      if (deltaToReserve <= 0) {
        results.push({ lineId: line.id, requested, applied: 0, reason: "no_remaining" });
        continue;
      }

      // Guard: inventory availability
      const counters = await getOnHand(tenantId, itemId);
      if ((counters.onHand ?? 0) < deltaToReserve) {
        return json(409, { message: "insufficient_onhand_to_reserve", itemId, need: deltaToReserve, onHand: counters.onHand ?? 0 });
      }

      try {
        await upsertDelta(tenantId, itemId, 0, +deltaToReserve);
      } catch (e: any) {
        return json(409, { message: "reserve_guard", itemId, err: String(e?.message || e) });
      }

      reservedMap[String(line.id)] = already + deltaToReserve;
      results.push({ lineId: line.id, requested, applied: deltaToReserve, ...(deltaToReserve < requested ? { reason: "clamped" } : {}) });
    }

    next.metadata.reservedMap = reservedMap;
    next.metadata.lastReserve = results;

    const putRes = await ObjUpdate.handle(withTypeId(event, "salesOrder", id, next));
    if (putRes.statusCode !== 200) return json(putRes.statusCode || 500, { where: "updateSO", body: putRes.body || null });

    // return the updated SO document so existing clients keep working
    return putRes;
  } catch (e: any) {
    return json(500, { where: "so-reserve:outer", err: String(e?.message || e) });
  }
}

function withTypeId(e: any, type: string, id?: string, body?: any) {
  const out: any = { ...e };
  out.queryStringParameters = { ...(e.queryStringParameters || {}), type };
  out.pathParameters = { ...(e.pathParameters || {}), type, ...(id ? { id } : {}) };
  if (body !== undefined) out.body = JSON.stringify(body);
  return out;
}
