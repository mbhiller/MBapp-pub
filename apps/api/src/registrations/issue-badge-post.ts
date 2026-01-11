import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ok, badRequest, notFound, error as respondError } from "../common/responses";
import { getTenantId } from "../common/env";
import { getObjectById, listObjects, createObject } from "../objects/repo";
import { guardRegistrations } from "./feature";
import { computeCheckInStatus } from "./checkin-readiness";
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

    // Parse request body
    let badgeType = "admission";
    if (event.body) {
      try {
        const body = JSON.parse(event.body);
        if (body.badgeType) {
          badgeType = String(body.badgeType).trim();
          if (!["admission", "staff", "vendor", "vip"].includes(badgeType)) {
            return badRequest("Invalid badgeType", { field: "badgeType" });
          }
        }
      } catch (err: any) {
        if (err instanceof SyntaxError) {
          return badRequest("Invalid JSON in request body", { error: err.message });
        }
        throw err;
      }
    }

    // Load registration
    const registration = await getObjectById({
      tenantId,
      type: "registration",
      id,
      fields: [
        "id",
        "type",
        "status",
        "eventId",
        "partyId",
        "paymentStatus",
        "checkedInAt",
        "stallQty",
        "rvQty",
        "lines",
      ],
    });

    if (!registration || (registration as any).type !== "registration") {
      return notFound("Registration not found");
    }

    // Guard 0: Registration must have a party ID (no anonymous/public registrations)
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
          message: "Registration has no party; cannot issue badge",
        }),
      };
    }

    // Guard 1: Must be checked in
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
          message: "Registration must be checked in before badge can be issued",
        }),
      };
    }

    // Guard 2: Recompute readiness, must be ready
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
          message: "Registration is blocked from badge issuance due to payment or other checks",
          checkInStatus: snapshot,
        }),
      };
    }

    // Capture audit info
    const actorId = (event.requestContext as any)?.authorizer?.mbapp?.userId || null;
    const nowIso = new Date().toISOString();

    // Generate deterministic issuance ID for idempotency
    // Hash of registrationId + badgeType + idempotencyKey
    const idemPayload = `${id}|${badgeType}|${idempotencyKey}`;
    const hash = createHash("sha256").update(idemPayload).digest("hex").substring(0, 12);
    const issuanceId = `badge_${hash}`;

    // Generate QR payload (simple MVP: no crypto)
    const qrText = `badge|${(registration as any).eventId}|${id}|${issuanceId}`;

    // Create BadgeIssuance object
    const badgeIssuance: Record<string, any> = {
      id: issuanceId,
      type: "badgeIssuance",
      registrationId: id,
      partyId: (registration as any).partyId,
      eventId: (registration as any).eventId,
      badgeType,
      issuedAt: nowIso,
      issuedBy: actorId,
      reprintCount: 0,
      lastPrintedAt: null,
      payload: {
        qrText,
      },
      printStatus: "not_printed",
    };

    const created = await createObject({
      tenantId,
      type: "badgeIssuance",
      body: badgeIssuance,
    });

    return ok({ issuance: created });
  } catch (err: any) {
    return respondError(err);
  }
}
