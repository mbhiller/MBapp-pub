// apps/api/src/registrations/cancel.ts
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ok, badRequest, conflictError, error as respondError, notFound } from "../common/responses";
import { getTenantId } from "../common/env";
import { getObjectById, updateObject, releaseEventSeat, releaseEventRv } from "../objects/repo";
import { guardRegistrations } from "./feature";

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

    if (currentStatus === "cancelled") {
      // Idempotent: already cancelled, return current
      return ok(reg);
    }

    // Allowed transitions: submitted (pending/failed) OR confirmed (paid)
    const allowedSubmitted = currentStatus === "submitted" && (!paymentStatus || paymentStatus === "pending" || paymentStatus === "failed");
    const allowedConfirmed = currentStatus === "confirmed" && paymentStatus === "paid";
    if (!allowedSubmitted && !allowedConfirmed) {
      return conflictError("Registration not in a cancellable state", { code: "invalid_state", status: currentStatus, paymentStatus });
    }

    // Build update body
    const body: Record<string, any> = { status: "cancelled" };
    if (!cancelledAtExisting) body.cancelledAt = new Date().toISOString();
    if (allowedSubmitted) {
      body.paymentStatus = "failed"; // ensure failed for pre-payment cancellation
    }

    const updated = await updateObject({ tenantId, type: "registration", id, body });

    // Release capacity only when transitioning to cancelled from a non-cancelled state
    if (eventId) {
      try { await releaseEventSeat({ tenantId, eventId }); } catch (_) {}
      if (rvQty > 0) {
        try { await releaseEventRv({ tenantId, eventId, qty: rvQty }); } catch (_) {}
      }
    }

    return ok(updated);
  } catch (err: any) {
    return respondError(err);
  }
}
