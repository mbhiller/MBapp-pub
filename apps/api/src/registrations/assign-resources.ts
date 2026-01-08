/**
 * POST /registrations/{id}:assign-resources
 * Generalized operator action to assign specific discrete resources (stalls, RV sites, etc.) to a registration.
 * Converts block resource hold (itemType per type, resourceId=null) into specific granular assignments (Sprint BM).
 */

import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ok, badRequest, conflictError, error as respondError, notFound } from "../common/responses";
import { getTenantId } from "../common/env";
import { guardRegistrations } from "./feature";
import { assignResourcesToRegistration } from "../reservations/holds";
import { getObjectById, listObjects, updateObject } from "../objects/repo";
import { computeCheckInStatus } from "./checkin-readiness";
import { parseNonEmptyStringArray } from "../common/registration-validators";
import { loadRegistrationWithEvent } from "../common/registration-helpers";
import { assertStallResourcesExistAndAvailable } from "../resources/stalls";
import { assertRvResourcesExistAndAvailable } from "../resources/rv-sites";
import { assertEventLinesExistAndAvailable } from "../resources/event-lines";

type AssertResourcesFnArgs = {
  tenantId?: string;
  resourceIds: string[];
  eventId?: string;
  stallIds?: string[];
  rvSiteIds?: string[];
};

type ResourceAssignmentConfig = {
  expectedResourceType: string;
  conflictCode: string;
  assertFn: (args: AssertResourcesFnArgs) => Promise<Record<string, any>[]>;
};

const RESOURCE_ASSIGNMENT_REGISTRY: Record<string, ResourceAssignmentConfig> = {
  stall: {
    expectedResourceType: "stall",
    conflictCode: "stall_already_assigned",
    assertFn: ({ tenantId, resourceIds, stallIds, eventId }) =>
      assertStallResourcesExistAndAvailable({ tenantId, stallIds: stallIds ?? resourceIds, eventId }),
  },
  rv: {
    expectedResourceType: "rv",
    conflictCode: "rv_site_already_assigned",
    assertFn: ({ tenantId, resourceIds, rvSiteIds, eventId }) =>
      assertRvResourcesExistAndAvailable({ tenantId, rvSiteIds: rvSiteIds ?? resourceIds, eventId }),
  },
  class_entry: {
    expectedResourceType: "class_entry",
    conflictCode: "class_capacity_full",
    assertFn: ({ tenantId, resourceIds, eventId }) =>
      assertEventLinesExistAndAvailable({ tenantId, eventId, eventLineIds: resourceIds }),
  },
};

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
    const config = itemType ? RESOURCE_ASSIGNMENT_REGISTRY[itemType] : undefined;

    // Validate itemType via registry
    const allowedTypes = Object.keys(RESOURCE_ASSIGNMENT_REGISTRY);
    if (!config) {
      return badRequest(`itemType must be one of: ${allowedTypes.join(", ")}`, {
        code: "invalid_item_type",
        field: "itemType",
      });
    }

    // Validate resourceIds using shared helper
    let resourceIds: string[];
    try {
      // For class_entry, allow duplicates (multiple entries from same line); for stalls/rv, enforce uniqueness
      resourceIds = parseNonEmptyStringArray(body.resourceIds, {
        field: "resourceIds",
        allowDuplicates: itemType === "class_entry",
      });
    } catch (err: any) {
      return badRequest(err.message, { code: err.code, field: err.field });
    }

    // Load registration to get eventId using shared helper
    let eventId: string;
    try {
      const { eventId: eid } = await loadRegistrationWithEvent(tenantId, id);
      eventId = eid;
    } catch (err: any) {
      if (err?.statusCode === 404) {
        return notFound(err.message);
      }
      return badRequest(err.message, { code: err.code });
    }

    // Call generalized service
    const createdHolds = await assignResourcesToRegistration({
      tenantId,
      registrationId: id,
      eventId,
      itemType,
      resourceIds,
      conflictCode: config.conflictCode,
      expectedResourceType: config.expectedResourceType,
      assertResourcesFn: (args: Record<string, any>) => config.assertFn(args as AssertResourcesFnArgs),
      options: itemType === "class_entry" ? { exclusiveResourceIds: false, blockHoldPerResourceId: true } : undefined,
    });

    // After assignment, recompute readiness snapshot and persist on registration
    const reg = await getObjectById({
      tenantId,
      type: "registration",
      id,
      fields: ["id", "type", "status", "paymentStatus", "stallQty", "rvQty", "lines", "checkInStatus"],
    });
    if (reg && (reg as any).type === "registration") {
      const holdsPage = await listObjects({
        tenantId,
        type: "reservationHold",
        filters: { ownerType: "registration", ownerId: id },
        limit: 200,
        fields: ["id", "itemType", "resourceId", "state"],
      });
      const holds = ((holdsPage.items as any[]) || []) as any[];
      const snapshot = computeCheckInStatus({ tenantId, registration: reg as any, holds: holds as any });
      await updateObject({ tenantId, type: "registration", id, body: { checkInStatus: snapshot } });
    }

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
