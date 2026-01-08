import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ok, badRequest, notFound, error as respondError } from "../common/responses";
import { getTenantId } from "../common/env";
import { getObjectById, listObjects } from "../objects/repo";
import { guardRegistrations } from "./feature";
import { computeCheckInStatus } from "./checkin-readiness";

export async function handle(event: APIGatewayProxyEventV2) {
  try {
    const guard = guardRegistrations(event);
    if (guard) return guard;

    const tenantId = getTenantId(event);
    const id = event.pathParameters?.id || "";
    if (!id) return badRequest("Missing registration id", { field: "id" });

    const registration = await getObjectById({
      tenantId,
      type: "registration",
      id,
      fields: [
        "id",
        "type",
        "status",
        "paymentStatus",
        "stallQty",
        "rvQty",
        "lines",
        "checkInStatus",
      ],
    });

    if (!registration || (registration as any).type !== "registration") {
      return notFound("Registration not found");
    }

    const holdsPage = await listObjects({
      tenantId,
      type: "reservationHold",
      filters: { ownerType: "registration", ownerId: id },
      limit: 200,
      fields: ["id", "itemType", "resourceId", "state"],
    });
    const holds = ((holdsPage.items as any[]) || []) as any[];

    const snapshot = computeCheckInStatus({ tenantId, registration: registration as any, holds: holds as any });
    return ok(snapshot);
  } catch (err: any) {
    return respondError(err);
  }
}
