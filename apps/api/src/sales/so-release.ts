// apps/api/src/sales/so-release.ts
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import * as ObjGet from "../objects/get";
import * as ObjUpdate from "../objects/update";
import { getAuth } from "../auth/middleware";
import { getOnHand, upsertDelta } from "../inventory/counters";

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

type LineDelta = { lineId: string; deltaQty: number };

export async function handle(event: APIGatewayProxyEventV2) {
  const id = event.pathParameters?.id || "";
  if (!id) return json(400, { message: "Missing id" });

  try {
    const auth = await getAuth(event);
    const tenantId = String(auth?.tenantId || "");
    if (!tenantId) return json(400, { message: "tenantId missing (auth)" });

    const body = (() => {
      try { return typeof event.body === "string" ? JSON.parse(event.body) : (event.body || {}); }
      catch { return {}; }
    })();

    const linesArg: LineDelta[] = Array.isArray(body?.lines) ? body.lines : [];
    if (!linesArg.length) return json(400, { message: "lines required", example: { lines: [{ lineId: "L1", deltaQty: 1 }] } });

    const g = await ObjGet.handle(withTypeId(event, "salesOrder", id));
    if (g.statusCode !== 200 || !g.body) return g;
    const so = JSON.parse(g.body);

    const status = String(so.status);
    if (!["submitted", "committed", "partially_fulfilled", "fulfilled"].includes(status)) {
      return json(409, { message: `Cannot release when status is ${status}` });
    }
    if (status === "fulfilled") {
      return json(200, { message: "already_fulfilled", id });
    }

    const lineById: Record<string, any> = {};
    for (const l of so.lines || []) lineById[String(l.id)] = l;

    const reservedMap: Record<string, number> = { ...(so.metadata?.reservedMap || {}) };
    const applied: Array<{ lineId: string; requested: number; released: number }> = [];

    // Validate and apply releases
    for (const { lineId, deltaQty } of linesArg) {
      const req = Number(deltaQty || 0);
      if (!lineId || !Number.isFinite(req) || req <= 0) {
        return json(400, { message: "deltaQty must be > 0", lineId, deltaQty });
      }
      const line = lineById[lineId];
      if (!line) return json(404, { message: "line_not_found", lineId });

      const itemId = String(line.itemId);
      const reservedNow = Math.max(0, Number(reservedMap[lineId] ?? 0));
      if (reservedNow <= 0) {
        applied.push({ lineId, requested: req, released: 0 });
        continue;
      }
      const canRelease = Math.min(reservedNow, req);

      // Release = decrease reserved (upsertDelta with negative reserve delta)
      await upsertDelta(tenantId, itemId, 0, -canRelease);

      reservedMap[lineId] = reservedNow - canRelease;
      applied.push({ lineId, requested: req, released: canRelease });
    }

    // Compute next status (don’t regress below submitted)
    const stillReserved = Object.values(reservedMap).some(v => (v || 0) > 0);
    let nextStatus = status;
    if (status === "committed" && !stillReserved) nextStatus = "submitted";
    if (status === "partially_fulfilled" && !stillReserved) nextStatus = "partially_fulfilled"; // may remain if some fulfilled happened

    const next = {
      ...so,
      status: nextStatus,
      metadata: { ...(so.metadata || {}), reservedMap, lastRelease: applied },
    };

    const put = await ObjUpdate.handle(withTypeId(event, "salesOrder", id, next));
    if (put.statusCode !== 200) return put;
    try {
      const body = JSON.parse(String(put.body || "{}"));
      return json(200, { ...body, metadata: next.metadata });
    } catch {
      return put;
    }
  } catch (e: any) {
    const msg = String(e?.message || e);
    return json(500, { message: "so-release:error", err: msg });
  }
}
