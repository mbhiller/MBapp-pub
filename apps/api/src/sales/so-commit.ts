// apps/api/src/sales/so-commit.ts
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import * as ObjGet from "../objects/get";
import * as ObjUpdate from "../objects/update";
import { upsertDelta, getOnHand } from "../inventory/counters";
import { getAuth } from "../auth/middleware";

const json = (c: number, b: unknown) => ({
  statusCode: c,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(b),
});

const withTypeId = (e: any, t: string, id: string, body?: any) => {
  const out: any = { ...e };
  out.queryStringParameters = { ...(e.queryStringParameters || {}), type: t };
  out.pathParameters = { ...(e.pathParameters || {}), type: t, id };
  if (body !== undefined) out.body = JSON.stringify(body);
  return out;
};

export async function handle(event: APIGatewayProxyEventV2) {
  const id = event.pathParameters?.id || "";
  if (!id) return json(400, { message: "Missing id" });

  try {
    // Auth / tenant
    const auth = await getAuth(event);
    const tenantId = String(auth?.tenantId || "");
    if (!tenantId) return json(400, { message: "tenantId missing (auth)" });

    // Parse strict from query/body
    const strict =
      String(event.queryStringParameters?.strict ?? "").trim() === "1" ||
      (() => {
        try {
          const b: any = typeof event.body === "string" ? JSON.parse(event.body) : event.body;
          return !!(b?.strict);
        } catch {
          return false;
        }
      })();

    // Load SO
    const g = await ObjGet.handle(withTypeId(event, "salesOrder", id));
    if (g.statusCode !== 200 || !g.body) return g;
    const so = JSON.parse(g.body);

    const st = String(so.status);
    // Hard stops
    if (st === "cancelled" || st === "closed") {
      return json(409, { message: `Cannot commit when status is ${so.status}` });
    }
    // Idempotent no-op when fully done
    if (st === "fulfilled") {
      return json(200, { message: "already_fulfilled", id });
    }
    // Allow: draft, submitted, committed (idempotent), partially_fulfilled (top-up)
    if (!["draft", "submitted", "committed", "partially_fulfilled"].includes(st)) {
      return json(409, { message: `Cannot commit when status is ${so.status}` });
    }

    const lines = Array.isArray(so.lines) ? so.lines : [];
    const reservedMap: Record<string, number> = { ...(so.metadata?.reservedMap || {}) };

    // ---------- Preflight availability ----------
    const needByItem: Record<string, number> = {};
    for (const line of lines) {
      const lineId = String(line.id);
      const ordered = Number(line.qty ?? 0);
      const fulfilled = Number(line.qtyFulfilled ?? 0);
      const alreadyReserved = Math.max(0, Number(reservedMap[lineId] ?? 0));
      const remaining = Math.max(0, ordered - fulfilled - alreadyReserved);
      if (remaining > 0) {
        const itemId = String(line.itemId);
        needByItem[itemId] = (needByItem[itemId] || 0) + remaining;
      }
    }

    // Fetch availability & compute shortages; also keep a mutable availableLeft
    const shortages: Array<{ itemId: string; need: number; available: number }> = [];
    const availableLeft: Record<string, number> = {};
    for (const [itemId, need] of Object.entries(needByItem)) {
      const counters = await getOnHand(tenantId, itemId);
      const avail = Number(counters.available ?? 0);
      availableLeft[itemId] = avail;
      if (avail < need) shortages.push({ itemId, need, available: avail });
    }

    // Strict mode: reject on shortage (legacy behavior)
    if (shortages.length && strict) {
      return json(409, { message: "insufficient_available_to_commit", shortages });
    }

    // ---------- Reserve per line (partial OK in non-strict) ----------
    for (const line of lines) {
      const lineId = String(line.id);
      const itemId = String(line.itemId);
      const ordered = Number(line.qty ?? 0);
      const fulfilled = Number(line.qtyFulfilled ?? 0);
      const alreadyReserved = Math.max(0, Number(reservedMap[lineId] ?? 0));

      // Remaining units needed for this line
      const remainingToReserve = Math.max(0, ordered - fulfilled - alreadyReserved);
      if (remainingToReserve <= 0) continue;

      // Cap by what’s available (tracked across lines)
      const canReserve = Math.min(remainingToReserve, Math.max(0, Number(availableLeft[itemId] ?? 0)));
      if (canReserve <= 0) continue;

      try {
        await upsertDelta(tenantId, itemId, 0, canReserve);
      } catch (e: any) {
        const code = (e?.code || "").toString();
        const name = (e?.name || "").toString();
        const isQty = code === "INSUFFICIENT_QTY" || name.includes("ConditionalCheckFailed");
        // If a race reduced availability, surface 409; caller can retry.
        return json(isQty ? 409 : 500, {
          message: isQty ? "insufficient_available_to_commit" : "reserve_failed",
          where: "upsertDelta(commit)",
          itemId,
          err: String(e?.message || e),
        });
      }

      reservedMap[lineId] = alreadyReserved + canReserve;
      availableLeft[itemId] = Math.max(0, (availableLeft[itemId] ?? 0) - canReserve);
    }

    // Compute backorders by line (optional metadata, non-breaking)
    const backorders: Record<string, number> = {};
    for (const line of lines) {
      const lineId = String(line.id);
      const ordered = Number(line.qty ?? 0);
      const fulfilled = Number(line.qtyFulfilled ?? 0);
      const reservedNow = Math.max(0, Number(reservedMap[lineId] ?? 0));
      const remaining = Math.max(0, ordered - fulfilled - reservedNow);
      if (remaining > 0) backorders[lineId] = remaining;
    }

    // Next SO status
    let nextStatus = String(so.status);
    if (nextStatus === "draft" || nextStatus === "submitted") nextStatus = "committed";

    const next = {
      ...so,
      status: nextStatus,
      metadata: {
        ...(so.metadata || {}),
        reservedMap,
        ...(Object.keys(backorders).length ? { hasBackorder: true, backorders } : {}),
      },
    };

    const put = await ObjUpdate.handle(withTypeId(event, "salesOrder", id, next));
    if (put.statusCode !== 200) return put;

    // Include shortages in 200 body (for client awareness) when non-strict
    try {
      const body = JSON.parse(String(put.body || "{}"));
      if (shortages.length) {
        // If you prefer line-level: convert here using backorders map
        const lineShortages = Object.entries(backorders).map(
          ([lineId, backordered]: [string, number]) => {
            const found = (lines as Array<{ id: string | number; itemId: string }>)
              .find((ln) => String(ln.id) === lineId);
            return {
              lineId,
              backordered,
              itemId: String(found?.itemId ?? ""),
            };
          }
        );

        return json(200, { ...body, shortages: lineShortages.length ? lineShortages : shortages });
      }
      return put;
    } catch {
      if (shortages.length) return json(200, { shortages });
      return put;
    }
  } catch (e: any) {
    const code = (e?.code || "").toString();
    const name = (e?.name || "").toString();
    const isQty = code === "INSUFFICIENT_QTY" || name.includes("ConditionalCheckFailed");
    return json(isQty ? 409 : 500, {
      message: isQty ? "insufficient_available_to_commit" : "so-commit:outer",
      err: String(e?.message || e),
    });
  }
}
