// apps/api/src/events/registrations-by-line-get.ts
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ok, notFound, error, bad } from "../common/responses";
import { getObjectById, listRegistrationsByEventId } from "../objects/repo";
import type { components } from "../generated/openapi-types";

type Event = components["schemas"]["Event"];
type Registration = components["schemas"]["Registration"];
type RegistrationLine = components["schemas"]["RegistrationLine"];
type RegistrationsByLinePage = components["schemas"]["RegistrationsByLinePage"];
type RegistrationByLineItem = components["schemas"]["RegistrationByLineItem"];

/**
 * GET /events/{eventId}:registrations-by-line?eventLineId=...&limit=...&next=...
 * Operator endpoint: paged registrations for event, optionally filtered by line
 * Sprint BP
 */
export async function handle(event: APIGatewayProxyEventV2) {
  try {
    const { tenantId, eventId } = event.pathParameters as any;
    if (!tenantId || !eventId) {
      return bad("Missing tenantId or eventId");
    }

    const params = event.queryStringParameters || {};
    const eventLineId = params.eventLineId || null;
    const rawLimit = params.limit ? parseInt(params.limit, 10) : 50;
    const limit = Math.max(1, Math.min(200, rawLimit));
    let nextCursor = params.next || null;

    // 1) Validate event exists
    const eventObj = await getObjectById({
      tenantId,
      type: "event",
      id: eventId,
    }) as Event | null;

    if (!eventObj) {
      return notFound(`Event ${eventId} not found`);
    }

    // 2) If eventLineId provided, validate it exists and get targetClassId
    let targetClassId: string | null = null;
    if (eventLineId) {
      const lines = eventObj.lines || [];
      const line = lines.find((l) => l.id === eventLineId);
      if (!line) {
        return bad(`Event line ${eventLineId} not found in event ${eventId}`);
      }
      targetClassId = line.classId;
    }

    // 3) Page through registrations with filtering
    // Because filtering can reduce results below limit, iterate multiple backend pages
    const collected: RegistrationByLineItem[] = [];
    const maxBackendPages = 10; // Safety cap to avoid runaway loops
    let pageIdx = 0;
    let finalNext: string | null = null;

    while (pageIdx < maxBackendPages && collected.length < limit) {
      const pageResult = await listRegistrationsByEventId({
        tenantId,
        eventId,
        limit: 200, // upstream page size
        next: nextCursor || undefined,
        scanIndexForward: true,
      });

      const regs = pageResult.items as Registration[];

      // Apply filtering and projection
      for (const reg of regs) {
        if (collected.length >= limit) break;

        // If filtering by line, check if registration has entries on that line
        if (targetClassId !== null) {
          const regLines = reg.lines || [];
          let entriesOnThisLine = 0;
          for (const regLine of regLines) {
            if (regLine.classId === targetClassId && regLine.qty > 0) {
              entriesOnThisLine += regLine.qty;
            }
          }
          
          // Skip if no entries on this line
          if (entriesOnThisLine === 0) continue;

          // Include with entriesOnThisLine count
          collected.push({
            registrationId: reg.id!,
            partyId: reg.partyId || null,
            status: reg.status,
            paymentStatus: reg.paymentStatus || null,
            entriesOnThisLine,
            submittedAt: reg.submittedAt || null,
            confirmedAt: reg.confirmedAt || null,
            cancelledAt: reg.cancelledAt || null,
          });
        } else {
          // No filtering - include all registrations for this event
          collected.push({
            registrationId: reg.id!,
            partyId: reg.partyId || null,
            status: reg.status,
            paymentStatus: reg.paymentStatus || null,
            entriesOnThisLine: 0, // Not filtered by line, so 0
            submittedAt: reg.submittedAt || null,
            confirmedAt: reg.confirmedAt || null,
            cancelledAt: reg.cancelledAt || null,
          });
        }
      }

      // Update cursor for next iteration
      finalNext = pageResult.next || null;
      nextCursor = finalNext;

      // If no more backend pages, stop
      if (!finalNext) break;

      pageIdx++;
    }

    // 4) Build response
    const response: RegistrationsByLinePage = {
      eventId,
      eventLineId: eventLineId || null,
      items: collected,
      next: finalNext,
    };

    return ok(response);
  } catch (e: any) {
    return error(e);
  }
}
