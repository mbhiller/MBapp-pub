// apps/api/src/resources/event-lines.ts
// Read-only validator to ensure event lines exist on the target event.

import { getObjectById } from "../objects/repo";

export type AssertEventLinesArgs = {
  tenantId?: string;
  eventId?: string;
  eventLineIds: string[];
};

export async function assertEventLinesExistAndAvailable({
  tenantId,
  eventId,
  eventLineIds,
}: AssertEventLinesArgs): Promise<Array<{ id: string }>> {
  if (!eventId) {
    throw Object.assign(new Error("Event not found"), { code: "event_not_found", statusCode: 400 });
  }

  const event = await getObjectById({
    tenantId,
    type: "event",
    id: eventId,
    fields: ["id", "lines"],
  });

  if (!event) {
    throw Object.assign(new Error("Event not found"), { code: "event_not_found", statusCode: 404 });
  }

  const rawLines = (event as any)?.lines;
  const lines = Array.isArray(rawLines)
    ? rawLines
    : rawLines && typeof rawLines === "object"
    ? Object.values(rawLines as Record<string, unknown>)
    : [];

  for (const lid of eventLineIds || []) {
    const exists = lines.find((l: any) => l && (l as any).id === lid);
    if (!exists) {
      throw Object.assign(new Error("Class not in event"), {
        code: "class_not_in_event",
        statusCode: 400,
      });
    }
  }

  return (eventLineIds || []).map((id) => ({ id }));
}
