// apps/api/src/sales/so-commit.ts
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import * as ObjGet from "../objects/get";
import * as ObjUpdate from "../objects/update";
import { upsertDelta } from "../inventory/counters";

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

const STRICT_COUNTERS = true; // set true to hard-fail if counters update fails

export async function handle(event: APIGatewayProxyEventV2) {
  const id = event.pathParameters?.id || "";
  if (!id) return json(400, { message: "Missing id" });

  try {
    // Load the SO
    const get = await ObjGet.handle(withTypeId(event, "salesOrder", id));
    if (get.statusCode !== 200 || !get.body) {
      return json(get.statusCode || 500, { where: "getSO", body: get.body || null, message: "Get SO failed" });
    }
    const so = JSON.parse(get.body);

    // Guard invalid states
    if (so.status === "cancelled" || so.status === "closed") {
      return json(409, { message: `Cannot commit when status is ${so.status}` });
    }

    // Work on a copy
    const next = {
      ...so,
      lines: Array.isArray(so.lines) ? so.lines.map((l: any) => ({ ...l })) : [],
    };
    const reservedMap: Record<string, number> = { ...(so.metadata?.reservedMap || {}) };

    // Reserve remaining quantities per line
    for (const line of next.lines) {
      const lineId = String(line.id);
      const ordered = Number(line.qty ?? 0);
      const fulfilled = Number(line.qtyFulfilled ?? 0);
      const alreadyReserved = Math.max(0, Number(reservedMap[lineId] ?? 0));
      const remainingToReserve = Math.max(0, ordered - fulfilled - alreadyReserved);
      if (remainingToReserve <= 0) continue;

      reservedMap[lineId] = alreadyReserved + remainingToReserve;

      // counters: reserved += remainingToReserve
      try {
        await upsertDelta(event, String(line.itemId), 0, remainingToReserve);
      } catch (e: any) {
        if (STRICT_COUNTERS) {
          return json(500, {
            where: "upsertDelta(commit)",
            itemId: String(line.itemId),
            err: String(e?.message || e),
          });
        }
        console.error("upsertDelta(commit) failed", { itemId: String(line.itemId), err: e });
      }
    }

    next.status = "committed";
    next.metadata = { ...(next.metadata || {}), reservedMap };

    // Persist
    const put = await ObjUpdate.handle(withTypeId(event, "salesOrder", id, next));
    if (put.statusCode !== 200) {
      return json(put.statusCode || 500, { where: "updateSO", body: put.body || null });
    }
    return put;
  } catch (e: any) {
    return json(500, { where: "so-commit:outer", err: String(e?.message || e) });
  }
}
