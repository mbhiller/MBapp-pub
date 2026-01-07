// apps/api/src/registrations/expire-helper.ts
import { getObjectById, updateObject } from "../objects/repo";
import { releaseEventSeat } from "../objects/repo";
import { releaseEventRv } from "../objects/repo";

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

  if (status !== "submitted") return { expired: false };
  if (holdMs === undefined || holdMs >= nowMs) return { expired: false };

  const eventId = (reg as any).eventId as string | undefined;
  const rvQty = Math.max(0, Number((reg as any).rvQty || 0));

  await updateObject({
    tenantId,
    type: "registration",
    id: regId,
    body: {
      status: "cancelled",
      paymentStatus: "failed",
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

  return { expired: true };
}
