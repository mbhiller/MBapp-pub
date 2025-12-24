// apps/api/src/inventory/onhand-batch.ts
import { listMovementsByItem } from "./movements";
import { deriveCounters } from "./counters";

function respond(status: number, body: unknown) {
  return { statusCode: status, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}
  import { resolveTenantId } from "../common/tenant";
  function getTenantId(event: any): string {
    return resolveTenantId(event);
  }

/** HTTP handler — POST /inventory/onhand:batch */
export async function handle(event: any) {
  let body: any = {};
  try { body = JSON.parse(event?.body || "{}"); } catch {}
  const itemIds: string[] = Array.isArray(body?.itemIds) ? body.itemIds : [];
  if (itemIds.length === 0) return respond(400, { error: "BadRequest", message: "itemIds required" });

  const tenantId = getTenantId(event);

  const items = await Promise.all(itemIds.map(async (id) => {
    const { items: movs } = await listMovementsByItem(tenantId, id, { limit: 1000, sort: "desc" });
    const c = deriveCounters(movs);
    return { itemId: id, ...c, asOf: new Date().toISOString() };
  }));

  return respond(200, { items });
}

export default { handle };
