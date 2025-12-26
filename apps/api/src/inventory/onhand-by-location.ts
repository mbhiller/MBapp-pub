// apps/api/src/inventory/onhand-by-location.ts
import { listMovementsByItem } from "./movements";
import { deriveCountersByLocation } from "./counters";
import { resolveTenantId } from "../common/tenant";

function respond(status: number, body: unknown) {
  return { statusCode: status, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

/** HTTP handler — GET /inventory/{id}/onhand:by-location */
export async function handle(event: any) {
  const id: string | undefined = event?.pathParameters?.id;
  if (!id) return respond(400, { error: "BadRequest", message: "Missing id" });

  let tenantId: string;
  try {
    tenantId = resolveTenantId(event);
  } catch (err: any) {
    const status = err?.statusCode ?? 400;
    return respond(status, { error: err?.code ?? "TenantError", message: err?.message ?? "Tenant resolution failed" });
  }

  // Fetch movements for the item (use high limit to get comprehensive view)
  const { items: movs } = await listMovementsByItem(tenantId, id, { limit: 10000, sort: "desc" });
  
  // Derive counters grouped by location
  const locationCounters = deriveCountersByLocation(movs);
  
  const asOf = new Date().toISOString();
  
  // Format response: add itemId and asOf to each location's counters
  const items = locationCounters.map((lc) => ({
    itemId: id,
    locationId: lc.locationId,
    onHand: lc.onHand,
    reserved: lc.reserved,
    available: lc.available,
    asOf,
  }));

  return respond(200, { items });
}

export default { handle };
