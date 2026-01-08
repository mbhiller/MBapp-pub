// apps/api/src/registrations/public-create.ts
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import crypto from "crypto";
import { ok, badRequest, error, forbidden } from "../common/responses";
import { createObject, getObjectById } from "../objects/repo";
import { getTenantId } from "../common/env";
import { guardRegistrations } from "./feature";

/**
 * POST /registrations:public
 * Public endpoint: create a registration without JWT auth
 * Generates a cryptographically secure publicToken for guest checkout
 * Stores SHA256 hash on registration object
 */
export async function handle(event: APIGatewayProxyEventV2) {
  try {
    // Feature guard (respects X-Feature-Registrations-Enabled header in dev)
    const guard = guardRegistrations(event);
    if (guard) return guard;

    const tenantId = getTenantId(event);
    const body = JSON.parse(event.body || "{}");

    // Validate required fields
    if (!body.eventId || typeof body.eventId !== "string") {
      return badRequest("eventId is required and must be a string", { field: "eventId" });
    }

    // Verify event exists and is open
    const eventObj = await getObjectById({
      tenantId,
      type: "event",
      id: body.eventId,
      fields: ["id", "status", "name", "rvEnabled", "rvUnitAmount", "rvCapacity", "stallEnabled", "stallUnitAmount", "stallCapacity"],
    });

    if (!eventObj) {
      return badRequest("Event not found", { field: "eventId", code: "event_not_found" });
    }

    if ((eventObj as any).status !== "open") {
      return forbidden(
        `Event is not open for registration (status: ${(eventObj as any).status})`
      );
    }

    // rvQty (optional): validate and store (no reservation yet; that occurs at checkout)
    const rawRvQty = body.rvQty;
    let rvQty = 0;
    if (rawRvQty !== undefined && rawRvQty !== null) {
      if (typeof rawRvQty !== "number" || !Number.isInteger(rawRvQty)) {
        return badRequest("rvQty must be an integer", { field: "rvQty", code: "invalid_rvQty" });
      }
      if (rawRvQty < 0 || rawRvQty > 10) {
        return badRequest("rvQty must be between 0 and 10", { field: "rvQty", code: "invalid_rvQty_range" });
      }
      rvQty = rawRvQty;
    }

    if (rvQty > 0) {
      const rvEnabled = (eventObj as any)?.rvEnabled === true;
      const rvUnitAmount = (eventObj as any)?.rvUnitAmount as number | undefined;
      if (!rvEnabled) {
        return badRequest("RV add-on not enabled for this event", { field: "rvQty", code: "rv_not_enabled" });
      }
      if (!(typeof rvUnitAmount === "number" && rvUnitAmount > 0)) {
        return badRequest("RV unit amount not configured for this event", { field: "rvQty", code: "rv_pricing_missing" });
      }
      // Note: We do NOT reserve RV capacity at create time; reservation occurs at checkout submit.
    }

    // stallQty (optional): validate and store; reservation occurs at checkout
    const rawStallQty = body.stallQty;
    let stallQty = 0;
    if (rawStallQty !== undefined && rawStallQty !== null) {
      if (typeof rawStallQty !== "number" || !Number.isInteger(rawStallQty)) {
        return badRequest("stallQty must be an integer", { field: "stallQty", code: "invalid_stallQty" });
      }
      if (rawStallQty < 0 || rawStallQty > 50) {
        return badRequest("stallQty must be between 0 and 50", { field: "stallQty", code: "invalid_stallQty_range" });
      }
      stallQty = rawStallQty;
    }
    if (stallQty > 0) {
      const stallEnabled = (eventObj as any)?.stallEnabled === true;
      const stallUnitAmount = (eventObj as any)?.stallUnitAmount as number | undefined;
      if (!stallEnabled) {
        return badRequest("Stall add-on not enabled for this event", { field: "stallQty", code: "stall_not_enabled" });
      }
      if (!(typeof stallUnitAmount === "number" && stallUnitAmount > 0)) {
        return badRequest("Stall unit amount not configured for this event", { field: "stallQty", code: "stall_pricing_missing" });
      }
    }

    // lines (optional): class entry registrations; validation occurs at checkout
    const rawLines = body.lines;
    let lines: Array<{ classId: string; qty: number }> = [];
    if (rawLines !== undefined && rawLines !== null) {
      if (!Array.isArray(rawLines)) {
        return badRequest("lines must be an array", { field: "lines", code: "invalid_lines" });
      }
      for (const line of rawLines) {
        if (!line.classId || typeof line.classId !== "string") {
          return badRequest("each line must have a classId (string)", { field: "lines.classId" });
        }
        const qty = Number(line.qty ?? 0) || 0;
        if (!Number.isInteger(qty) || qty <= 0) {
          return badRequest("each line must have a qty > 0", { field: "lines.qty", code: "invalid_qty" });
        }
        lines.push({ classId: line.classId, qty });
      }
    }

    // Generate cryptographically secure public token (32 bytes = 64 hex chars)
    const publicToken = crypto.randomBytes(32).toString("hex");
    
    // Hash the token with SHA256 for storage (never store raw token)
    const publicTokenHash = crypto
      .createHash("sha256")
      .update(publicToken)
      .digest("hex");

    // Build registration object
    const registrationBody: any = {
      type: "registration",
      eventId: body.eventId,
      status: "draft",
      paymentStatus: "pending",
      publicTokenHash,
      submittedAt: null,
      confirmedAt: null,
    };

    // Persist rvQty and stallQty on registration
    registrationBody.rvQty = rvQty;
    registrationBody.stallQty = stallQty;

    // Persist class lines on registration
    if (lines.length > 0) {
      registrationBody.lines = lines;
    }

    // Optional party information (guest details)
    if (body.party) {
      registrationBody.party = body.party;
    }

    // Optional fees
    if (body.fees && Array.isArray(body.fees)) {
      // Validate fee structure
      for (const fee of body.fees) {
        if (!fee.code || typeof fee.code !== "string") {
          return badRequest("each fee must have a code (string)", { field: "fees.code" });
        }
        if (fee.amount === undefined || typeof fee.amount !== "number") {
          return badRequest("each fee must have an amount (number)", { field: "fees.amount" });
        }
      }
      registrationBody.fees = body.fees;
    }

    // Create registration
    const registration = await createObject({
      tenantId,
      type: "registration",
      body: registrationBody,
    });

    // Return registration with publicToken (token only returned this once)
    return ok(
      {
        registration,
        publicToken, // Client must store this for checkout
      },
      201
    );
  } catch (e: any) {
    return error(e);
  }
}
