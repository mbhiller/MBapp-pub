import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ok, bad, error } from "../common/responses";
import { listObjects } from "../objects/repo";
import { getAuth, requirePerm } from "../auth/middleware";

export async function handle(event: APIGatewayProxyEventV2) {
  try {
    const auth = await getAuth(event);
    const qsp = event.queryStringParameters || {};
    
    const limit    = Number(qsp.limit ?? 50);
    const next     = qsp.next ?? undefined;
    const eventId  = qsp.eventId ?? undefined;
    const partyId  = qsp.partyId ?? undefined;
    const status   = qsp.status ?? undefined;
    const q        = qsp.q?.trim() || undefined;

    requirePerm(auth, "registration:read");

    // Get all registrations for tenant, then filter by optional params
    const page = await listObjects({ 
      tenantId: auth.tenantId, 
      type: "registration", 
      next, 
      limit 
    });

    // In-memory filtering for optional query params (keeps schema clean, no index overhead)
    const filtered = page.items.filter((item: any) => {
      if (eventId && item.eventId !== eventId) return false;
      if (partyId && item.partyId !== partyId) return false;
      if (status && item.status !== status) return false;
      
      // Case-insensitive substring search on: id, partyId, division, class
      if (q) {
        const qLower = q.toLowerCase();
        const matchId = item.id?.toLowerCase().includes(qLower);
        const matchPartyId = item.partyId?.toLowerCase().includes(qLower);
        const matchDivision = item.division?.toLowerCase().includes(qLower);
        const matchClass = item.class?.toLowerCase().includes(qLower);
        if (!matchId && !matchPartyId && !matchDivision && !matchClass) return false;
      }
      
      return true;
    });

    return ok({ items: filtered, next: page.next });
  } catch (e: any) { 
    return error(e); 
  }
}
