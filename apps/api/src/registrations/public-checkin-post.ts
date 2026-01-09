import type { APIGatewayProxyEventV2 } from "aws-lambda";
import crypto from "crypto";
import { ok, badRequest, notFound, unauthorized, internalError } from "../common/responses";
import { getTenantId } from "../common/env";
import { getObjectById, listObjects, updateObject } from "../objects/repo";
import { guardRegistrations } from "./feature";
import { computeCheckInStatus } from "./checkin-readiness";

function constantTimeEqual(a: string, b: string) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

const MESSAGE_FIELDS = ["status", "sentAt", "provider", "errorMessage"] as const;

export async function handle(event: APIGatewayProxyEventV2) {
  try {
    const guard = guardRegistrations(event);
    if (guard) return guard;

    const tenantId = getTenantId(event);
    if (!tenantId) {
      return badRequest("tenantId is required", { field: "tenantId" });
    }

    const id = event.pathParameters?.id;
    if (!id) {
      return badRequest("id is required", { field: "id" });
    }

    // Require Idempotency-Key header (consistent with operator check-in)
    const incomingIdem = event.headers?.["idempotency-key"] || event.headers?.["Idempotency-Key"];
    const idempotencyKey = typeof incomingIdem === "string" && incomingIdem.trim() ? incomingIdem.trim() : undefined;
    if (!idempotencyKey) {
      return badRequest("Missing Idempotency-Key header", { code: "missing_idempotency_key" });
    }

    // Validate public token header
    const tokenHeader = event.headers?.["x-mbapp-public-token"] || event.headers?.["X-MBapp-Public-Token"];
    if (!tokenHeader || typeof tokenHeader !== "string") {
      return unauthorized("Invalid or missing public token");
    }

    // Load registration
    const registration = await getObjectById({
      tenantId,
      type: "registration",
      id,
      fields: [
        "id",
        "type",
        "eventId",
        "status",
        "paymentStatus",
        "submittedAt",
        "confirmedAt",
        "cancelledAt",
        "refundedAt",
        "holdExpiresAt",
        "publicTokenHash",
        "confirmationMessageId",
        "confirmationSmsMessageId",
        "checkInStatus",
        "stallQty",
        "rvQty",
        "lines",
        "checkedInAt",
        "checkedInBy",
        "checkInIdempotencyKey",
      ],
    });

    if (!registration || (registration as any).type !== "registration") {
      return notFound("Registration not found");
    }

    // Validate public token using timing-safe comparison
    const expectedHash = (registration as any).publicTokenHash as string | undefined;
    if (!expectedHash) {
      return unauthorized("Invalid or missing public token");
    }

    const providedHash = crypto.createHash("sha256").update(tokenHeader).digest("hex");
    if (!constantTimeEqual(expectedHash, providedHash)) {
      return unauthorized("Invalid or missing public token");
    }

    // If already checked in, return idempotent response (do not mutate)
    const alreadyCheckedInAt = (registration as any).checkedInAt as string | undefined;
    if (alreadyCheckedInAt) {
      return ok(await buildPublicResponse(tenantId, registration as any, id));
    }

    // Fetch holds and compute readiness
    const holdsPage = await listObjects({
      tenantId,
      type: "reservationHold",
      filters: { ownerType: "registration", ownerId: id },
      limit: 200,
      fields: ["id", "itemType", "resourceId", "state", "qty", "metadata"],
    });
    const holds = ((holdsPage.items as any[]) || []) as any[];

    const snapshot = computeCheckInStatus({ tenantId, registration: registration as any, holds: holds as any });

    // If not ready, return 409 with blockers
    if (!snapshot.ready) {
      return {
        statusCode: 409,
        headers: {
          "content-type": "application/json",
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "OPTIONS,GET,POST,PUT,DELETE",
          "access-control-allow-headers": "Authorization,Content-Type,Idempotency-Key,X-Tenant-Id,X-MBapp-Public-Token,Accept",
        },
        body: JSON.stringify({
          code: "checkin_blocked",
          message: "Registration is not ready to check in",
          checkInStatus: snapshot,
        }),
      };
    }

    // Perform check-in mutation
    const nowIso = new Date().toISOString();

    const body: Record<string, any> = {
      checkedInAt: nowIso,
      checkedInBy: "public-magic-link",
      checkedInDeviceId: null,
      checkInIdempotencyKey: idempotencyKey,
      checkInStatus: snapshot,
    };

    try {
      const updated = await updateObject({ tenantId, type: "registration", id, body });
      return ok(await buildPublicResponse(tenantId, updated as any, id));
    } catch (err: any) {
      // If concurrent update set checkedInAt, re-read and return
      const reloaded = await getObjectById({ tenantId, type: "registration", id });
      if (reloaded && (reloaded as any).checkedInAt) {
        return ok(await buildPublicResponse(tenantId, reloaded as any, id));
      }
      throw err;
    }
  } catch (e: any) {
    return internalError(e);
  }
}

/**
 * Build a safe public response (mirrors GET /registrations/{id}:public structure)
 */
async function buildPublicResponse(tenantId: string, registration: any, id: string) {
  // Load message statuses if present
  const confirmationMessageId = registration.confirmationMessageId as unknown;
  const confirmationSmsMessageId = registration.confirmationSmsMessageId as unknown;

  const emailStatus = await loadMessageStatus(tenantId, confirmationMessageId);
  const smsStatus = await loadMessageStatus(tenantId, confirmationSmsMessageId);

  // Normalize payment status
  const rawPaymentStatus = registration.paymentStatus as string | undefined;
  const paymentStatus = rawPaymentStatus === "succeeded" ? "paid" : rawPaymentStatus;

  // Load or compute checkInStatus
  let checkInStatus = registration.checkInStatus || null;

  if (!checkInStatus) {
    // Compute fresh snapshot if not persisted
    const holdsPage = await listObjects({
      tenantId,
      type: "reservationHold",
      filters: { ownerType: "registration", ownerId: id },
      limit: 200,
      fields: ["id", "itemType", "resourceId", "state"],
    });
    const holds = ((holdsPage.items as any[]) || []) as any[];

    checkInStatus = computeCheckInStatus({ tenantId, registration, holds: holds as any });
  }

  return {
    id: registration.id,
    eventId: registration.eventId,
    status: registration.status,
    paymentStatus,
    submittedAt: registration.submittedAt,
    confirmedAt: registration.confirmedAt,
    cancelledAt: registration.cancelledAt,
    refundedAt: registration.refundedAt,
    holdExpiresAt: registration.holdExpiresAt,
    checkedInAt: registration.checkedInAt,
    checkedInBy: registration.checkedInBy,
    checkInStatus,
    emailStatus,
    smsStatus,
  };
}

async function loadMessageStatus(tenantId: string, messageId: unknown) {
  if (typeof messageId !== "string" || !messageId) return null;
  const msg = await getObjectById({
    tenantId,
    type: "message",
    id: messageId,
    fields: MESSAGE_FIELDS as unknown as string[],
  });
  if (!msg) return null;
  return {
    status: (msg as any).status,
    sentAt: (msg as any).sentAt,
    provider: (msg as any).provider,
    errorMessage: (msg as any).errorMessage,
  };
}
