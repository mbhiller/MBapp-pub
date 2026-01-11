import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ok, badRequest, error as respondError } from "../common/responses";
import { getTenantId } from "../common/env";
import { getObjectById, listObjects } from "../objects/repo";
import { guardRegistrations } from "./feature";
import { computeCheckInStatus } from "./checkin-readiness";
import type { components } from "../generated/openapi-types";
import { parseBadgeQr, parseTicketQr } from "@mbapp/scan/qr";

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
    const scanString = String(req.scanString ?? "").trim();
    const trimmedScanString = scanString.trim();
    const scanType = req.scanType || "auto";

    // Validate scanType enum
    if (!["auto", "qr", "barcode", "epc"].includes(scanType)) {
      return badRequest("Invalid scanType; must be one of: auto, qr, barcode, epc");
    }

    // Resolution order (Sprint BX minimal):
    // 1) If looks like JSON, try to extract id / registrationId field
    // 2) If looks like MBapp QR payload (badge or ticket), parse it
    // 3) Otherwise treat as raw registrationId
    let candidateId: string | null = null;
    let ticketSummary: { ticketId: string; ticketType: string; ticketStatus: "valid" | "used" | "cancelled" | "expired"; ticketUsedAt: string | null } | null = null;

    if (scanType === "auto" || scanType === "qr" || scanType === "barcode") {
      // Try JSON parsing first (malformed JSON should return invalid_scan)
      if (trimmedScanString.startsWith("{") || trimmedScanString.startsWith("[")) {
        try {
          const parsed = JSON.parse(trimmedScanString);
          if (typeof parsed === "object" && parsed !== null) {
            candidateId = (parsed as any).registrationId || (parsed as any).id || null;
          }
        } catch {
          return ok({
            ok: false,
            error: "invalid_scan",
            reason: "malformed_json",
          } as ScanResolutionResult);
        }
      }

      // Ticket QR: ticket|{eventId}|{registrationId}|{ticketId}
      if (!candidateId && trimmedScanString.startsWith("ticket|")) {
        const parts = trimmedScanString.split("|");
        if (parts.length !== 4) {
          return ok({
            ok: false,
            error: "invalid_scan",
            reason: "malformed_ticket_qr",
          } as ScanResolutionResult);
        }
        const ticketId = parts[3];
        const regIdFromQr = parts[2];

        // Attempt to fetch ticket up-front; missing ticket should return not_found and not fall through
        try {
          const ticketObj = await getObjectById({
            tenantId,
            type: "ticket",
            id: ticketId,
            fields: ["id", "type", "status", "usedAt", "registrationId", "eventId"],
          });

          if (!ticketObj || (ticketObj as any).type !== "ticket") {
            return ok({
              ok: false,
              error: "not_found",
              reason: "ticket_not_found",
            } as ScanResolutionResult);
          }

          // Keep ticket summary for nextAction and admission guidance
          ticketSummary = {
            ticketId: (ticketObj as any).id,
            ticketType: (ticketObj as any).ticketType || "admission",
            ticketStatus: (ticketObj as any).status as "valid" | "used" | "cancelled" | "expired",
            ticketUsedAt: (ticketObj as any).usedAt || null,
          };

          // Resolve registration from QR (fallback to ticket record if provided)
          candidateId = regIdFromQr || (ticketObj as any).registrationId || null;
          (event as any).__parsedTicketId = ticketId;
        } catch {
          return ok({
            ok: false,
            error: "not_found",
            reason: "ticket_not_found",
          } as ScanResolutionResult);
        }
      }

      // Badge issuance QR: badge|{eventId}|{registrationId}|{issuanceId}
      if (!candidateId && trimmedScanString.startsWith("badge|")) {
        const parts = trimmedScanString.split("|");
        if (parts.length !== 4) {
          return ok({
            ok: false,
            error: "invalid_scan",
            reason: "malformed_badge_qr",
          } as ScanResolutionResult);
        }

        const badge = parseBadgeQr(trimmedScanString) ?? { registrationId: parts[2] };
        if (badge?.registrationId) {
          candidateId = badge.registrationId;
        }
      }

      // If still no candidate, try MBapp QR format (simple heuristic for now)
      // MBapp QR might look like "mbapp:qr:..." or be a JSON with "id" field
      if (!candidateId && (scanType === "qr" || scanType === "barcode")) {
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

    // E1: Fetch ticket summary if ticket QR was scanned via registration/badge flows (and ticket not already fetched)
    const parsedTicketId = (event as any).__parsedTicketId as string | undefined;
    if (parsedTicketId) {
      try {
        const ticket = await getObjectById({
          tenantId,
          type: "ticket",
          id: parsedTicketId,
          fields: ["id", "type", "status", "usedAt", "ticketType"],
        });
        if (ticket && (ticket as any).type === "ticket") {
          ticketSummary = {
            ticketId: (ticket as any).id,
            ticketType: (ticket as any).ticketType || "admission",
            ticketStatus: (ticket as any).status as "valid" | "used" | "cancelled" | "expired",
            ticketUsedAt: (ticket as any).usedAt || null,
          };
        }
      } catch {
        // Ticket not found: include in response as missing (not blocking)
        ticketSummary = null;
      }
    }

    // E1: Compute nextAction + nextActionLabel for operator guidance (always include, even if null)
    const isCheckedIn = !!(registration as any).checkedInAt;
    const isReady = checkInStatus.ready === true;
    const isBlocked = checkInStatus.ready === false;

    let nextAction: "checkin" | "admit" | "already_admitted" | "blocked" | null = null;
    let nextActionLabel: string | null = null;

    // Base nextAction for non-ticket scans
    if (isBlocked) {
      nextAction = "blocked";
      nextActionLabel = "Blocked";
    } else if (!isCheckedIn) {
      nextAction = "checkin";
      nextActionLabel = "Check In";
    }

    // Ticket-aware overrides (if a ticket QR was parsed)
    if (ticketSummary) {
      if (isBlocked) {
        nextAction = "blocked";
        nextActionLabel = "Blocked";
      } else if (!isCheckedIn) {
        nextAction = "checkin";
        nextActionLabel = "Check In";
      } else if (ticketSummary.ticketStatus === "used") {
        nextAction = "already_admitted";
        nextActionLabel = "Already Admitted";
      } else if (ticketSummary.ticketStatus === "valid") {
        nextAction = "admit";
        nextActionLabel = "Admit Ticket";
      } else {
        nextAction = "blocked";
        nextActionLabel = "Ticket Not Valid";
      }
    }

    // Build success response with check-in readiness + E1 ticket summary + nextAction
    const result: ScanResolutionResult = {
      ok: true,
      registrationId: (registration as any).id,
      partyId: (registration as any).partyId || null,
      status: (registration as any).status as "draft" | "submitted" | "confirmed" | "cancelled",
      ready: checkInStatus.ready ?? false,
      blockers: checkInStatus.blockers || [],
      lastEvaluatedAt: checkInStatus.lastEvaluatedAt || null,
      ticketId: ticketSummary ? ticketSummary.ticketId : undefined,
      ticketType: ticketSummary ? (ticketSummary.ticketType as "admission" | "staff" | "vendor" | "vip") : undefined,
      ticketStatus: ticketSummary ? ticketSummary.ticketStatus : undefined,
      ticketUsedAt: ticketSummary ? ticketSummary.ticketUsedAt : undefined,
      nextAction,
      nextActionLabel,
    };

    return ok(result);
  } catch (err: any) {
    return respondError(err);
  }
}
