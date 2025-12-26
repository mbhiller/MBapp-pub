// apps/api/src/inventory/putaway.ts
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

    // Guard: require inventory:write permission (or fall back to objects:write)
    try {
      requirePerm(auth, "inventory:write");
    } catch {
      try {
        requirePerm(auth, "objects:write");
      } catch (e) {
        throw e;
      }
    }

    const body = event.body ? JSON.parse(event.body) : {};
    const qty = Number(body?.qty ?? 0);
    const toLocationId = String(body?.toLocationId ?? "").trim();
    const fromLocationId = String(body?.fromLocationId ?? "").trim();
    const lot = body?.lot ? String(body.lot).trim() : undefined;
    const note = body?.note ? String(body.note).trim() : undefined;

    // Validation
    if (!Number.isFinite(qty) || qty <= 0) {
      return respond(400, { error: "BadRequest", message: "qty must be a positive number" });
    }
    if (!toLocationId) {
      return respond(400, { error: "BadRequest", message: "toLocationId is required and must be non-empty" });
    }

    // Build note that includes fromLocationId if provided
    let movementNote = note || "";
    if (fromLocationId) {
      movementNote = fromLocationId ? `from=${fromLocationId}; ${movementNote}`.trim() : movementNote;
    }

    // Create the inventory movement using the shared writer
    const movement = await createMovement({
      tenantId: auth.tenantId,
      itemId: id,
      action: "putaway",
      qty,
      locationId: toLocationId,
      lot: lot || undefined,
      note: movementNote || undefined,
    });

    // Return the created movement
    return respond(200, {
      id: movement.id,
      itemId: id,
      action: "putaway",
      qty,
      locationId: toLocationId,
      lot: lot || null,
      note: movementNote || null,
      at: movement.at,
      createdAt: movement.createdAt,
    });
  } catch (err: any) {
    const statusCode = err?.statusCode ?? 500;
    const message = err?.message ?? "Internal Server Error";
    if (statusCode === 401) return respond(401, { error: "Unauthorized", message });
    if (statusCode === 403) return respond(403, { error: "Forbidden", message });
    if (statusCode === 400) return respond(400, { error: "BadRequest", message });
    console.error("[putaway]", err);
    return respond(500, { error: "InternalServerError", message });
  }
}

export default { handle };
