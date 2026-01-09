import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ok, badRequest, error as respondError } from "../common/responses";
import { getTenantId } from "../common/env";
import { getObjectById, listObjects } from "../objects/repo";
import { guardRegistrations } from "./feature";
import { computeCheckInStatus } from "./checkin-readiness";
import type { components } from "../generated/openapi-types";

type ScanResolutionRequest = components["schemas"]["ScanResolutionRequest"];
type ScanResolutionResult = components["schemas"]["ScanResolutionResult"];

/**
 * POST /registrations:resolve-scan
 * Deterministic resolver: takes a scan string and returns the matching registration
 * within an event, with check-in readiness snapshot.
 */
export async function handle(event: APIGatewayProxyEventV2) {
  try {
    const guard = guardRegistrations(event);
    if (guard) return guard;

    const tenantId = getTenantId(event);
    const rawBody = event.body ? (typeof event.body === "string" ? event.body : JSON.stringify(event.body)) : "{}";
    let req: ScanResolutionRequest;

    try {
      req = JSON.parse(rawBody);
    } catch {
      return badRequest("Invalid JSON in request body");
    }

    // Validate required fields
    if (!req.eventId || !req.eventId.trim()) {
      return badRequest("Missing required field: eventId");
    }
    if (!req.scanString || !req.scanString.trim()) {
      return badRequest("Missing required field: scanString");
    }

    const eventId = req.eventId.trim();
    const scanString = req.scanString.trim();
    const scanType = req.scanType || "auto";

    // Validate scanType enum
    if (!["auto", "qr", "barcode", "epc"].includes(scanType)) {
      return badRequest("Invalid scanType; must be one of: auto, qr, barcode, epc");
    }

    // Resolution order (Sprint BX minimal):
    // 1) If looks like JSON, try to extract id / registrationId field
    // 2) If looks like MBapp QR payload (starts with specific prefix), parse it
    // 3) Otherwise treat as raw registrationId
    let candidateId: string | null = null;

    if (scanType === "auto" || scanType === "qr") {
      // Try JSON parsing first
      if (scanString.startsWith("{") && scanString.endsWith("}")) {
        try {
          const parsed = JSON.parse(scanString);
          if (typeof parsed === "object" && parsed !== null) {
            // Look for id, registrationId, or similar fields
            candidateId = parsed.registrationId || parsed.id || null;
          }
        } catch {
          // Not valid JSON, continue
        }
      }

      // If still no candidate, try MBapp QR format (simple heuristic for now)
      // MBapp QR might look like "mbapp:qr:..." or be a JSON with "id" field
      if (!candidateId && scanType === "qr") {
        // Could parse more sophisticated formats here
        // For now, if it's not JSON, try to extract after known prefixes
        if (scanString.includes("registrationId=")) {
          const match = scanString.match(/registrationId=([^&]+)/);
          if (match) candidateId = match[1];
        } else if (scanString.includes("id=")) {
          const match = scanString.match(/id=([^&]+)/);
          if (match) candidateId = match[1];
        }
      }
    }

    // Fallback: treat entire scanString as a registrationId candidate
    if (!candidateId) {
      candidateId = scanString;
    }

    if (!candidateId || !candidateId.trim()) {
      return ok({
        ok: false,
        error: "invalid_scan",
        reason: "Could not extract registrationId from scan string",
      } as ScanResolutionResult);
    }

    candidateId = candidateId.trim();

    // Fetch the registration
    const registration = await getObjectById({
      tenantId,
      type: "registration",
      id: candidateId,
      fields: [
        "id",
        "type",
        "eventId",
        "partyId",
        "status",
        "paymentStatus",
        "stallQty",
        "rvQty",
        "lines",
        "checkInStatus",
        "checkedInAt",
      ],
    });

    // Validate registration exists and is of correct type
    if (!registration || (registration as any).type !== "registration") {
      return ok({
        ok: false,
        error: "not_found",
        reason: `Registration ${candidateId} not found`,
      } as ScanResolutionResult);
    }

    // Verify registration belongs to the requested event
    if ((registration as any).eventId !== eventId) {
      return ok({
        ok: false,
        error: "not_in_event",
        reason: `Registration ${candidateId} does not belong to event ${eventId}`,
        registrationId: candidateId,
      } as ScanResolutionResult);
    }

    // Fetch holds for check-in status computation
    const holdsPage = await listObjects({
      tenantId,
      type: "reservationHold",
      filters: { ownerType: "registration", ownerId: candidateId },
      limit: 200,
      fields: ["id", "itemType", "resourceId", "state"],
    });
    const holds = ((holdsPage.items as any[]) || []) as any[];

    // Compute check-in status snapshot
    const checkInStatus = computeCheckInStatus({
      tenantId,
      registration: registration as any,
      holds: holds as any,
    });

    // Build success response with check-in readiness
    const result: ScanResolutionResult = {
      ok: true,
      registrationId: (registration as any).id,
      partyId: (registration as any).partyId || null,
      status: (registration as any).status as "draft" | "submitted" | "confirmed" | "cancelled",
      ready: checkInStatus.ready ?? false,
      blockers: checkInStatus.blockers || [],
      lastEvaluatedAt: checkInStatus.lastEvaluatedAt || null,
    };

    return ok(result);
  } catch (err: any) {
    return respondError(err);
  }
}
