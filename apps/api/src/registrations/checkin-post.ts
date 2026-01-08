import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ok, badRequest, notFound, error as respondError } from "../common/responses";
import { getTenantId } from "../common/env";
import { getObjectById, listObjects, updateObject } from "../objects/repo";
import { guardRegistrations } from "./feature";
import { computeCheckInStatus } from "./checkin-readiness";

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

    const registration = await getObjectById({
      tenantId,
      type: "registration",
      id,
      fields: [
        "id",
        "type",
        "status",
        "paymentStatus",
        "eventId",
        "stallQty",
        "rvQty",
        "lines",
        "checkInStatus",
        "checkInStatusIdempotencyKey",
        "checkInIdempotencyKey",
        "checkedInAt",
        "checkedInBy",
        "checkedInDeviceId",
      ],
    });

    if (!registration || (registration as any).type !== "registration") {
      return notFound("Registration not found");
    }

    const alreadyCheckedInAt = (registration as any).checkedInAt as string | undefined;
    if (alreadyCheckedInAt) {
      return ok(registration);
    }

    const storedIdem = (registration as any).checkInIdempotencyKey as string | undefined;
    // If same key but not checked in, continue to avoid stuck partials
    if (storedIdem && storedIdem !== idempotencyKey) {
      // Different idempotency key but not yet checked-in: continue processing
    }

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
        headers: { "content-type": "application/json", "access-control-allow-origin": "*", "access-control-allow-methods": "OPTIONS,GET,POST,PUT,DELETE", "access-control-allow-headers": "Authorization,Content-Type,Idempotency-Key,X-Tenant-Id,Accept" },
        body: JSON.stringify({
          code: "checkin_blocked",
          message: "Registration is not ready to check in",
          checkInStatus: snapshot,
        }),
      };
    }

    const actorId = (event.requestContext as any)?.authorizer?.mbapp?.userId || null;
    const nowIso = new Date().toISOString();

    const body: Record<string, any> = {
      checkedInAt: nowIso,
      checkedInBy: actorId,
      checkedInDeviceId: (registration as any).checkedInDeviceId || null,
      checkInIdempotencyKey: idempotencyKey,
      checkInStatus: snapshot,
    };

    try {
      const updated = await updateObject({ tenantId, type: "registration", id, body });
      return ok(updated);
    } catch (err: any) {
      // If concurrent update set checkedInAt, re-read and return
      const reloaded = await getObjectById({ tenantId, type: "registration", id });
      if (reloaded && (reloaded as any).checkedInAt) {
        return ok(reloaded);
      }
      throw err;
    }
  } catch (err: any) {
    return respondError(err);
  }
}
