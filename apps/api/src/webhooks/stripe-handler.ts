// apps/api/src/webhooks/stripe-handler.ts
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { verifyWebhook, type StripeEvent } from "../common/stripe";
import { getObjectById, updateObject, listObjects } from "../objects/repo";
import { getTenantId } from "../common/env";
import { badRequest, ok, error as respondError } from "../common/responses";
import { enqueueTemplatedEmail, enqueueTemplatedSMS } from "../common/notify";
import { REGISTRATION_STATUS, REGISTRATION_PAYMENT_STATUS } from "../registrations/constants";
import { confirmReservationHoldsForOwner } from "../reservations/holds";
import { computeCheckInStatus } from "../registrations/checkin-readiness";

/** 
 * Stripe webhook handler (POST /webhooks/stripe)
 * Must handle raw body for signature verification
 */
export async function handle(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  try {
    // Extract signature header
    const signatureHeader = event.headers?.["stripe-signature"] 
      ?? event.headers?.["Stripe-Signature"];
    
    if (!signatureHeader) {
      return badRequest("Missing Stripe-Signature header", { code: "missing_signature" });
    }

    // Get raw body (handle base64 encoding if API Gateway encodes it)
    let rawBody: string;
    if (event.isBase64Encoded && event.body) {
      rawBody = Buffer.from(event.body, "base64").toString("utf-8");
    } else {
      rawBody = event.body || "";
    }

    if (!rawBody) {
      return badRequest("Missing request body", { code: "missing_body" });
    }

    // Verify webhook signature
    let stripeEvent: StripeEvent;
    try {
      stripeEvent = await verifyWebhook({
        rawBody,
        signatureHeader,
        event,
      });
    } catch (err: any) {
      console.error("[stripe-webhook] Signature verification failed:", err.message);
      return badRequest(`Webhook signature verification failed: ${err.message}`, { 
        code: "invalid_signature" 
      });
    }

    // Handle event types
    const { type, data } = stripeEvent;
    const paymentIntent = data.object;

    console.log(`[stripe-webhook] Event ${stripeEvent.id} type=${type} pi=${paymentIntent.id}`);

    switch (type) {
      case "payment_intent.succeeded":
        await handlePaymentSucceeded(event, paymentIntent);
        break;
      
      case "payment_intent.payment_failed":
        await handlePaymentFailed(event, paymentIntent);
        break;
      
      default:
        console.log(`[stripe-webhook] Unhandled event type: ${type}`);
    }

    return ok({ received: true });
  } catch (err: any) {
    console.error("[stripe-webhook] Handler error:", err);
    return respondError(err);
  }
}

