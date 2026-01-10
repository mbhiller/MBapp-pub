// apps/api/src/events/public-detail-get.ts
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ok, notFound, error } from "../common/responses";
import { getObjectById } from "../objects/repo";
import { getTenantId } from "../common/env";

/**
 * GET /events/{id}:public
 * Public endpoint: get event detail by ID
 * No auth required, but respects tenant isolation via X-Tenant-Id header
 */
export async function handle(event: APIGatewayProxyEventV2) {
  try {
    const tenantId = getTenantId(event);
    const id = event.pathParameters?.id;

    if (!id) {
      return notFound("Event not found");
    }

    const obj = await getObjectById({
      tenantId,
      type: "event",
      id,
      fields: [
        "id",
        "name",
        "description",
        "status",
        "startsAt",
        "endsAt",
        "capacity",
        "reservedCount",
        "rvEnabled",
        "rvCapacity",
        "rvUnitAmount",
        "rvReserved",
        "createdAt",
      ],
    });

    if (!obj) {
      return notFound("Event not found");
    }

    return ok(obj);
  } catch (e: any) {
    return error(e);
  }
}
