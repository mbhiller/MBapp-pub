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
    // ✅ Use same auth source as objects/update.ts
    const auth = await getAuth(event);
    const tenantId = String(auth?.tenantId || "");
    if (!tenantId) return json(400, { message: "tenantId missing (auth)" });

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

    // ---------- Preflight availability (return 409 w/ shortages) ----------
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

    const shortages: Array<{ itemId: string; need: number; available: number }> = [];
    for (const [itemId, need] of Object.entries(needByItem)) {
      const counters = await getOnHand(tenantId, itemId);
      if (counters.available < need) shortages.push({ itemId, need, available: counters.available });
    }
    if (shortages.length) {
      return json(409, { message: "insufficient_available_to_commit", shortages });
    }

    // ---------- Reserve per line under counters ----------
    for (const line of lines) {
      const lineId = String(line.id);
      const ordered = Number(line.qty ?? 0);
      const fulfilled = Number(line.qtyFulfilled ?? 0);
      const alreadyReserved = Math.max(0, Number(reservedMap[lineId] ?? 0));
      const remainingToReserve = Math.max(0, ordered - fulfilled - alreadyReserved);
      if (remainingToReserve <= 0) continue;

      try {
        await upsertDelta(tenantId, String(line.itemId), 0, remainingToReserve);
      } catch (e: any) {
        const code = (e?.code || "").toString();
        const name = (e?.name || "").toString();
        const isQty = code === "INSUFFICIENT_QTY" || name.includes("ConditionalCheckFailed");
        return json(isQty ? 409 : 500, {
          message: isQty ? "insufficient_available_to_commit" : "reserve_failed",
          where: "upsertDelta(commit)",
          itemId: String(line.itemId),
          err: String(e?.message || e),
        });
      }

      reservedMap[lineId] = alreadyReserved + remainingToReserve;
    }

    let nextStatus = String(so.status);
    if (nextStatus === "draft" || nextStatus === "submitted") nextStatus = "committed";
    // stay partially_fulfilled if it already is
    const next = { ...so, status: nextStatus, metadata: { ...(so.metadata || {}), reservedMap } };
    
    const put = await ObjUpdate.handle(withTypeId(event, "salesOrder", id, next));
    if (put.statusCode !== 200) return put;
    return put;
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
