import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { createObject, updateObject, listObjects } from "../objects/repo";

type CreateHeldArgs = {
  tenantId?: string;
  ownerType: string;
  ownerId: string;
  scopeType: string;
  scopeId: string;
  itemType: string;
  qty: number;
  expiresAt?: string;
  metadata?: Record<string, unknown>;
  event?: APIGatewayProxyEventV2;
};

type OwnerArgs = {
  tenantId?: string;
  ownerType: string;
  ownerId: string;
  event?: APIGatewayProxyEventV2;
};

type ReleaseArgs = OwnerArgs & {
  reason?: string;
};

function nowIso() {
  return new Date().toISOString();
}

export async function createHeldReservationHold({ tenantId, ownerType, ownerId, scopeType, scopeId, itemType, qty, expiresAt, metadata }: CreateHeldArgs) {
  if (!qty || qty <= 0) return null as any;

  const existing = await listObjects({
    tenantId,
    type: "reservationHold",
    filters: {
      ownerType: String(ownerType),
      ownerId: String(ownerId),
      scopeType: String(scopeType),
      scopeId: String(scopeId),
      itemType: String(itemType),
      state: "held",
    },
    limit: 1,
    fields: ["id", "state"],
  });

  const items = (existing.items as any[]) || [];
  if (items.length > 0) return items[0];

  const body = {
    type: "reservationHold",
    ownerType,
    ownerId,
    scopeType,
    scopeId,
    itemType,
    qty,
    state: "held",
    heldAt: nowIso(),
    ...(expiresAt ? { expiresAt } : {}),
    ...(metadata ? { metadata } : {}),
  } as Record<string, unknown>;

  const created = await createObject({ tenantId, type: "reservationHold", body });
  return created;
}

export async function confirmReservationHoldsForOwner({ tenantId, ownerType, ownerId }: OwnerArgs) {
  const page = await listObjects({
    tenantId,
    type: "reservationHold",
    filters: { ownerType: String(ownerType), ownerId: String(ownerId), state: "held" },
    limit: 200,
    fields: ["id", "state"],
  });
  let updated = 0;
  for (const item of ((page.items as any[]) || [])) {
    if ((item as any)?.state !== "held") continue;
    await updateObject({ tenantId, type: "reservationHold", id: (item as any).id, body: { state: "confirmed", confirmedAt: nowIso() } });
    updated += 1;
  }
  return { updated };
}

export async function releaseReservationHoldsForOwner({ tenantId, ownerType, ownerId, reason }: ReleaseArgs) {
  const byOwner = await listObjects({
    tenantId,
    type: "reservationHold",
    filters: { ownerType: String(ownerType), ownerId: String(ownerId) },
    limit: 200,
    fields: ["id", "state"],
  });

  const now = nowIso();
  const targetStates = new Set(["held", "confirmed"]);
  const newState = reason === "expired" ? "cancelled" : "released";

  let updated = 0;
  for (const item of ((byOwner.items as any[]) || [])) {
    const st = (item as any)?.state;
    if (!targetStates.has(String(st))) continue;
    await updateObject({ tenantId, type: "reservationHold", id: (item as any).id, body: { state: newState, releasedAt: now, releaseReason: reason } });
    updated += 1;
  }
  return { updated };
}
