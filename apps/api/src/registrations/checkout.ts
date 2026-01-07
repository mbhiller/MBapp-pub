// apps/api/src/registrations/checkout.ts
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import crypto from "crypto";
import { ok, badRequest, conflictError, error as respondError } from "../common/responses";
import { getTenantId } from "../common/env";
import { getObjectById, updateObject, reserveEventSeat, reserveEventRv, releaseEventSeat } from "../objects/repo";
import { guardRegistrations } from "./feature";
import { createPaymentIntent } from "../common/stripe";
import { REGISTRATION_STATUS, REGISTRATION_PAYMENT_STATUS } from "./constants";

/** Constant-time string compare to avoid timing leaks */
function constantTimeEqual(a: string, b: string) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export async function handle(event: APIGatewayProxyEventV2) {
  try {
    const guard = guardRegistrations(event);
    if (guard) return guard;

    const tenantId = getTenantId(event);
    const id = event.pathParameters?.id || "";
    if (!id) return badRequest("Missing registration id", { field: "id" });

    // Public token validation
    const tokenHeader = event.headers?.["x-mbapp-public-token"] || event.headers?.["X-MBapp-Public-Token"];
    if (!tokenHeader || typeof tokenHeader !== "string") {
      return badRequest("Missing X-MBapp-Public-Token header", { code: "missing_public_token" });
    }

    // Fetch registration
    const registration = await getObjectById({
      tenantId,
      type: "registration",
      id,
    });
    if (!registration) {
      return badRequest("Registration not found", { code: "registration_not_found" });
    }

    // Validate public token against stored hash
    const expectedHash = (registration as any).publicTokenHash as string | undefined;
    if (!expectedHash) {
      return conflictError("Registration missing public token", { code: "missing_public_token_hash" });
    }

    const providedHash = crypto.createHash("sha256").update(tokenHeader).digest("hex");
    if (!constantTimeEqual(expectedHash, providedHash)) {
      return conflictError("Invalid public token", { code: "invalid_public_token" });
    }

    const status = (registration as any).status;
    const paymentIntentId = (registration as any).paymentIntentId as string | undefined;
    const paymentIntentClientSecret = (registration as any).paymentIntentClientSecret as string | undefined;
    const storedIdempotency = (registration as any).checkoutIdempotencyKey as string | undefined;
    const holdExpiresAt = (registration as any).holdExpiresAt as string | undefined;
    const existingTotalAmount = (registration as any).totalAmount as number | undefined;
    const existingCurrency = (registration as any).currency as string | undefined;
    const nowMs = Date.now();
    const holdExpiresMs = holdExpiresAt ? new Date(holdExpiresAt).getTime() : undefined;

    // Submitted replay: if expired, reject; else return existing PI
    if (status === REGISTRATION_STATUS.submitted && paymentIntentId && paymentIntentClientSecret) {
      if (holdExpiresMs !== undefined && holdExpiresMs < nowMs) {
        return conflictError("Registration hold expired", { code: "hold_expired" });
      }
      return ok({ paymentIntentId, clientSecret: paymentIntentClientSecret, ...(existingTotalAmount != null ? { totalAmount: existingTotalAmount } : {}), ...(existingCurrency ? { currency: existingCurrency } : {}) });
    }

    if (status && status !== REGISTRATION_STATUS.draft) {
      return conflictError(`Registration is not in a draft state (status=${status})`, { code: "invalid_state" });
    }

    // Fetch event to validate status and capacity; include RV pricing/capacity
    const eventObj = await getObjectById({
      tenantId,
      type: "event",
      id: (registration as any).eventId,
      fields: ["id", "status", "capacity", "reservedCount", "rvEnabled", "rvCapacity", "rvUnitAmount"],
    });

    if (!eventObj) {
      return badRequest("Event not found", { code: "event_not_found" });
    }
    if ((eventObj as any).status !== "open") {
      return conflictError("Event is not open", { code: "event_not_open" });
    }

    // Idempotency key handling
    const incomingIdem = event.headers?.["idempotency-key"] || event.headers?.["Idempotency-Key"];
    const idempotencyKey = typeof incomingIdem === "string" && incomingIdem.trim() ? incomingIdem.trim() : undefined;

    // If incoming idempotency matches stored, return existing PI if present
    if (idempotencyKey && storedIdempotency === idempotencyKey && paymentIntentId && paymentIntentClientSecret) {
      return ok({ paymentIntentId, clientSecret: paymentIntentClientSecret, ...(existingTotalAmount != null ? { totalAmount: existingTotalAmount } : {}), ...(existingCurrency ? { currency: existingCurrency } : {}) });
    }

    // Compute authoritative fees (server-side) and totals
    const rvQty = Math.max(0, Number((registration as any).rvQty || 0));
    const rvEnabled = (eventObj as any)?.rvEnabled === true;
    const rvUnitAmount = Number((eventObj as any)?.rvUnitAmount ?? 0);

    const computedFees: Array<{ key: string; label: string; qty: number; unitAmount: number; amount: number; currency: string }> = [];
    if (rvQty > 0) {
      if (!rvEnabled) {
        return conflictError("RV add-on not enabled for this event", { code: "rv_not_enabled" });
      }
      if (!(rvUnitAmount > 0)) {
        return conflictError("RV pricing not configured for this event", { code: "rv_pricing_missing" });
      }
      const amount = rvQty * rvUnitAmount;
      computedFees.push({ key: "rv", label: "RV Spot", qty: rvQty, unitAmount: rvUnitAmount, amount, currency: "usd" });
    }
    const totalAmount = computedFees.reduce((sum, f) => sum + (Number.isFinite(f.amount) ? f.amount : 0), 0);

    // Enforce capacity atomically (only when transitioning draft -> submitted)
    try {
      await reserveEventSeat({ tenantId, eventId: (registration as any).eventId });
    } catch (err: any) {
      if (err?.code === "capacity_full") {
        return conflictError("Event capacity full", { code: "capacity_full" });
      }
      throw err;
    }

    // Reserve RV capacity if requested; if it fails, release seat and surface rv error
    if (rvQty > 0) {
      try {
        await reserveEventRv({ tenantId, eventId: (registration as any).eventId, qty: rvQty });
      } catch (err: any) {
        if (err?.code === "rv_capacity_full") {
          try { await releaseEventSeat({ tenantId, eventId: (registration as any).eventId }); } catch (_) {}
          return conflictError("RV capacity full", { code: "rv_capacity_full" });
        }
        // Unknown error; release seat and propagate
        try { await releaseEventSeat({ tenantId, eventId: (registration as any).eventId }); } catch (_) {}
        throw err;
      }
    }

    // Use computed total amount for PaymentIntent (minor units)
    const amount = totalAmount;

    // Create PaymentIntent (idempotent via Stripe)
    const pi = await createPaymentIntent({
      amount,
      currency: "usd",
      metadata: {
        registrationId: (registration as any).id,
        eventId: (registration as any).eventId,
      },
      idempotencyKey: idempotencyKey || (registration as any).id,
      event,
    });

    // Update registration to submitted with PI info
    const ttlSecRaw = process.env.REGISTRATION_HOLD_TTL_SECONDS || "900";
    const ttlSec = Number.isFinite(parseInt(ttlSecRaw, 10)) ? parseInt(ttlSecRaw, 10) : 900;
    const holdUntil = new Date(Date.now() + ttlSec * 1000).toISOString();
    const updated = await updateObject({
      tenantId,
      type: "registration",
      id,
      body: {
        status: REGISTRATION_STATUS.submitted,
        paymentStatus: REGISTRATION_PAYMENT_STATUS.pending,
        paymentIntentId: pi.id,
        paymentIntentClientSecret: pi.clientSecret,
        checkoutIdempotencyKey: idempotencyKey,
        submittedAt: new Date().toISOString(),
        holdExpiresAt: holdUntil,
        fees: computedFees,
        totalAmount: amount,
        currency: "usd",
      },
    });

    return ok({ paymentIntentId: pi.id, clientSecret: pi.clientSecret, totalAmount: amount, currency: "usd" });
  } catch (err: any) {
    return respondError(err);
  }
}
