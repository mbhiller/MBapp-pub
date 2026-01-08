// apps/api/src/registrations/expire-helper.ts
import { getObjectById, updateObject, releaseEventSeat, releaseEventRv, listObjects, releaseEventLineCapacity } from "../objects/repo";
import { REGISTRATION_STATUS, REGISTRATION_PAYMENT_STATUS } from "./constants";
import { releaseReservationHoldsForOwner } from "../reservations/holds";

export type ExpireHoldArgs = {
  tenantId: string;
  regId: string;
};

/**
 * Release class entry capacity counters by computing qty from holds.
 * Prefers per-entry holds (after assignment) over block holds (before assignment).
 */
async function releaseClassEntryCountersFromHolds({
  tenantId,
  eventId,
  registrationId,
}: {
  tenantId: string;
  eventId: string;
  registrationId: string;
}) {
  try {
    const classHoldsPage = await listObjects({
      tenantId,
      type: "reservationHold",
      filters: {
        ownerType: "registration",
        ownerId: String(registrationId),
        scopeType: "event",
        scopeId: String(eventId),
        itemType: "class_entry",
      },
      limit: 200,
      fields: ["id", "state", "qty", "resourceId", "metadata"],
    });

    const classHolds = (classHoldsPage.items as any[]) || [];
    const lineIdQty: Record<string, number> = {};

    // Group holds by lineId and resourceId to decide which to count
    const holdsByLineId: Record<string, any[]> = {};
    for (const hold of classHolds) {
      const st = String((hold as any)?.state || "");
      if (!["held", "confirmed"].includes(st)) continue;

      // Extract lineId from either metadata (block holds) or resourceId (per-entry holds)
      const lineId = (hold as any)?.resourceId || (hold as any)?.metadata?.eventLineId;
      if (!lineId) continue;

      if (!holdsByLineId[lineId]) {
        holdsByLineId[lineId] = [];
      }
      holdsByLineId[lineId].push(hold);
    }

    // For each lineId, prefer per-entry holds; fall back to block holds
    for (const [lineId, holds] of Object.entries(holdsByLineId)) {
      // Per-entry holds: resourceId == lineId
      const perEntryHolds = holds.filter((h: any) => h.resourceId === lineId);
      if (perEntryHolds.length > 0) {
        // Sum per-entry hold qtys (usually 1 each, but be safe)
        const totalQty = perEntryHolds.reduce((sum: number, h: any) => sum + (Number(h.qty) || 1), 0);
        lineIdQty[lineId] = totalQty;
      } else {
        // Block holds: resourceId is null/absent, metadata.eventLineId == lineId
        const blockHolds = holds.filter((h: any) => !h.resourceId);
        if (blockHolds.length > 0) {
          // Block holds should have qty that we reserved
          const blockQty = blockHolds[0]?.qty || 0;
          lineIdQty[lineId] = blockQty;
        }
      }
    }

    // Release counters for each lineId
    for (const [lineId, qty] of Object.entries(lineIdQty)) {
      if (qty > 0) {
        try {
          await releaseEventLineCapacity({ tenantId, eventId, lineId, qty });
        } catch (_) {
          // Release is best-effort; continue if one fails
        }
      }
    }
  } catch (_) {
    // Entire release is best-effort
  }
}

/**
 * Expire a submitted registration hold if TTL has passed.
 * No-op when status != submitted or holdExpiresAt >= now.
 * Chooses paymentStatus = "failed" when expiring.
 */
export async function expireRegistrationHold({ tenantId, regId }: ExpireHoldArgs): Promise<{ expired: boolean }> {
  const reg = await getObjectById({ tenantId, type: "registration", id: regId });
  if (!reg) return { expired: false };

  const status = (reg as any).status as string | undefined;
  const holdExpiresAt = (reg as any).holdExpiresAt as string | undefined;
  const nowMs = Date.now();
  const holdMs = holdExpiresAt ? new Date(holdExpiresAt).getTime() : undefined;

  if (status !== REGISTRATION_STATUS.submitted) return { expired: false };
  if (holdMs === undefined || holdMs >= nowMs) return { expired: false };

  const eventId = (reg as any).eventId as string | undefined;
  const rvQty = Math.max(0, Number((reg as any).rvQty || 0));

  await updateObject({
    tenantId,
    type: "registration",
    id: regId,
    body: {
      status: REGISTRATION_STATUS.cancelled,
      paymentStatus: REGISTRATION_PAYMENT_STATUS.failed,
      paymentIntentClientSecret: null,
    },
  });

  if (eventId) {
    try {
      await releaseEventSeat({ tenantId, eventId });
    } catch (_) {
      // ignore
    }
    if (rvQty > 0) {
      try {
        await releaseEventRv({ tenantId, eventId, qty: rvQty });
      } catch (_) {
        // ignore
      }
    }

    // Release per-line class entry capacities (prefers per-entry holds over block holds)
    await releaseClassEntryCountersFromHolds({
      tenantId,
      eventId,
      registrationId: regId,
    });
  }

  // Release (transition to cancelled) reservation holds for this registration
  try {
    await releaseReservationHoldsForOwner({
      tenantId,
      ownerType: "registration",
      ownerId: regId,
      reason: "expired",
    });
  } catch (_) {
    // ignore; counters already released
  }

  return { expired: true };
}
