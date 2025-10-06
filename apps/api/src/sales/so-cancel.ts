import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import * as ObjGet from "../objects/get";
import * as ObjUpdate from "../objects/update";
import { upsertDelta } from "../inventory/counters";
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

export async function handle(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const id = event.pathParameters?.id || "";
  if (!id) return json(400, { message: "Missing id" });

  try {
    const auth = await getAuth(event);
    requirePerm(auth, "sales:cancel");
    const tenantId = String(auth?.tenantId || "").trim();
    if (!tenantId) return json(400, { message: "tenantId missing (auth)" });

    // Load SO
    const getRes = await ObjGet.handle(withTypeId(event, "salesOrder", id));
    if (getRes.statusCode !== 200 || !getRes.body) return json(getRes.statusCode || 500, { where: "getSO", body: getRes.body || null });
    const so = JSON.parse(getRes.body);

    if (String(so.status) === "closed")  return json(409, { message: "Cannot cancel a closed order" });
    if (String(so.status) === "cancelled") return json(200, so); // idempotent

    const next = {
      ...so,
      metadata: { ...(so.metadata || {}) },
    };
    const reservedMap: Record<string, number> = { ...(next.metadata.reservedMap || {}) };

    // Release any remaining reserved per line
    for (const line of Array.isArray(next.lines) ? next.lines : []) {
      const lineId = String(line.id);
      const itemId = String(line.itemId);
      const reserved = Math.max(0, Number(reservedMap[lineId] ?? 0));
      if (reserved > 0) {
        try {
          await upsertDelta(tenantId, itemId, 0, -reserved);
        } catch (e: any) {
          return json(500, {
            message: "release_reserved_failed",
            where: "upsertDelta(cancel)",
            itemId,
            reserved,
            err: String(e?.message || e),
          });
        }
        reservedMap[lineId] = 0;
      }
    }

    next.metadata.reservedMap = reservedMap;
    next.status = "cancelled";

    const putRes = await ObjUpdate.handle(withTypeId(event, "salesOrder", id, next));
    if (putRes.statusCode !== 200) return json(putRes.statusCode || 500, { where: "updateSO", body: putRes.body || null });
    return putRes;
  } catch (e: any) {
    return json(500, { where: "so-cancel:outer", err: String(e?.message || e) });
  }
}
