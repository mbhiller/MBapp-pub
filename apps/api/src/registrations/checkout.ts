// apps/api/src/registrations/checkout.ts
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import crypto from "crypto";
import { ok, badRequest, conflictError, notFound, error as respondError } from "../common/responses";
import { getTenantId } from "../common/env";
import {
  getObjectById,
  listObjects,
  updateObject,
  reserveEventSeat,
  reserveEventRv,
  reserveEventLineCapacity,
  releaseEventSeat,
  releaseEventRv,
  releaseEventLineCapacity,
  reserveEventStalls,
  releaseEventStalls,
} from "../objects/repo";
import { guardRegistrations } from "./feature";
import { createPaymentIntent } from "../common/stripe";
import { REGISTRATION_STATUS, REGISTRATION_PAYMENT_STATUS } from "./constants";
import { createHeldReservationHold, releaseReservationHoldsForOwner, createHeldStallBlockHold, createHeldClassBlockHold } from "../reservations/holds";

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

    // Fetch event to validate status and capacity; include RV and stall pricing/capacity
    const eventObj = await getObjectById({
      tenantId,
      type: "event",
      id: (registration as any).eventId,
      fields: [
        "id",
        "status",
        "capacity",
        "reservedCount",
        "rvEnabled",
        "rvCapacity",
        "rvUnitAmount",
        "stallEnabled",
        "stallCapacity",
        "stallUnitAmount",
        "lines",
      ],
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
    const stallQty = Math.max(0, Number((registration as any).stallQty || 0));
    const rvEnabled = (eventObj as any)?.rvEnabled === true;
    const stallEnabled = (eventObj as any)?.stallEnabled === true;
    const rvUnitAmount = Number((eventObj as any)?.rvUnitAmount ?? 0);
    const stallUnitAmount = Number((eventObj as any)?.stallUnitAmount ?? 0);

    const computedFees: Array<{ key: string; label: string; qty: number; unitAmount: number; amount: number; currency: string }> = [];

    // Class lines mapping (registration lines -> eventLineIds)
    const registrationLines = Array.isArray((registration as any)?.lines) ? ((registration as any).lines as any[]) : [];
    const eventLinesRaw = (eventObj as any)?.lines;
    const eventLines = Array.isArray(eventLinesRaw)
      ? eventLinesRaw
      : eventLinesRaw && typeof eventLinesRaw === "object"
      ? Object.values(eventLinesRaw as Record<string, unknown>)
      : [];

    const requestedClassPerLine: Record<string, { qty: number; fee: number; classId: string }> = {};

    for (const line of registrationLines) {
      const classId = (line as any)?.classId;
      const qty = Number((line as any)?.qty ?? 0);
      if (!classId || typeof classId !== "string") {
        return badRequest("Invalid class selection", { code: "invalid_class", field: "classId" });
      }
      if (!(qty > 0)) {
        return badRequest("Invalid class qty", { code: "invalid_class_qty", field: "qty" });
      }
      const eventLine = eventLines.find((el: any) => (el as any)?.classId === classId);
      if (!eventLine) {
        return badRequest("Class not in event", { code: "class_not_in_event" });
      }
      const lineId = (eventLine as any)?.id;
      if (!lineId || typeof lineId !== "string") {
        return badRequest("Event line missing id", { code: "event_line_not_found" });
      }
      const fee = Number((eventLine as any)?.fee ?? 0) || 0;
      const prev = requestedClassPerLine[lineId] || { qty: 0, fee, classId };
      requestedClassPerLine[lineId] = { qty: prev.qty + qty, fee, classId };
    }
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
    if (stallQty > 0) {
      if (!stallEnabled) {
        return conflictError("Stall reservation not enabled for this event", { code: "stall_not_enabled" });
      }
      if (!(stallUnitAmount > 0)) {
        return conflictError("Stall pricing not configured for this event", { code: "stall_pricing_missing" });
      }
      const amount = stallQty * stallUnitAmount;
      computedFees.push({ key: "stall", label: "Stall", qty: stallQty, unitAmount: stallUnitAmount, amount, currency: "usd" });
    }

    for (const [lineId, info] of Object.entries(requestedClassPerLine)) {
      const amount = info.qty * info.fee;
      computedFees.push({ key: `class:${lineId}`, label: `Class ${info.classId}`, qty: info.qty, unitAmount: info.fee, amount, currency: "usd" });
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

    // Reserve stall capacity if requested; if it fails, release seat and RV and surface error
    if (stallQty > 0) {
      try {
        await reserveEventStalls({ tenantId, eventId: (registration as any).eventId, qty: stallQty });
      } catch (err: any) {
        if (err?.code === "stall_capacity_full") {
          try { await releaseEventSeat({ tenantId, eventId: (registration as any).eventId }); } catch (_) {}
          if (rvQty > 0) {
            try { await releaseEventRv({ tenantId, eventId: (registration as any).eventId, qty: rvQty }); } catch (_) {}
          }
          return conflictError("Stall capacity full", { code: "stall_capacity_full" });
        }
        // Unknown error; release seat and RV and propagate
        try { await releaseEventSeat({ tenantId, eventId: (registration as any).eventId }); } catch (_) {}
        if (rvQty > 0) {
          try { await releaseEventRv({ tenantId, eventId: (registration as any).eventId, qty: rvQty }); } catch (_) {}
        }
        throw err;
      }
    }

    const reservedClassDeltas: Array<{ lineId: string; qty: number }> = [];

    // Reserve class capacities and create per-line block holds (idempotent)
    try {
      if (Object.keys(requestedClassPerLine).length > 0) {
        const classBlocksPage = await listObjects({
          tenantId,
          type: "reservationHold",
          filters: {
            ownerType: "registration",
            ownerId: String((registration as any).id),
            scopeType: "event",
            scopeId: String((registration as any).eventId),
            itemType: "class_entry",
          },
          limit: 200,
          fields: ["id", "state", "qty", "resourceId", "metadata", "heldAt"],
        });

        const existingBlocks = (classBlocksPage.items as any[]) || [];
        const blockByLine: Record<string, any> = {};
        for (const b of existingBlocks) {
          if ((b as any)?.resourceId) continue;
          const lid = (b as any)?.metadata?.eventLineId;
          if (!lid) continue;
          // prefer confirmed over held
          const current = blockByLine[lid];
          if (!current || String(current.state) === "held") {
            blockByLine[lid] = b;
          }
        }

        for (const [lineId, info] of Object.entries(requestedClassPerLine)) {
          const block = blockByLine[lineId];
          const existingQty = block ? Number((block as any)?.qty ?? 0) || 0 : 0;
          if (block && existingQty !== info.qty) {
            throw Object.assign(new Error("Block hold qty mismatch"), { code: "qty_mismatch", statusCode: 400 });
          }

          const delta = Math.max(0, info.qty - existingQty);
          if (delta > 0) {
            await reserveEventLineCapacity({ tenantId, eventId: (registration as any).eventId, lineId, qty: delta });
            reservedClassDeltas.push({ lineId, qty: delta });
          }

          if (!block) {
            await createHeldClassBlockHold({
              tenantId,
              registrationId: (registration as any).id,
              eventId: (registration as any).eventId,
              eventLineId: lineId,
              qty: info.qty,
              expiresAt: holdExpiresAt,
            });
          }
        }

        // Consistency check: verify all requested class entries have corresponding held block holds
        const classHoldsVerify = await listObjects({
          tenantId,
          type: "reservationHold",
          filters: {
            ownerType: "registration",
            ownerId: String((registration as any).id),
            scopeType: "event",
            scopeId: String((registration as any).eventId),
            itemType: "class_entry",
          },
          limit: 200,
          fields: ["id", "state", "qty", "resourceId", "metadata"],
        });

        const verifyHolds = (classHoldsVerify.items as any[]) || [];
        for (const [lineId, info] of Object.entries(requestedClassPerLine)) {
          const blockHold = verifyHolds.find((h: any) => 
            !h.resourceId && 
            (h.metadata as any)?.eventLineId === lineId && 
            (String(h.state) === "held" || String(h.state) === "confirmed")
          );
          if (!blockHold) {
            throw Object.assign(
              new Error(`Block hold missing for line ${lineId}`),
              { code: "block_hold_missing", statusCode: 500, lineId, availableHolds: verifyHolds.map((h: any) => ({ id: h.id, state: h.state, resourceId: h.resourceId, eventLineId: (h.metadata as any)?.eventLineId })) }
            );
          }
        }
      }

      // Create reservation holds for ledger tracking (only after seat, RV, stall, and class lines succeed)
      await createHeldReservationHold({
        tenantId,
        ownerType: "registration",
        ownerId: (registration as any).id,
        scopeType: "event",
        scopeId: (registration as any).eventId,
        itemType: "seat",
        qty: 1,
        expiresAt: holdExpiresAt,
        event,
      });

      if (rvQty > 0) {
        await createHeldReservationHold({
          tenantId,
          ownerType: "registration",
          ownerId: (registration as any).id,
          scopeType: "event",
          scopeId: (registration as any).eventId,
          itemType: "rv",
          qty: rvQty,
          expiresAt: holdExpiresAt,
          event,
        });
      }

      if (stallQty > 0) {
        await createHeldStallBlockHold({
          tenantId,
          registrationId: (registration as any).id,
          eventId: (registration as any).eventId,
          qty: stallQty,
          expiresAt: holdExpiresAt,
        });
      }
    } catch (err: any) {
      // If hold creation or class reservation fails, release counters to be safe
      try { await releaseEventSeat({ tenantId, eventId: (registration as any).eventId }); } catch (_) {}
      if (rvQty > 0) {
        try { await releaseEventRv({ tenantId, eventId: (registration as any).eventId, qty: rvQty }); } catch (_) {}
      }
      if (stallQty > 0) {
        try { await releaseEventStalls({ tenantId, eventId: (registration as any).eventId, qty: stallQty }); } catch (_) {}
      }
      for (const delta of reservedClassDeltas) {
        try { await releaseEventLineCapacity({ tenantId, eventId: (registration as any).eventId, lineId: delta.lineId, qty: delta.qty }); } catch (_) {}
      }
      throw err;
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
    // Map custom error statusCodes to appropriate responses
    if (err?.statusCode === 409 && err?.code === "class_capacity_full") {
      return {
        statusCode: 409,
        headers: {
          "content-type": "application/json",
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
          "access-control-allow-headers": "content-type,x-tenant-id,Idempotency-Key"
        },
        body: JSON.stringify({ code: "class_capacity_full", message: err.message || "Class capacity full" }),
      };
    }
    if (err?.statusCode === 409) {
      return conflictError(err.message || "Conflict", { code: err?.code });
    }
    if (err?.statusCode === 400) {
      return badRequest(err.message || "Bad Request", { code: err?.code });
    }
    if (err?.statusCode === 404) {
      return notFound(err.message || "Not Found");
    }
    return respondError(err);
  }
}
