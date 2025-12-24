// apps/api/src/inventory/onhand-get.ts
import { listMovementsByItem } from "./movements";
import { deriveCounters } from "./counters";
import { resolveTenantId } from "../common/tenant";

function respond(status: number, body: unknown) {
  return { statusCode: status, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}
// Authenticated route: resolve tenant via authorizer, validate header mismatch

/** HTTP handler — GET /inventory/{id}/onhand */
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

  const { items: movs } = await listMovementsByItem(tenantId, id, { limit: 1000, sort: "desc" });
  const c = deriveCounters(movs);
  return respond(200, { items: [ { itemId: id, ...c, asOf: new Date().toISOString() } ] });
}

export default { handle };
