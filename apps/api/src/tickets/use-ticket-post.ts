import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ok, badRequest, notFound, error as respondError } from "../common/responses";
import { getTenantId } from "../common/env";
import { getObjectById, updateObject } from "../objects/repo";
import { guardRegistrations } from "../registrations/feature";

export async function handle(event: APIGatewayProxyEventV2) {
  try {
    const guard = guardRegistrations(event);
    if (guard) return guard;

    const tenantId = getTenantId(event);
    const id = event.pathParameters?.id || "";
    if (!id) return badRequest("Missing ticket id", { field: "id" });

    const incomingIdem = event.headers?.["idempotency-key"] || event.headers?.["Idempotency-Key"];
    const idempotencyKey = typeof incomingIdem === "string" && incomingIdem.trim() ? incomingIdem.trim() : undefined;
    if (!idempotencyKey) {
      return badRequest("Missing Idempotency-Key header", { code: "missing_idempotency_key" });
    }

    // Load ticket
    const ticket = await getObjectById({
      tenantId,
      type: "ticket",
      id,
      fields: [
        "id",
        "type",
        "status",
        "registrationId",
        "usedAt",
        "usedBy",
        "useIdempotencyKey",
      ],
    });

    if (!ticket || (ticket as any).type !== "ticket") {
      return notFound("Ticket not found");
    }

    const status = String((ticket as any).status || "").trim();
    const storedUseKey = (ticket as any).useIdempotencyKey as string | undefined;
    if (status === "used") {
      if (storedUseKey && storedUseKey === idempotencyKey) {
        // Idempotent replay: return current ticket as 200
        return ok({ ticket });
      }
      // Already used with a different key → conflict
      return {
        statusCode: 409,
        headers: {
          "content-type": "application/json",
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "OPTIONS,GET,POST,PUT,DELETE",
          "access-control-allow-headers": "Authorization,Content-Type,Idempotency-Key,X-Tenant-Id,Accept",
        },
        body: JSON.stringify({
          code: "ticket_already_used",
          message: "Ticket has already been used",
          details: { ticketStatus: status },
        }),
      };
    }

    if (status !== "valid") {
      return {
        statusCode: 409,
        headers: {
          "content-type": "application/json",
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "OPTIONS,GET,POST,PUT,DELETE",
          "access-control-allow-headers": "Authorization,Content-Type,Idempotency-Key,X-Tenant-Id,Accept",
        },
        body: JSON.stringify({
          code: "ticket_not_valid",
          message: "Ticket is not valid for admission",
          details: { ticketStatus: status },
        }),
      };
    }

    const regId = (ticket as any).registrationId as string | undefined;
    if (!regId) {
      return notFound("Registration not found");
    }

    // Load registration to enforce checked-in guard
    const registration = await getObjectById({
      tenantId,
      type: "registration",
      id: regId,
      fields: ["id", "type", "checkedInAt", "status"],
    });

    if (!registration || (registration as any).type !== "registration") {
      return notFound("Registration not found");
    }

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
          code: "registration_not_checkedin",
          message: "Registration must be checked in before ticket can be used",
          details: { registrationStatus: (registration as any).status },
        }),
      };
    }

    const actorId = (event.requestContext as any)?.authorizer?.mbapp?.userId || null;
    const nowIso = new Date().toISOString();

    const body: Record<string, any> = {
      status: "used",
      usedAt: nowIso,
      usedBy: actorId,
      useIdempotencyKey: idempotencyKey,
    };

    try {
      const updated = await updateObject({ tenantId, type: "ticket", id, body });
      return ok({ ticket: updated });
    } catch (err: any) {
      // In case of a race, re-read and apply idempotency semantics
      const reloaded = await getObjectById({ tenantId, type: "ticket", id });
      const s = String((reloaded as any)?.status || "");
      const k = (reloaded as any)?.useIdempotencyKey as string | undefined;
      if (s === "used" && k && k === idempotencyKey) return ok({ ticket: reloaded });
      if (s === "used") {
        return {
          statusCode: 409,
          headers: {
            "content-type": "application/json",
            "access-control-allow-origin": "*",
            "access-control-allow-methods": "OPTIONS,GET,POST,PUT,DELETE",
            "access-control-allow-headers": "Authorization,Content-Type,Idempotency-Key,X-Tenant-Id,Accept",
          },
          body: JSON.stringify({ code: "ticket_already_used", message: "Ticket has already been used" }),
        };
      }
      throw err;
    }
  } catch (err: any) {
    return respondError(err);
  }
}
