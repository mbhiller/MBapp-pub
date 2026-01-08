// apps/api/src/registrations/cancel.ts
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ok, badRequest, conflictError, error as respondError, notFound } from "../common/responses";
import { getTenantId } from "../common/env";
import { getObjectById, updateObject, releaseEventSeat, releaseEventRv, listObjects, releaseEventLineCapacity } from "../objects/repo";
import { REGISTRATION_STATUS, REGISTRATION_PAYMENT_STATUS } from "./constants";
import { guardRegistrations } from "./feature";
import { releaseReservationHoldsForOwner } from "../reservations/holds";
import { computeCheckInStatus } from "./checkin-readiness";

/**
 * Release class entry capacity counters by computing qty from holds.
 * Prefers per-entry holds (after assignment) over block holds (before assignment).
 */
async function releaseClassEntryCountersFromHolds({
  tenantId,
  eventId,
  registrationId,
}: {
  tenantId: string;
  eventId: string;
  registrationId: string;
}) {
  try {
    const classHoldsPage = await listObjects({
      tenantId,
      type: "reservationHold",
      filters: {
        ownerType: "registration",
        ownerId: String(registrationId),
        scopeType: "event",
        scopeId: String(eventId),
        itemType: "class_entry",
      },
      limit: 200,
      fields: ["id", "state", "qty", "resourceId", "metadata"],
    });

    const classHolds = (classHoldsPage.items as any[]) || [];
    const lineIdQty: Record<string, number> = {};

    // Group holds by lineId and resourceId to decide which to count
    const holdsByLineId: Record<string, any[]> = {};
    for (const hold of classHolds) {
      const st = String((hold as any)?.state || "");
      if (!["held", "confirmed"].includes(st)) continue;

      // Extract lineId from either metadata (block holds) or resourceId (per-entry holds)
      const lineId = (hold as any)?.resourceId || (hold as any)?.metadata?.eventLineId;
      if (!lineId) continue;

      if (!holdsByLineId[lineId]) {
        holdsByLineId[lineId] = [];
      }
      holdsByLineId[lineId].push(hold);
    }

    // For each lineId, prefer per-entry holds; fall back to block holds
    for (const [lineId, holds] of Object.entries(holdsByLineId)) {
      // Per-entry holds: resourceId == lineId
      const perEntryHolds = holds.filter((h: any) => h.resourceId === lineId);
      if (perEntryHolds.length > 0) {
        // Sum per-entry hold qtys (usually 1 each, but be safe)
        const totalQty = perEntryHolds.reduce((sum: number, h: any) => sum + (Number(h.qty) || 1), 0);
        lineIdQty[lineId] = totalQty;
      } else {
        // Block holds: resourceId is null/absent, metadata.eventLineId == lineId
        const blockHolds = holds.filter((h: any) => !h.resourceId);
        if (blockHolds.length > 0) {
          // Block holds should have qty that we reserved
          const blockQty = blockHolds[0]?.qty || 0;
          lineIdQty[lineId] = blockQty;
        }
      }
    }

    // Release counters for each lineId
    for (const [lineId, qty] of Object.entries(lineIdQty)) {
      if (qty > 0) {
        try {
          await releaseEventLineCapacity({ tenantId, eventId, lineId, qty });
        } catch (_) {
          // Release is best-effort; continue if one fails
        }
      }
    }
  } catch (_) {
    // Entire release is best-effort
  }
}

export async function handle(event: APIGatewayProxyEventV2) {
  try {
    const guard = guardRegistrations(event);
    if (guard) return guard;

    const tenantId = getTenantId(event);
    const id = event.pathParameters?.id || "";
    if (!id) return badRequest("Missing registration id", { field: "id" });

    const reg = await getObjectById({ tenantId, type: "registration", id });
    if (!reg || (reg as any).type !== "registration") {
      return notFound("Registration not found");
    }

    const currentStatus = (reg as any).status as string | undefined;
    const paymentStatus = (reg as any).paymentStatus as string | undefined;
    const eventId = (reg as any).eventId as string | undefined;
    const rvQty = Math.max(0, Number((reg as any).rvQty || 0));
    const cancelledAtExisting = (reg as any).cancelledAt as string | undefined;

    if (currentStatus === REGISTRATION_STATUS.cancelled) {
      // Idempotent: already cancelled, return current
      return ok(reg);
    }

    // Allowed transitions: submitted (pending/failed) OR confirmed (paid)
    const allowedSubmitted = currentStatus === REGISTRATION_STATUS.submitted && (!paymentStatus || paymentStatus === REGISTRATION_PAYMENT_STATUS.pending || paymentStatus === REGISTRATION_PAYMENT_STATUS.failed);
    const allowedConfirmed = currentStatus === REGISTRATION_STATUS.confirmed && paymentStatus === REGISTRATION_PAYMENT_STATUS.paid;
    if (!allowedSubmitted && !allowedConfirmed) {
      return conflictError("Registration not in a cancellable state", { code: "invalid_state", status: currentStatus, paymentStatus });
    }

    // Build update body
    const body: Record<string, any> = { status: REGISTRATION_STATUS.cancelled };
    if (!cancelledAtExisting) body.cancelledAt = new Date().toISOString();
    if (allowedSubmitted) {
      body.paymentStatus = REGISTRATION_PAYMENT_STATUS.failed; // ensure failed for pre-payment cancellation
    }
    // Compute terminal readiness snapshot (cancelled)
    const regForSnapshot: any = {
      ...reg,
      status: REGISTRATION_STATUS.cancelled,
      paymentStatus: body.paymentStatus || (reg as any).paymentStatus,
    };
    const snapshot = computeCheckInStatus({ tenantId, registration: regForSnapshot, holds: [] });
    const updated = await updateObject({ tenantId, type: "registration", id, body: { ...body, checkInStatus: snapshot } });

    // Release capacity only when transitioning to cancelled from a non-cancelled state
    if (eventId) {
      try { await releaseEventSeat({ tenantId, eventId }); } catch (_) {}
      if (rvQty > 0) {
        try { await releaseEventRv({ tenantId, eventId, qty: rvQty }); } catch (_) {}
      }

      // Release per-line class entry capacities (prefers per-entry holds over block holds)
      if (eventId) {
        await releaseClassEntryCountersFromHolds({
          tenantId: tenantId as string,
          eventId,
          registrationId: id,
        });
      }
    }

    // Release reservation holds on operator cancel
    try {
      await releaseReservationHoldsForOwner({
        tenantId,
        ownerType: "registration",
        ownerId: id,
        reason: "operator_cancel",
        event,
      });
    } catch (_) {
      // ignore; counters already released
    }

    return ok(updated);
  } catch (err: any) {
    return respondError(err);
  }
}
