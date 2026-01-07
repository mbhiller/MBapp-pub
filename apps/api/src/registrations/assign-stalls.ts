// apps/api/src/registrations/assign-stalls.ts
/**
 * POST /registrations/{id}:assign-stalls
 * Operator action to assign specific stalls to a registration (Sprint BK).
 * Converts block stall hold into per-stall granular holds.
 */

import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ok, badRequest, conflictError, error as respondError, notFound } from "../common/responses";
import { getTenantId } from "../common/env";
import { getObjectById } from "../objects/repo";
import { guardRegistrations } from "./feature";
import { assignStallsToRegistration } from "../reservations/holds";

export async function handle(event: APIGatewayProxyEventV2) {
  try {
    const guard = guardRegistrations(event);
    if (guard) return guard;

    const tenantId = getTenantId(event);
    const id = event.pathParameters?.id || "";
    if (!id) return badRequest("Missing registration id", { field: "id" });

    // Parse request body
    let body: any;
    try {
      body = event.body ? JSON.parse(typeof event.body === "string" ? event.body : JSON.stringify(event.body)) : {};
    } catch (e) {
      return badRequest("Invalid request body", { code: "invalid_json" });
    }

    const stallIds = body.stallIds;
    if (!Array.isArray(stallIds) || stallIds.length === 0) {
      return badRequest("stallIds must be a non-empty array", { field: "stallIds" });
    }

    // Validate all items are strings
    if (!stallIds.every((id: unknown) => typeof id === "string")) {
      return badRequest("stallIds must contain only strings", { field: "stallIds" });
    }

    // Load registration to get eventId
    const reg = await getObjectById({ tenantId, type: "registration", id });
    if (!reg) {
      return notFound("Registration not found");
    }

    const eventId = (reg as any)?.eventId as string | undefined;
    if (!eventId) {
      return badRequest("Registration has no eventId", { code: "missing_event_id" });
    }

    // Assign stalls (validates block hold, stall resources, etc.)
    const createdHolds = await assignStallsToRegistration({
      tenantId,
      registrationId: id,
      eventId,
      stallIds,
    });

    // Return created holds (safe response: id, state, resourceId only)
    // Filter to only per-resource holds (exclude released block hold for backward compatibility)
    const perResourceHolds = createdHolds.filter((h: any) => h.resourceId);
    const safeHolds = perResourceHolds.map((h: any) => ({
      id: h.id,
      state: h.state,
      resourceId: h.resourceId,
      qty: h.qty,
    }));

    return ok({
      holds: safeHolds,
      count: safeHolds.length,
    });
  } catch (err: any) {
    if (err?.statusCode && err?.code) {
      if (err.statusCode === 409 && err.code === "stall_already_assigned") {
        return conflictError(err.message || "Stall already assigned", { code: "stall_already_assigned" });
      }
      if (err.statusCode === 400) {
        return badRequest(err.message || "Bad Request", { code: err.code });
      }
      if (err.statusCode === 404) {
        return notFound(err.message || "Not Found");
      }
      if (err.statusCode === 409) {
        return conflictError(err.message || "Conflict", { code: err.code });
      }
    }
    return respondError(err);
  }
}
