// apps/api/src/inventory/adjust.ts
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { getAuth, requirePerm } from "../auth/middleware";
import { createMovement } from "./movements";

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

    // Guard: require inventory:write permission (same bucket as adjust)
    requirePerm(auth, "inventory:write");

    const body = event.body ? JSON.parse(event.body) : {};
    const deltaQty = Number(body?.deltaQty ?? 0);
    const locationIdRaw = body?.locationId ?? body?.location;
    const locationId = locationIdRaw ? String(locationIdRaw).trim() : undefined;
    const lot = body?.lot ? String(body.lot).trim() : undefined;
    const note = body?.note ? String(body.note).trim() : undefined;

    // Validation
    if (!Number.isFinite(deltaQty) || deltaQty === 0) {
      return respond(400, { error: "BadRequest", message: "deltaQty must be a non-zero number" });
    }

    // Create the inventory movement using the shared writer
    const movement = await createMovement({
      tenantId: auth.tenantId,
      itemId: id,
      action: "adjust",
      qty: deltaQty,
      locationId: locationId || undefined,
      lot: lot || undefined,
      note: note || undefined,
    });

    return respond(200, {
      movementId: movement.id,
      movement: {
        id: movement.id,
        itemId: id,
        action: "adjust",
        qty: deltaQty,
        locationId: locationId || null,
        lot: lot || null,
        note: note || null,
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
    console.error("[inventory-adjust]", err);
    return respond(500, { error: "InternalServerError", message });
  }
}

export default { handle };
