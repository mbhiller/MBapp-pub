// apps/api/src/registrations/expire-helper.ts
import { getObjectById, updateObject } from "../objects/repo";
import { releaseEventSeat } from "../objects/repo";
import { releaseEventRv } from "../objects/repo";
import { REGISTRATION_STATUS, REGISTRATION_PAYMENT_STATUS } from "./constants";
import { releaseReservationHoldsForOwner } from "../reservations/holds";

export type ExpireHoldArgs = {
  tenantId: string;
  regId: string;
};

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
