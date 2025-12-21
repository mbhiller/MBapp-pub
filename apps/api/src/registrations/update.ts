import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ok, bad, error } from "../common/responses";
import { replaceObject } from "../objects/repo";
import { getAuth, requirePerm } from "../auth/middleware";

export async function handle(event: APIGatewayProxyEventV2) {
  try {
    const auth = await getAuth(event);
    const id = event.pathParameters?.id;

    if (!id) {
      return bad({ message: "id is required" });
    }

    requirePerm(auth, "registration:write");

    const body = JSON.parse(event.body || "{}");

    // Validate required fields per spec
    if (!body.eventId || typeof body.eventId !== "string") {
      return bad({ message: "eventId is required and must be a string" });
    }
    if (!body.partyId || typeof body.partyId !== "string") {
      return bad({ message: "partyId is required and must be a string" });
    }

    // Status is optional (defaults to 'draft' in schema)
    const status = body.status || "draft";
    if (!["draft", "submitted", "confirmed", "cancelled"].includes(status)) {
      return bad({ message: "status must be one of: draft, submitted, confirmed, cancelled" });
    }

    // Validate fees if provided
    if (body.fees && !Array.isArray(body.fees)) {
      return bad({ message: "fees must be an array" });
    }
    if (body.fees) {
      for (const fee of body.fees) {
        if (!fee.code || typeof fee.code !== "string") {
          return bad({ message: "each fee must have a code (string)" });
        }
        if (fee.amount === undefined || typeof fee.amount !== "number") {
          return bad({ message: "each fee must have an amount (number)" });
        }
      }
    }

    // Ensure type is set
    const registrationBody = {
      ...body,
      type: "registration",
      status,
    };

    const result = await replaceObject({
      tenantId: auth.tenantId,
      type: "registration",
      id,
      body: registrationBody,
    });

    return ok(result);
  } catch (e: any) {
    return error(e);
  }
}
