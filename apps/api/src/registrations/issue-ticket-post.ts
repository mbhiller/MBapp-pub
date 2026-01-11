import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ok, badRequest, notFound, error as respondError } from "../common/responses";
import { getTenantId } from "../common/env";
import { getObjectById, createObject, listObjects } from "../objects/repo";
import { guardRegistrations } from "./feature";
import { computeCheckInStatus } from "./checkin-readiness";
import { REGISTRATION_PAYMENT_STATUS } from "./constants";
import { createHash } from "crypto";

export async function handle(event: APIGatewayProxyEventV2) {
  try {
    const guard = guardRegistrations(event);
    if (guard) return guard;

    const tenantId = getTenantId(event);
    const id = event.pathParameters?.id || "";
    if (!id) return badRequest("Missing registration id", { field: "id" });

    const incomingIdem = event.headers?.["idempotency-key"] || event.headers?.["Idempotency-Key"];
    const idempotencyKey = typeof incomingIdem === "string" && incomingIdem.trim() ? incomingIdem.trim() : undefined;
    if (!idempotencyKey) {
      return badRequest("Missing Idempotency-Key header", { code: "missing_idempotency_key" });
    }

    let ticketType = "admission";
    if (event.body) {
      try {
        const body = JSON.parse(event.body);
        if (body.ticketType) {
          ticketType = String(body.ticketType).trim();
          if (!["admission", "staff", "vendor", "vip"].includes(ticketType)) {
            return badRequest("Invalid ticketType", { field: "ticketType" });
          }
        }
      } catch (err: any) {
        if (err instanceof SyntaxError) {
          return badRequest("Invalid JSON in request body", { error: err.message });
        }
        throw err;
      }
    }

    const registration = await getObjectById({
      tenantId,
      type: "registration",
      id,
      fields: [
        "id",
        "type",
        "partyId",
        "eventId",
        "paymentStatus",
        "checkedInAt",
        "status",
        "stallQty",
        "rvQty",
        "lines",
      ],
    });

    if (!registration || (registration as any).type !== "registration") {
      return notFound("Registration not found");
    }

    const partyId = (registration as any).partyId as string | undefined;
    if (!partyId) {
      return {
        statusCode: 409,
        headers: {
          "content-type": "application/json",
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "OPTIONS,GET,POST,PUT,DELETE",
          "access-control-allow-headers": "Authorization,Content-Type,Idempotency-Key,X-Tenant-Id,Accept",
        },
        body: JSON.stringify({
          code: "party_missing",
          message: "Registration has no party; cannot issue ticket",
        }),
      };
    }

    const rawPaymentStatus = (registration as any).paymentStatus as string | undefined;
    const paymentStatus = rawPaymentStatus === "succeeded" ? REGISTRATION_PAYMENT_STATUS.paid : rawPaymentStatus;
    if (paymentStatus !== REGISTRATION_PAYMENT_STATUS.paid) {
      return {
        statusCode: 409,
        headers: {
          "content-type": "application/json",
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "OPTIONS,GET,POST,PUT,DELETE",
          "access-control-allow-headers": "Authorization,Content-Type,Idempotency-Key,X-Tenant-Id,Accept",
        },
        body: JSON.stringify({
          code: "payment_unpaid",
          message: "Registration payment is not completed; cannot issue ticket",
        }),
      };
    }

    // E5: Guard - must be checked in (align with badge issuance)
    const checkedInAt = (registration as any).checkedInAt as string | undefined;
    if (!checkedInAt) {
      return {
        statusCode: 409,
        headers: {
          "content-type": "application/json",
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "OPTIONS,GET,POST,PUT,DELETE",
          "access-control-allow-headers": "Authorization,Content-Type,Idempotency-Key,X-Tenant-Id,Accept",
        },
        body: JSON.stringify({
          code: "not_checked_in",
          message: "Registration must be checked in before ticket can be issued",
        }),
      };
    }

    // E5: Guard - must be ready (align with badge issuance)
    const holdsPage = await listObjects({
      tenantId,
      type: "reservationHold",
      filters: { ownerType: "registration", ownerId: id },
      limit: 200,
      fields: ["id", "itemType", "resourceId", "state", "qty", "metadata"],
    });
    const holds = ((holdsPage.items as any[]) || []) as any[];

    const snapshot = computeCheckInStatus({ tenantId, registration: registration as any, holds: holds as any });

    if (!snapshot.ready) {
      return {
        statusCode: 409,
        headers: {
          "content-type": "application/json",
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "OPTIONS,GET,POST,PUT,DELETE",
          "access-control-allow-headers": "Authorization,Content-Type,Idempotency-Key,X-Tenant-Id,Accept",
        },
        body: JSON.stringify({
          code: "checkin_blocked",
          message: "Registration is blocked from ticket issuance due to blockers",
          checkInStatus: snapshot,
        }),
      };
    }

    const eventId = (registration as any).eventId as string;
    const idemPayload = `${id}|${ticketType}|${idempotencyKey}`;
    const hash = createHash("sha256").update(idemPayload).digest("hex").substring(0, 12);
    const ticketId = `ticket_${hash}`;

    const existing = await getObjectById({ tenantId, type: "ticket", id: ticketId });
    if (existing && (existing as any).id === ticketId) {
      return ok({ ticket: existing });
    }

    const actorId = (event.requestContext as any)?.authorizer?.mbapp?.userId || null;
    const nowIso = new Date().toISOString();
    const qrText = `ticket|${eventId}|${id}|${ticketId}`;

    const ticket: Record<string, any> = {
      id: ticketId,
      type: "ticket",
      eventId,
      registrationId: id,
      partyId,
      ticketType,
      status: "valid",
      issuedAt: nowIso,
      issuedBy: actorId,
      usedAt: null,
      usedBy: null,
      cancelledAt: null,
      payload: {
        qrText,
        barcodeText: null,
      },
      notes: null,
    };

    const created = await createObject({ tenantId, type: "ticket", body: ticket });
    return ok({ ticket: created });
  } catch (err: any) {
    return respondError(err);
  }
}