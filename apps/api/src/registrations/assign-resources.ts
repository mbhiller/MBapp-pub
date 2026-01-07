/**
 * POST /registrations/{id}:assign-resources
 * Generalized operator action to assign specific discrete resources (stalls, RV sites, etc.) to a registration.
 * Converts block resource hold (itemType per type, resourceId=null) into specific granular assignments (Sprint BM).
 */

import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ok, badRequest, conflictError, error as respondError, notFound } from "../common/responses";
import { getTenantId } from "../common/env";
import { getObjectById } from "../objects/repo";
import { guardRegistrations } from "./feature";
import { assignResourcesToRegistration } from "../reservations/holds";

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

    const itemType = body.itemType;
    const resourceIds = body.resourceIds;

    // Validate itemType
    const supportedTypes = ["stall", "rv"];
    if (!itemType || !supportedTypes.includes(itemType)) {
      return badRequest(`itemType must be one of: ${supportedTypes.join(", ")}`, { field: "itemType" });
    }

    // Validate resourceIds
    if (!Array.isArray(resourceIds) || resourceIds.length === 0) {
      return badRequest("resourceIds must be a non-empty array", { field: "resourceIds" });
    }

    // Validate all items are strings
    if (!resourceIds.every((id: unknown) => typeof id === "string")) {
      return badRequest("resourceIds must contain only strings", { field: "resourceIds" });
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

    // Derive conflictCode from itemType
    const conflictCodeMap: Record<string, string> = {
      stall: "stall_already_assigned",
      rv: "rv_site_already_assigned",
    };
    const conflictCode = conflictCodeMap[itemType] || "resource_already_assigned";

    // Call generalized service
    const createdHolds = await assignResourcesToRegistration({
      tenantId,
      registrationId: id,
      eventId,
      itemType,
      resourceIds,
      conflictCode,
      expectedResourceType: itemType,
      assertResourcesFn: async (args: Record<string, any>) => {
        // Dynamically import and call the correct assertion function
        if (itemType === "stall") {
          const { assertStallResourcesExistAndAvailable } = await import("../resources/stalls");
          return assertStallResourcesExistAndAvailable(args as any);
        } else if (itemType === "rv") {
          const { assertRvResourcesExistAndAvailable } = await import("../resources/rv-sites");
          return assertRvResourcesExistAndAvailable(args as any);
        } else {
          throw Object.assign(new Error(`No validator for itemType: ${itemType}`), { code: "no_validator", statusCode: 400 });
        }
      },
    });

    // Return created holds (safe response: id, state, resourceId only)
    const safeHolds = createdHolds.map((h: any) => ({
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
      if (err.statusCode === 409 && (err.code === "stall_already_assigned" || err.code === "rv_site_already_assigned")) {
        return conflictError(err.message || "Resource already assigned", { code: err.code });
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