/** Handle payment_intent.succeeded: confirm registration and update payment status */
async function handlePaymentSucceeded(
  event: APIGatewayProxyEventV2,
  paymentIntent: StripeEvent["data"]["object"]
) {
  const tenantId = getTenantId(event);
  const registrationId = paymentIntent.metadata?.registrationId;

  if (!registrationId) {
    console.warn("[stripe-webhook] payment_intent.succeeded missing registrationId in metadata");
    return;
  }

  // Look up registration
  const registration = await getObjectById({
    tenantId,
    type: "registration",
    id: registrationId,
  });

  if (!registration) {
    console.warn(`[stripe-webhook] Registration ${registrationId} not found`);
    return;
  }

  // Idempotency check: already confirmed
  if ((registration as any).paymentStatus === REGISTRATION_PAYMENT_STATUS.paid && (registration as any).confirmedAt) {
    console.log(`[stripe-webhook] Registration ${registrationId} already confirmed, skipping update`);
    return;
  }

  // Compute readiness snapshot in confirmed/paid state
  const holdsPage = await listObjects({
    tenantId,
    type: "reservationHold",
    filters: { ownerType: "registration", ownerId: registrationId },
    limit: 200,
    fields: ["id", "itemType", "resourceId", "state"],
  });
  const holds = ((holdsPage.items as any[]) || []) as any[];
  const regForSnapshot: any = {
    ...registration,
    status: REGISTRATION_STATUS.confirmed,
    paymentStatus: REGISTRATION_PAYMENT_STATUS.paid,
  };
  const snapshot = computeCheckInStatus({ tenantId, registration: regForSnapshot, holds: holds as any });

  // Update registration: set status to confirmed, paymentStatus to paid, confirmedAt timestamp + snapshot
  await updateObject({
    tenantId,
    type: "registration",
    id: registrationId,
    body: {
      status: REGISTRATION_STATUS.confirmed,
      paymentStatus: REGISTRATION_PAYMENT_STATUS.paid,
      paymentIntentId: paymentIntent.id,
      confirmedAt: new Date().toISOString(),
      checkInStatus: snapshot,
    },
  });

  // Confirm reservation holds for this registration
  try {
    await confirmReservationHoldsForOwner({
      tenantId,
      ownerType: "registration",
      ownerId: registrationId,
      event,
    });
  } catch (err: any) {
    console.error(`[stripe-webhook] Failed to confirm holds for ${registrationId}:`, err.message);
  }

  console.log(`[stripe-webhook] Registration ${registrationId} confirmed via PaymentIntent ${paymentIntent.id}`);

  // Prepare optional RV details for templates
  const rvQty = Math.max(0, Number(((registration as any)?.rvQty) || 0));
  const fees = Array.isArray((registration as any)?.fees) ? ((registration as any).fees as any[]) : [];
  const rvFee = fees.find((f) => f && (f.key === "rv"));
  const rvUnitAmount = rvFee && typeof rvFee.unitAmount === "number" ? rvFee.unitAmount : undefined;
  const rvAmount = rvFee && typeof rvFee.amount === "number" ? rvFee.amount : (rvQty > 0 && typeof rvUnitAmount === "number" ? rvQty * rvUnitAmount : undefined);
  const currency = (registration as any)?.currency as string | undefined;

  // Enqueue confirmation email (idempotent: store confirmationMessageId on registration)
  const email = (registration as any)?.party?.email as string | undefined;
  const existingMsgId = (registration as any)?.confirmationMessageId as string | undefined;
  if (email && !existingMsgId) {
    const msg = await enqueueTemplatedEmail({
      tenantId: tenantId!,
      to: email,
      templateKey: "registration.confirmed.email",
      templateVars: {
        registrationId,
        paymentIntentId: paymentIntent.id,
        ...(rvQty > 0 ? { rvQty } : {}),
        ...(rvQty > 0 && typeof rvUnitAmount === "number" ? { rvUnitAmount } : {}),
        ...(rvQty > 0 && typeof rvAmount === "number" ? { rvAmount } : {}),
        ...(currency ? { currency } : {}),
      },
      metadata: { registrationId, paymentIntentId: paymentIntent.id },
      event,
    });

    await updateObject({
      tenantId,
      type: "registration",
      id: registrationId,
      body: { confirmationMessageId: msg.id },
    });
  }

  // Enqueue confirmation SMS (idempotent: store confirmationSmsMessageId on registration)
  const phone = (registration as any)?.party?.phone as string | undefined;
  const existingSmsId = (registration as any)?.confirmationSmsMessageId as string | undefined;
  if (phone && !existingSmsId) {
    const smsMsg = await enqueueTemplatedSMS({
      tenantId: tenantId!,
      to: phone,
      templateKey: "registration.confirmed.sms",
      templateVars: {
        registrationId,
        ...(rvQty > 0 ? { rvQty } : {}),
        ...(rvQty > 0 && typeof rvUnitAmount === "number" ? { rvUnitAmount } : {}),
        ...(rvQty > 0 && typeof rvAmount === "number" ? { rvAmount } : {}),
        ...(currency ? { currency } : {}),
      },
      metadata: { registrationId, paymentIntentId: paymentIntent.id },
      event,
    });

    await updateObject({
      tenantId,
      type: "registration",
      id: registrationId,
      body: { confirmationSmsMessageId: smsMsg.id },
    });
  }
}

/** Handle payment_intent.payment_failed: update payment status to failed */
async function handlePaymentFailed(
  event: APIGatewayProxyEventV2,
  paymentIntent: StripeEvent["data"]["object"]
) {
  const tenantId = getTenantId(event);
  const registrationId = paymentIntent.metadata?.registrationId;

  if (!registrationId) {
    console.warn("[stripe-webhook] payment_intent.payment_failed missing registrationId in metadata");
    return;
  }

  // Look up registration
  const registration = await getObjectById({
    tenantId,
    type: "registration",
    id: registrationId,
  });

  if (!registration) {
    console.warn(`[stripe-webhook] Registration ${registrationId} not found`);
    return;
  }

  // Idempotency check: already marked as failed
  if ((registration as any).paymentStatus === REGISTRATION_PAYMENT_STATUS.failed) {
    console.log(`[stripe-webhook] Registration ${registrationId} already marked as failed, skipping update`);
    return;
  }

  // Compute readiness snapshot for failed payment state
  const holdsPageFailed = await listObjects({
    tenantId,
    type: "reservationHold",
    filters: { ownerType: "registration", ownerId: registrationId },
    limit: 200,
    fields: ["id", "itemType", "resourceId", "state"],
  });
  const holdsFailed = ((holdsPageFailed.items as any[]) || []) as any[];
  const regForSnapshotFailed: any = {
    ...registration,
    paymentStatus: REGISTRATION_PAYMENT_STATUS.failed,
  };
  const snapshotFailed = computeCheckInStatus({ tenantId, registration: regForSnapshotFailed, holds: holdsFailed as any });

  // Update registration: set paymentStatus to failed + snapshot
  await updateObject({
    tenantId,
    type: "registration",
    id: registrationId,
    body: {
      paymentStatus: REGISTRATION_PAYMENT_STATUS.failed,
      paymentIntentId: paymentIntent.id,
      checkInStatus: snapshotFailed,
    },
  });

  console.log(`[stripe-webhook] Registration ${registrationId} payment failed for PaymentIntent ${paymentIntent.id}`);
}
