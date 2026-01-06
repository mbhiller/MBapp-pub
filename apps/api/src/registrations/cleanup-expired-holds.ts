// apps/api/src/registrations/cleanup-expired-holds.ts
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ok, error as respondError } from "../common/responses";
import { getTenantId } from "../common/env";
import { listObjects } from "../objects/repo";
import { guardRegistrations } from "./feature";
import { expireRegistrationHold } from "./expire-helper";

/**
 * POST /registrations:cleanup-expired-holds
 * Auth required; registration:write gated at router.
 * Bounded cleanup of submitted registrations past hold TTL.
 */
export async function handle(event: APIGatewayProxyEventV2) {
  try {
    const guard = guardRegistrations(event);
    if (guard) return guard;

    const tenantId = getTenantId(event)!;
    const qs = event.queryStringParameters || {};
    const rawLimit = qs.limit ? parseInt(String(qs.limit), 10) : 50;
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(rawLimit, 200)) : 50; // cap at 200

    // List submitted registrations (bounded by limit)
    const page = await listObjects({
      tenantId,
      type: "registration",
      filters: { status: "submitted" },
      limit,
      fields: ["id", "status", "holdExpiresAt", "eventId"],
    });

    const nowMs = Date.now();
    let expiredCount = 0;

    for (const item of (page.items as any[])) {
      const id = item?.id as string | undefined;
      const status = item?.status as string | undefined;
      const hold = item?.holdExpiresAt as string | undefined;
      const holdMs = hold ? new Date(hold).getTime() : undefined;
      if (!id || status !== "submitted") continue;
      if (holdMs === undefined || holdMs >= nowMs) continue;

      const res = await expireRegistrationHold({ tenantId, regId: id });
      if (res.expired) expiredCount += 1;
    }

    return ok({ expiredCount });
  } catch (e: any) {
    return respondError(e);
  }
}
