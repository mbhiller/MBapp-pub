// apps/api/src/registrations/cancel-refund.ts
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ok, badRequest, conflictError, error as respondError, notFound } from "../common/responses";
import { getTenantId } from "../common/env";
import { getObjectById, updateObject, releaseEventSeat, releaseEventRv, releaseEventStalls, listObjects, releaseEventLineCapacity } from "../objects/repo";
import { guardRegistrations } from "./feature";
import { createRefund } from "../common/stripe";
import { REGISTRATION_STATUS, REGISTRATION_PAYMENT_STATUS } from "./constants";
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
    const paymentIntentId = (reg as any).paymentIntentId as string | undefined;
    const totalAmount = (reg as any).totalAmount as number | undefined;
    const refundedAtExisting = (reg as any).refundedAt as string | undefined;
    const eventId = (reg as any).eventId as string | undefined;
    const rvQty = Math.max(0, Number((reg as any).rvQty || 0));
    const stallQty = Math.max(0, Number((reg as any).stallQty || 0));

    // Idempotency: already refunded or refundedAt set
    if (paymentStatus === REGISTRATION_PAYMENT_STATUS.refunded || refundedAtExisting) {
      return ok({ registration: reg, refund: null });
    }

    // Guard: must be confirmed + paid
    const allowed = currentStatus === REGISTRATION_STATUS.confirmed && paymentStatus === REGISTRATION_PAYMENT_STATUS.paid;
    if (!allowed) {
      return conflictError("Registration not eligible for cancel+refund", { code: "invalid_state", status: currentStatus, paymentStatus });
    }

    // Create refund (simulate-safe)
    const refund = await createRefund({
      paymentIntentId: paymentIntentId || "",
      amount: totalAmount,
      event,
    });

    // Update registration with cancel+refund fields
    const nowIso = new Date().toISOString();
    const body: Record<string, any> = {
      status: REGISTRATION_STATUS.cancelled,
      paymentStatus: REGISTRATION_PAYMENT_STATUS.refunded,
      refundId: refund.id,
    };
    if (!(reg as any).cancelledAt) body.cancelledAt = nowIso;
    if (!(reg as any).refundedAt) body.refundedAt = nowIso;

    const regForSnapshot: any = {
      ...reg,
      status: REGISTRATION_STATUS.cancelled,
      paymentStatus: REGISTRATION_PAYMENT_STATUS.refunded,
    };
    const snapshot = computeCheckInStatus({ tenantId, registration: regForSnapshot, holds: [] });
    const updated = await updateObject({ tenantId, type: "registration", id, body: { ...body, checkInStatus: snapshot } });

    // Release capacity once when transitioning
    if (eventId) {
      try { await releaseEventSeat({ tenantId, eventId }); } catch (_) {}
      if (rvQty > 0) {
        try { await releaseEventRv({ tenantId, eventId, qty: rvQty }); } catch (_) {}
      }
      if (stallQty > 0) {
        try { await releaseEventStalls({ tenantId, eventId, qty: stallQty }); } catch (_) {}
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

    // Release reservation holds on refund
    try {
      await releaseReservationHoldsForOwner({
        tenantId,
        ownerType: "registration",
        ownerId: id,
        reason: "refund",
        event,
      });
    } catch (_) {
      // ignore; counters already released
    }

    // Include refund details in response (non-sensitive)
    return ok({ registration: updated, refund });
  } catch (err: any) {
    return respondError(err);
  }
}
