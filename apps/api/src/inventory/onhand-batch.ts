// apps/api/src/inventory/onhand-batch.ts
import { computeOnhandForItem } from "./onhand-helpers";
import { resolveTenantId } from "../common/tenant";

function respond(status: number, body: unknown) {
  return { statusCode: status, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

/** HTTP handler — POST /inventory/onhand:batch */
export async function handle(event: any) {
  let body: any = {};
  try { body = JSON.parse(event?.body || "{}"); } catch {}
  const itemIds: string[] = Array.isArray(body?.itemIds) ? body.itemIds : [];
  if (itemIds.length === 0) return respond(400, { error: "BadRequest", message: "itemIds required" });

  let tenantId: string;
  try {
    tenantId = resolveTenantId(event);
  } catch (err: any) {
    const status = err?.statusCode ?? 400;
    return respond(status, { error: err?.code ?? "TenantError", message: err?.message ?? "Tenant resolution failed" });
  }

  // Compute on-hand for each item using shared helper (base table query, ConsistentRead: true)
  const items = await Promise.all(
    itemIds.map(id => computeOnhandForItem(tenantId, id))
  );

  return respond(200, { items });
}

export default { handle };
