// apps/api/src/registrations/checkout.ts
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import crypto from "crypto";
import { ok, badRequest, conflictError, error as respondError } from "../common/responses";
import { getTenantId } from "../common/env";
import { getObjectById, updateObject, reserveEventSeat } from "../objects/repo";
import { guardRegistrations } from "./feature";
import { createPaymentIntent } from "../common/stripe";

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

    // Idempotent repeat: if already submitted with PI, return existing PI
    if (status === "submitted" && paymentIntentId && paymentIntentClientSecret) {
      return ok({ paymentIntentId, clientSecret: paymentIntentClientSecret });
    }

    if (status && status !== "draft") {
      return conflictError(`Registration is not in a draft state (status=${status})`, { code: "invalid_state" });
    }

    // Fetch event to validate status and capacity
    const eventObj = await getObjectById({
      tenantId,
      type: "event",
      id: (registration as any).eventId,
      fields: ["id", "status", "capacity", "reservedCount"],
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
      return ok({ paymentIntentId, clientSecret: paymentIntentClientSecret });
    }

    // Enforce capacity atomically (only when transitioning draft -> submitted)
    try {
      await reserveEventSeat({ tenantId, eventId: (registration as any).eventId });
    } catch (err: any) {
      if (err?.code === "capacity_full") {
        return conflictError("Event capacity full", { code: "capacity_full" });
      }
      throw err;
    }

    // Compute total amount from fees (assume amount already in minor units)
    const fees: Array<{ amount: number }> = Array.isArray((registration as any).fees)
      ? (registration as any).fees as Array<{ amount: number }>
      : [];
    const amount = fees.reduce((sum, fee) => sum + (typeof fee.amount === "number" ? fee.amount : 0), 0);

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
    const updated = await updateObject({
      tenantId,
      type: "registration",
      id,
      body: {
        status: "submitted",
        paymentStatus: "pending",
        paymentIntentId: pi.id,
        paymentIntentClientSecret: pi.clientSecret,
        checkoutIdempotencyKey: idempotencyKey,
        submittedAt: new Date().toISOString(),
      },
    });

    return ok({ paymentIntentId: pi.id, clientSecret: pi.clientSecret });
  } catch (err: any) {
    return respondError(err);
  }
}
