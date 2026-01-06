// apps/api/src/events/public-list.ts
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ok, badRequest, error } from "../common/responses";
import { listObjects } from "../objects/repo";
import { getTenantId } from "../common/env";

/**
 * GET /events:public
 * Public endpoint: list events filtered by status (default: open)
 * No auth required, but respects tenant isolation via X-Tenant-Id header
 */
export async function handle(event: APIGatewayProxyEventV2) {
  try {
    const tenantId = getTenantId(event);
    const params = event.queryStringParameters || {};
    
    // Default to listing only "open" events for public consumption
    const status = params.status || "open";
    
    // Build filters
    const filters: Record<string, string> = {};
    if (status) {
      filters.status = status;
    }

    // Pagination support
    const limit = params.limit ? parseInt(params.limit, 10) : 50;
    const next = params.next;

    const result = await listObjects({
      tenantId,
      type: "event",
      filters,
      next,
      limit: Math.min(limit, 100), // Cap at 100 for public API
      fields: [
        "id",
        "name",
        "description",
        "status",
        "startsAt",
        "endsAt",
        "capacity",
        "reservedCount",
        "createdAt",
      ],
    });

    return ok(result);
  } catch (e: any) {
    return error(e);
  }
}
