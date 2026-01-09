import type { APIGatewayProxyEventV2 } from "aws-lambda";
import crypto from "crypto";
import { ok, badRequest, notFound, unauthorized, internalError } from "../common/responses";
import { getTenantId } from "../common/env";
import { getObjectById, listObjects } from "../objects/repo";
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

    const tokenHeader = event.headers?.["x-mbapp-public-token"] || event.headers?.["X-MBapp-Public-Token"];
    if (!tokenHeader || typeof tokenHeader !== "string") {
      return unauthorized("Missing X-MBapp-Public-Token");
    }

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
      ],
    });

    if (!registration || (registration as any).type !== "registration") {
      return notFound("Not Found");
    }

    const expectedHash = (registration as any).publicTokenHash as string | undefined;
    if (!expectedHash) {
      return unauthorized("Invalid public token");
    }

    const providedHash = crypto.createHash("sha256").update(tokenHeader).digest("hex");
    if (!constantTimeEqual(expectedHash, providedHash)) {
      return unauthorized("Invalid public token");
    }

    const confirmationMessageId = (registration as any).confirmationMessageId as unknown;
    const confirmationSmsMessageId = (registration as any).confirmationSmsMessageId as unknown;

    const emailStatus = await loadMessageStatus(tenantId, confirmationMessageId);
    const smsStatus = await loadMessageStatus(tenantId, confirmationSmsMessageId);

    const rawPaymentStatus = (registration as any).paymentStatus as string | undefined;
    const paymentStatus = rawPaymentStatus === "succeeded" ? "paid" : rawPaymentStatus;

    // Load or compute checkInStatus
    let checkInStatus = (registration as any).checkInStatus || null;
    
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
      
      checkInStatus = computeCheckInStatus({ 
        tenantId, 
        registration: registration as any, 
        holds: holds as any 
      });
    }

    return ok({
      id: (registration as any).id,
      eventId: (registration as any).eventId,
      status: (registration as any).status,
      paymentStatus,
      submittedAt: (registration as any).submittedAt,
      confirmedAt: (registration as any).confirmedAt,
      cancelledAt: (registration as any).cancelledAt,
      refundedAt: (registration as any).refundedAt,
      holdExpiresAt: (registration as any).holdExpiresAt,
      checkInStatus,
      emailStatus,
      smsStatus,
    });
  } catch (e: any) {
    return internalError(e);
  }
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
