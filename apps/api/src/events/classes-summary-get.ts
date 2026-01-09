// apps/api/src/events/classes-summary-get.ts
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ok, notFound, error, bad } from "../common/responses";
import { getObjectById, listRegistrationsByEventId } from "../objects/repo";
import type { components } from "../generated/openapi-types";

type Event = components["schemas"]["Event"];
type EventLine = components["schemas"]["EventLine"];
type Registration = components["schemas"]["Registration"];
type RegistrationLine = components["schemas"]["RegistrationLine"];
type EventClassesSummary = components["schemas"]["EventClassesSummary"];
type EventClassLineSummary = components["schemas"]["EventClassLineSummary"];

/**
 * GET /events/{eventId}:classes-summary
 * Operator endpoint: per-line capacity summary (reserved/remaining + registration counts)
 * Sprint BP
 */
export async function handle(event: APIGatewayProxyEventV2) {
  try {
    const { tenantId, eventId } = event.pathParameters as any;
    if (!tenantId || !eventId) {
      return bad("Missing tenantId or eventId");
    }

    // 1) Fetch event
    const eventObj = await getObjectById({
      tenantId,
      type: "event",
      id: eventId,
    }) as Event | null;

    if (!eventObj) {
      return notFound(`Event ${eventId} not found`);
    }

    const lines = eventObj.lines || [];
    const linesReservedById = eventObj.linesReservedById || {};

    // 2) Build classId -> lineIds map
    // Note: A classId can appear in multiple event lines; we will attribute reg qty to all matching lines.
    // TODO: Future enhancement - denormalize Registration.lines to include eventLineId for unambiguous mapping.
    const classIdToLineIds = new Map<string, string[]>();
    for (const line of lines) {
      if (!line.classId) continue;
      const existing = classIdToLineIds.get(line.classId) || [];
      if (line.id) {
        existing.push(line.id);
      }
      classIdToLineIds.set(line.classId, existing);
    }

    // 3) Fetch registrations for this event using the eventId index
    const regsResult = await listRegistrationsByEventId({
      tenantId,
      eventId,
      limit: 10000, // Large cap; operator reporting is internal-only
      scanIndexForward: true,
    });

    const registrations = regsResult.items as Registration[];

    // 4) Compute entriesRequested and registrationsWithEntries per lineId
    const entriesRequestedByLineId = new Map<string, number>();
    const registrationSetByLineId = new Map<string, Set<string>>();

    for (const reg of registrations) {
      // Only count active registrations (exclude cancelled)
      if (reg.status === "cancelled") {
        continue;
      }

      const regLines = reg.lines || [];
      for (const regLine of regLines) {
        const { classId, qty } = regLine;
        if (!classId || !qty || qty <= 0) continue;

        const lineIds = classIdToLineIds.get(classId) || [];
        for (const lineId of lineIds) {
          // Increment entriesRequested
          const current = entriesRequestedByLineId.get(lineId) || 0;
          entriesRequestedByLineId.set(lineId, current + qty);

          // Track unique registrations
          if (!registrationSetByLineId.has(lineId)) {
            registrationSetByLineId.set(lineId, new Set());
          }
          registrationSetByLineId.get(lineId)!.add(reg.id!);
        }
      }
    }

    // 5) Build response
    const summaryLines: EventClassLineSummary[] = lines.map((line) => {
      const lineId = line.id || "";
      const reserved = linesReservedById[lineId] || 0;
      const capacity = line.capacity ?? null;
      const remaining = capacity === null ? null : Math.max(0, capacity - reserved);
      const registrationsWithEntries = registrationSetByLineId.get(lineId)?.size || 0;
      const entriesRequested = entriesRequestedByLineId.get(lineId) || 0;

      return {
        id: lineId,
        classId: line.classId,
        capacity,
        reserved,
        remaining,
        registrationsWithEntries,
        entriesRequested,
        // Schedule metadata
        divisionId: line.divisionId ?? null,
        discipline: line.discipline ?? null,
        scheduledStartAt: line.scheduledStartAt ?? null,
        scheduledEndAt: line.scheduledEndAt ?? null,
        location: line.location ?? null,
        fee: line.fee ?? null,
        note: line.note ?? null,
      };
    });

    const response: EventClassesSummary = {
      eventId,
      lines: summaryLines,
    };

    return ok(response);
  } catch (e: any) {
    return error(e);
  }
}
