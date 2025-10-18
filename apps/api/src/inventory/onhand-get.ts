// apps/api/src/inventory/onhand-get.ts
import { listMovementsByItem } from "./movements";
import { deriveCounters } from "./counters";

function respond(status: number, body: unknown) {
  return { statusCode: status, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}
function getTenantId(event: any): string {
  const h = event?.headers || {};
  return h["X-Tenant-Id"] || h["x-tenant-id"] || h["X-tenant-id"] || h["x-Tenant-Id"] || "DemoTenant";
}

/** HTTP handler — GET /inventory/{id}/onhand */
export async function handle(event: any) {
  const id: string | undefined = event?.pathParameters?.id;
  if (!id) return respond(400, { error: "BadRequest", message: "Missing id" });

  const tenantId = getTenantId(event);
  const { items: movs } = await listMovementsByItem(tenantId, id, { limit: 1000, sort: "desc" });
  const c = deriveCounters(movs);
  return respond(200, { items: [ { itemId: id, ...c, asOf: new Date().toISOString() } ] });
}

export default { handle };
