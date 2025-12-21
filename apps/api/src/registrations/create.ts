import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ok, badRequest, error } from "../common/responses";
import { createObject } from "../objects/repo";
import { getAuth, requirePerm } from "../auth/middleware";
import { guardRegistrations } from "./feature";

export async function handle(event: APIGatewayProxyEventV2) {
  try {
    const guard = guardRegistrations(event);
    if (guard) return guard;

    const auth = await getAuth(event);
    requirePerm(auth, "registration:write");

    const body = JSON.parse(event.body || "{}");

    // Validate required fields per spec
    if (!body.eventId || typeof body.eventId !== "string") {
      return badRequest("eventId is required and must be a string", { field: "eventId" });
    }
    if (!body.partyId || typeof body.partyId !== "string") {
      return badRequest("partyId is required and must be a string", { field: "partyId" });
    }

    // Status is optional (defaults to 'draft' in schema)
    const status = body.status || "draft";
    if (!["draft", "submitted", "confirmed", "cancelled"].includes(status)) {
      return badRequest("status must be one of: draft, submitted, confirmed, cancelled", { field: "status" });
    }

    // Validate fees if provided
    if (body.fees && !Array.isArray(body.fees)) {
      return badRequest("fees must be an array", { field: "fees" });
    }
    if (body.fees) {
      for (const fee of body.fees) {
        if (!fee.code || typeof fee.code !== "string") {
          return badRequest("each fee must have a code (string)", { field: "fees.code" });
        }
        if (fee.amount === undefined || typeof fee.amount !== "number") {
          return badRequest("each fee must have an amount (number)", { field: "fees.amount" });
        }
      }
    }

    // Ensure type is set
    const registrationBody = {
      ...body,
      type: "registration",
      status,
    };

    const result = await createObject({
      tenantId: auth.tenantId,
      type: "registration",
      body: registrationBody,
    });

    return ok(result, 201);
  } catch (e: any) {
    return error(e);
  }
}
