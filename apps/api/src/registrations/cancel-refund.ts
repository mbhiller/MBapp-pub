// apps/api/src/registrations/cancel-refund.ts
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ok, badRequest, conflictError, error as respondError, notFound } from "../common/responses";
import { getTenantId } from "../common/env";
import { getObjectById, updateObject, releaseEventSeat, releaseEventRv } from "../objects/repo";
import { guardRegistrations } from "./feature";
import { createRefund } from "../common/stripe";
import { REGISTRATION_STATUS, REGISTRATION_PAYMENT_STATUS } from "./constants";
import { releaseReservationHoldsForOwner } from "../reservations/holds";

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

    const updated = await updateObject({ tenantId, type: "registration", id, body });

    // Release capacity once when transitioning
    if (eventId) {
      try { await releaseEventSeat({ tenantId, eventId }); } catch (_) {}
      if (rvQty > 0) {
        try { await releaseEventRv({ tenantId, eventId, qty: rvQty }); } catch (_) {}
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
