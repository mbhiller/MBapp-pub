// apps/api/src/inventory/onhand-get.ts
import { computeOnhandForItem } from "./onhand-helpers";
import { resolveTenantId } from "../common/tenant";

function respond(status: number, body: unknown) {
  return { statusCode: status, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

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

  // Compute on-hand using shared helper (base table query, ConsistentRead: true)
  const result = await computeOnhandForItem(tenantId, id);
  return respond(200, { items: [result] });
}

export default { handle };
