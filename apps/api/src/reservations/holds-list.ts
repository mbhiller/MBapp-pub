// apps/api/src/reservations/holds-list.ts
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { ok, badRequest, error as respondError } from "../common/responses";
import { getAuth, requirePerm } from "../auth/middleware";
import { listObjects } from "../objects/repo";

export async function handle(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  try {
    const auth = await getAuth(event);
    requirePerm(auth, "registration:read");

    const qs = event.queryStringParameters || {};
    const ownerType = String(qs.ownerType || "").trim();
    const ownerId = String(qs.ownerId || "").trim();
    const next = typeof qs.next === "string" ? qs.next : undefined;

    if (!ownerType) return badRequest("Missing ownerType");
    if (!ownerId) return badRequest("Missing ownerId");

    const rawLimit = qs.limit ? parseInt(String(qs.limit), 10) : 50;
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(rawLimit, 200)) : 50;

    const stateCsv = (qs.states ?? qs.state ?? "") as string;
    const states = String(stateCsv)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const page = await listObjects({
      tenantId: auth.tenantId,
      type: "reservationHold",
      filters: { ownerType, ownerId },
      limit,
      next,
    });

    const items = Array.isArray(page.items) ? page.items : [];
    const filtered = states.length > 0
      ? items.filter((it: any) => states.includes(String(it?.state ?? "")))
      : items;

    return ok({ items: filtered, next: page.next ?? null });
  } catch (err: any) {
    return respondError(err);
  }
}
