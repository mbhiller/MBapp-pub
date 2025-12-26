// apps/api/src/inventory/cycle-count.ts
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { getAuth, requirePerm } from "../auth/middleware";
import { listMovementsByItem } from "./movements";
import { createMovement } from "./movements";
import { deriveCounters } from "./counters";
import { resolveTenantId } from "../common/tenant";

function respond(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

export async function handle(event: APIGatewayProxyEventV2) {
  try {
    const auth = await getAuth(event);
    const id = event.pathParameters?.id;

    if (!id) return respond(400, { error: "BadRequest", message: "Missing inventory item id" });

    // Guard: require inventory:adjust (or fall back to inventory:write)
    try {
      requirePerm(auth, "inventory:adjust");
    } catch {
      try {
        requirePerm(auth, "inventory:write");
      } catch (e) {
        throw e;
      }
    }

    const body = event.body ? JSON.parse(event.body) : {};
    const countedQty = Number(body?.countedQty ?? 0);
    const locationId = body?.locationId ? String(body.locationId).trim() : undefined;
    const lot = body?.lot ? String(body.lot).trim() : undefined;
    const note = body?.note ? String(body.note).trim() : undefined;

    // Validation
    if (!Number.isFinite(countedQty) || countedQty < 0) {
      return respond(400, { error: "BadRequest", message: "countedQty must be a non-negative number" });
    }

    const tenantId = resolveTenantId(event);

    // Fetch current onHand via movements
    const movementsPage = await listMovementsByItem(tenantId, id, { limit: 1000 });
    const movements = movementsPage.items;
    const counters = deriveCounters(movements);
    const currentOnHand = counters.onHand;

    // Compute delta
    const delta = countedQty - currentOnHand;

    // If no change, return early without writing
    if (delta === 0) {
      return respond(200, {
        ok: true,
        delta: 0,
        message: "no change",
        priorOnHand: currentOnHand,
        countedQty,
      });
    }

    // Build audit note with countedQty, priorOnHand, delta
    let auditNote = `counted=${countedQty} prior=${currentOnHand} delta=${delta}`;
    if (note) {
      auditNote = `${auditNote}; ${note}`;
    }

    // Create the inventory movement using the shared writer
    const movement = await createMovement({
      tenantId,
      itemId: id,
      action: "cycle_count",
      qty: delta,
      locationId: locationId || undefined,
      lot: lot || undefined,
      note: auditNote,
    });

    // Return summary + created movement details
    return respond(200, {
      priorOnHand: currentOnHand,
      countedQty,
      delta,
      movementId: movement.id,
      movement: {
        id: movement.id,
        itemId: id,
        action: "cycle_count",
        qty: delta,
        locationId: locationId || null,
        lot: lot || null,
        note: auditNote,
        at: movement.at,
        createdAt: movement.createdAt,
      },
    });
  } catch (err: any) {
    const statusCode = err?.statusCode ?? 500;
    const message = err?.message ?? "Internal Server Error";
    if (statusCode === 401) return respond(401, { error: "Unauthorized", message });
    if (statusCode === 403) return respond(403, { error: "Forbidden", message });
    if (statusCode === 400) return respond(400, { error: "BadRequest", message });
    console.error("[cycle-count]", err);
    return respond(500, { error: "InternalServerError", message });
  }
}

export default { handle };
