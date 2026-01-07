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
  resourceId?: string | null;
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

export async function createHeldReservationHold({ tenantId, ownerType, ownerId, scopeType, scopeId, itemType, qty, expiresAt, resourceId, metadata }: CreateHeldArgs) {
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
    ...(resourceId ? { resourceId } : {}),
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

/**
 * Create a stall block hold for a registration.
 * Block holds have itemType="stall", qty=N, resourceId=null, state="held".
 * Optional groupId can be stored in metadata.
 */
export async function createHeldStallBlockHold({
  tenantId,
  registrationId,
  eventId,
  qty,
  expiresAt,
  groupId,
}: {
  tenantId?: string;
  registrationId: string;
  eventId: string;
  qty: number;
  expiresAt?: string;
  groupId?: string;
}) {
  // Idempotency: if a block hold already exists (resourceId null) in held/confirmed, reuse it
  const existingPage = await listObjects({
    tenantId,
    type: "reservationHold",
    filters: {
      ownerType: "registration",
      ownerId: String(registrationId),
      scopeType: "event",
      scopeId: String(eventId),
      itemType: "stall",
    },
    limit: 50,
    fields: ["id", "state", "qty", "resourceId"],
  });

  const existingItems = (existingPage.items as any[]) || [];
  const confirmedBlock = existingItems.find((h: any) => !h.resourceId && String(h.state) === "confirmed");
  const heldBlock = existingItems.find((h: any) => !h.resourceId && String(h.state) === "held");
  const existingBlock = confirmedBlock || heldBlock;
  if (existingBlock) return existingBlock as any;

  const metadata = groupId ? { groupId } : undefined;
  return createHeldReservationHold({
    tenantId,
    ownerType: "registration",
    ownerId: registrationId,
    scopeType: "event",
    scopeId: eventId,
    itemType: "stall",
    qty,
    expiresAt,
    resourceId: null,
    metadata,
  });
}

/**
 * Assign specific stalls to a registration by converting a block hold into per-stall holds.
 * 
 * Validates:
 * - Registration exists and is in appropriate state (confirmed preferred, submitted allowed)
 * - stallIds are unique, non-empty
 * - Each stallId is a valid stall resource for this event
 * - No existing active hold already reserves any of these stallIds
 * - Block hold qty matches stallIds.length
 * 
 * Process:
 * - Find block hold (resourceId=null, state in held/confirmed)
 * - Create per-stall holds (qty=1, resourceId=stallId, same state as block)
 * - Release block hold with releaseReason="assigned"
 * 
 * Returns: Array of per-stall holds created
 */
export async function assignStallsToRegistration({
  tenantId,
  registrationId,
  eventId,
  stallIds,
}: {
  tenantId?: string;
  registrationId: string;
  eventId: string;
  stallIds: string[];
}) {
  const { getObjectById } = await import("../objects/repo");
  const { assertStallResourcesExistAndAvailable } = await import("../resources/stalls");

  if (!stallIds || stallIds.length === 0) {
    throw Object.assign(new Error("No stall IDs provided"), { code: "no_stalls", statusCode: 400 });
  }

  // Validate uniqueness
  const unique = new Set(stallIds);
  if (unique.size !== stallIds.length) {
    throw Object.assign(new Error("Duplicate stall IDs"), { code: "duplicate_stalls", statusCode: 400 });
  }

  // Validate registration exists and is in correct state
  const reg = await getObjectById({ tenantId, type: "registration", id: registrationId, fields: ["id", "status"] });
  if (!reg) {
    throw Object.assign(new Error("Registration not found"), { code: "registration_not_found", statusCode: 404 });
  }

  const regStatus = (reg as any)?.status;
  const allowedStates = ["confirmed", "submitted"];
  if (!allowedStates.includes(String(regStatus))) {
    throw Object.assign(
      new Error(`Registration status ${regStatus} does not allow stall assignment`),
      { code: "invalid_registration_state", statusCode: 400 }
    );
  }

  // Validate stall resources exist and belong to this event
  await assertStallResourcesExistAndAvailable({ tenantId, stallIds, eventId });

  // Check existing holds and build idempotent + to-create lists
  const ownerConfirmed = await listObjects({
    tenantId,
    type: "reservationHold",
    filters: {
      ownerType: "registration",
      ownerId: registrationId,
      itemType: "stall",
      state: "confirmed",
    },
    limit: 200,
    fields: ["id", "resourceId", "state"],
  });
  const ownerHeld = await listObjects({
    tenantId,
    type: "reservationHold",
    filters: {
      ownerType: "registration",
      ownerId: registrationId,
      itemType: "stall",
      state: "held",
    },
    limit: 200,
    fields: ["id", "resourceId", "state"],
  });
  const ownerItems = [
    ...(((ownerConfirmed.items as any[]) || [])),
    ...(((ownerHeld.items as any[]) || [])),
  ];

  const existingConfirmed = await listObjects({
    tenantId,
    type: "reservationHold",
    filters: {
      scopeType: "event",
      scopeId: eventId,
      itemType: "stall",
      state: "confirmed",
    },
    limit: 200,
    fields: ["id", "resourceId", "state", "ownerType", "ownerId"],
  });
  const existingHeld = await listObjects({
    tenantId,
    type: "reservationHold",
    filters: {
      scopeType: "event",
      scopeId: eventId,
      itemType: "stall",
      state: "held",
    },
    limit: 200,
    fields: ["id", "resourceId", "state", "ownerType", "ownerId"],
  });

  const eventItems = [
    ...(((existingConfirmed.items as any[]) || [])),
    ...(((existingHeld.items as any[]) || [])),
  ];

  const preexistingHolds: any[] = [];
  const stallIdsToCreate: string[] = [];

  for (const stallId of stallIds) {
    const owned = ownerItems.find((item: any) => (item as any)?.resourceId === stallId && (String((item as any)?.state) === "held" || String((item as any)?.state) === "confirmed"));
    if (owned) {
      // Idempotent: already assigned to this registration
      preexistingHolds.push(owned);
      continue;
    }

    const conflict = eventItems.find((item: any) => (item as any)?.resourceId === stallId && (String((item as any)?.state) === "held" || String((item as any)?.state) === "confirmed") && String((item as any)?.ownerType) === "registration" && String((item as any)?.ownerId) !== String(registrationId));
    if (conflict) {
      throw Object.assign(
        new Error(`Stall ${stallId} is already assigned`),
        { code: "stall_already_assigned", statusCode: 409 }
      );
    }

    stallIdsToCreate.push(stallId);
  }

  // Find block hold (resourceId=null); prefer confirmed first, else held
  const blockHolds = await listObjects({
    tenantId,
    type: "reservationHold",
    filters: {
      ownerType: "registration",
      ownerId: registrationId,
      scopeType: "event",
      scopeId: eventId,
      itemType: "stall",
    },
    limit: 1,
    fields: ["id", "qty", "state", "resourceId"],
  });

  const blockItems = (blockHolds.items as any[]) || [];
  const blockHold = blockItems.find((h: any) => !h.resourceId && String(h.state) === "confirmed")
    || blockItems.find((h: any) => !h.resourceId && String(h.state) === "held");
  if (!blockHold) {
    const debugCounts = blockItems.reduce((acc: Record<string, number>, h: any) => {
      const key = `${String(h.itemType || "unknown")}:${String(h.state || "unknown")}`;
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    throw Object.assign(
      new Error("No stall block hold found for registration"),
      { code: "block_hold_not_found", statusCode: 400, context: { ownerId: registrationId, eventId, counts: debugCounts } }
    );
  }

  const blockQty = (blockHold as any)?.qty;
  if (blockQty !== stallIds.length) {
    throw Object.assign(
      new Error(`Block hold qty (${blockQty}) does not match requested stallIds (${stallIds.length})`),
      { code: "qty_mismatch", statusCode: 400 }
    );
  }

  // Create per-stall holds with same state as block hold
  const blockState = (blockHold as any)?.state || "held";
  const perStallHolds: any[] = [];

  // Include any preexisting holds (idempotent)
  for (const h of preexistingHolds) {
    perStallHolds.push(h);
  }

  for (const stallId of stallIdsToCreate) {
    const perStallHold = await createObject({
      tenantId,
      type: "reservationHold",
      body: {
        type: "reservationHold",
        ownerType: "registration",
        ownerId: registrationId,
        scopeType: "event",
        scopeId: eventId,
        itemType: "stall",
        qty: 1,
        resourceId: stallId,
        state: blockState,
        heldAt: (blockHold as any)?.heldAt || nowIso(),
        ...(blockState === "confirmed" ? { confirmedAt: nowIso() } : {}),
      },
    });
    perStallHolds.push(perStallHold);
  }

  // Release block hold with reason
  await updateObject({
    tenantId,
    type: "reservationHold",
    id: (blockHold as any)?.id,
    body: {
      state: "released",
      releasedAt: nowIso(),
      releaseReason: "assigned",
    },
  });

  return perStallHolds;
}

/**
 * Create an RV block hold for a registration.
 * Block holds have itemType="rv", qty=N, resourceId=null, state="held".
 * Optional groupId can be stored in metadata.
 */
export async function createHeldRvBlockHold({
  tenantId,
  registrationId,
  eventId,
  qty,
  expiresAt,
  groupId,
}: {
  tenantId?: string;
  registrationId: string;
  eventId: string;
  qty: number;
  expiresAt?: string;
  groupId?: string;
}) {
  // Idempotency: if a block hold already exists (resourceId null) in held/confirmed, reuse it
  const existingPage = await listObjects({
    tenantId,
    type: "reservationHold",
    filters: {
      ownerType: "registration",
      ownerId: String(registrationId),
      scopeType: "event",
      scopeId: String(eventId),
      itemType: "rv",
    },
    limit: 50,
    fields: ["id", "state", "qty", "resourceId"],
  });

  const existingItems = (existingPage.items as any[]) || [];
  const confirmedBlock = existingItems.find((h: any) => !h.resourceId && String(h.state) === "confirmed");
  const heldBlock = existingItems.find((h: any) => !h.resourceId && String(h.state) === "held");
  const existingBlock = confirmedBlock || heldBlock;
  if (existingBlock) return existingBlock as any;

  const metadata = groupId ? { groupId } : undefined;
  return createHeldReservationHold({
    tenantId,
    ownerType: "registration",
    ownerId: registrationId,
    scopeType: "event",
    scopeId: eventId,
    itemType: "rv",
    qty,
    expiresAt,
    resourceId: null,
    metadata,
  });
}

/**
 * Assign specific RV sites to a registration by converting a block hold into per-site holds.
 *
 * Validates:
 * - Registration exists and is in appropriate state (confirmed preferred, submitted allowed)
 * - rvSiteIds are unique, non-empty
 * - Each rvSiteId is a valid RV site resource for this event
 * - No existing active hold already reserves any of these rvSiteIds
 * - Block hold qty matches rvSiteIds.length
 *
 * Process:
 * - Find block hold (resourceId=null, state in held/confirmed)
 * - Create per-site holds (qty=1, resourceId=rvSiteId, same state as block)
 * - Release block hold with releaseReason="assigned"
 *
 * Returns: Array of per-RV-site holds created
 */
export async function assignRvSitesToRegistration({
  tenantId,
  registrationId,
  eventId,
  rvSiteIds,
}: {
  tenantId?: string;
  registrationId: string;
  eventId: string;
  rvSiteIds: string[];
}) {
  const { getObjectById } = await import("../objects/repo");
  const { assertRvResourcesExistAndAvailable } = await import("../resources/rv-sites");

  if (!rvSiteIds || rvSiteIds.length === 0) {
    throw Object.assign(new Error("No RV site IDs provided"), { code: "no_rv_sites", statusCode: 400 });
  }

  // Validate uniqueness
  const unique = new Set(rvSiteIds);
  if (unique.size !== rvSiteIds.length) {
    throw Object.assign(new Error("Duplicate RV site IDs"), { code: "duplicate_rv_sites", statusCode: 400 });
  }

  // Validate registration exists and is in correct state
  const reg = await getObjectById({ tenantId, type: "registration", id: registrationId, fields: ["id", "status"] });
  if (!reg) {
    throw Object.assign(new Error("Registration not found"), { code: "registration_not_found", statusCode: 404 });
  }

  const regStatus = (reg as any)?.status;
  const allowedStates = ["confirmed", "submitted"];
  if (!allowedStates.includes(String(regStatus))) {
    throw Object.assign(
      new Error(`Registration status ${regStatus} does not allow RV site assignment`),
      { code: "invalid_registration_state", statusCode: 400 }
    );
  }

  // Validate RV site resources exist and belong to this event
  await assertRvResourcesExistAndAvailable({ tenantId, rvSiteIds, eventId });

  // Check existing holds and build idempotent + to-create lists
  const ownerConfirmed = await listObjects({
    tenantId,
    type: "reservationHold",
    filters: {
      ownerType: "registration",
      ownerId: registrationId,
      itemType: "rv",
      state: "confirmed",
    },
    limit: 200,
    fields: ["id", "resourceId", "state"],
  });
  const ownerHeld = await listObjects({
    tenantId,
    type: "reservationHold",
    filters: {
      ownerType: "registration",
      ownerId: registrationId,
      itemType: "rv",
      state: "held",
    },
    limit: 200,
    fields: ["id", "resourceId", "state"],
  });
  const ownerItems = [
    ...(((ownerConfirmed.items as any[]) || [])),
    ...(((ownerHeld.items as any[]) || [])),
  ];

  const existingConfirmed = await listObjects({
    tenantId,
    type: "reservationHold",
    filters: {
      scopeType: "event",
      scopeId: eventId,
      itemType: "rv",
      state: "confirmed",
    },
    limit: 200,
    fields: ["id", "resourceId", "state", "ownerType", "ownerId"],
  });
  const existingHeld = await listObjects({
    tenantId,
    type: "reservationHold",
    filters: {
      scopeType: "event",
      scopeId: eventId,
      itemType: "rv",
      state: "held",
    },
    limit: 200,
    fields: ["id", "resourceId", "state", "ownerType", "ownerId"],
  });

  const eventItems = [
    ...(((existingConfirmed.items as any[]) || [])),
    ...(((existingHeld.items as any[]) || [])),
  ];

  const preexistingHolds: any[] = [];
  const rvSiteIdsToCreate: string[] = [];

  for (const rvSiteId of rvSiteIds) {
    const owned = ownerItems.find((item: any) => (item as any)?.resourceId === rvSiteId && (String((item as any)?.state) === "held" || String((item as any)?.state) === "confirmed"));
    if (owned) {
      // Idempotent: already assigned to this registration
      preexistingHolds.push(owned);
      continue;
    }

    const conflict = eventItems.find((item: any) => (item as any)?.resourceId === rvSiteId && (String((item as any)?.state) === "held" || String((item as any)?.state) === "confirmed") && String((item as any)?.ownerType) === "registration" && String((item as any)?.ownerId) !== String(registrationId));
    if (conflict) {
      throw Object.assign(
        new Error(`RV site ${rvSiteId} is already assigned`),
        { code: "rv_site_already_assigned", statusCode: 409 }
      );
    }

    rvSiteIdsToCreate.push(rvSiteId);
  }

  // Find block hold (resourceId=null); prefer confirmed first, else held
  const blockHolds = await listObjects({
    tenantId,
    type: "reservationHold",
    filters: {
      ownerType: "registration",
      ownerId: registrationId,
      scopeType: "event",
      scopeId: eventId,
      itemType: "rv",
    },
    limit: 1,
    fields: ["id", "qty", "state", "resourceId"],
  });

  const blockItems = (blockHolds.items as any[]) || [];
  const blockHold = blockItems.find((h: any) => !h.resourceId && String(h.state) === "confirmed")
    || blockItems.find((h: any) => !h.resourceId && String(h.state) === "held");
  if (!blockHold) {
    const debugCounts = blockItems.reduce((acc: Record<string, number>, h: any) => {
      const key = `${String(h.itemType || "unknown")}:${String(h.state || "unknown")}`;
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    throw Object.assign(
      new Error("No RV block hold found for registration"),
      { code: "block_hold_not_found", statusCode: 400, context: { ownerId: registrationId, eventId, counts: debugCounts } }
    );
  }

  const blockQty = (blockHold as any)?.qty;
  if (blockQty !== rvSiteIds.length) {
    throw Object.assign(
      new Error(`Block hold qty (${blockQty}) does not match requested rvSiteIds (${rvSiteIds.length})`),
      { code: "qty_mismatch", statusCode: 400 }
    );
  }

  // Create per-site holds with same state as block hold
  const blockState = (blockHold as any)?.state || "held";
  const perSiteHolds: any[] = [];

  // Include any preexisting holds (idempotent)
  for (const h of preexistingHolds) {
    perSiteHolds.push(h);
  }

  for (const rvSiteId of rvSiteIdsToCreate) {
    const perSiteHold = await createObject({
      tenantId,
      type: "reservationHold",
      body: {
        type: "reservationHold",
        ownerType: "registration",
        ownerId: registrationId,
        scopeType: "event",
        scopeId: eventId,
        itemType: "rv",
        qty: 1,
        resourceId: rvSiteId,
        state: blockState,
        heldAt: (blockHold as any)?.heldAt || nowIso(),
        ...(blockState === "confirmed" ? { confirmedAt: nowIso() } : {}),
      },
    });
    perSiteHolds.push(perSiteHold);
  }

  // Release block hold with reason
  await updateObject({
    tenantId,
    type: "reservationHold",
    id: (blockHold as any)?.id,
    body: {
      state: "released",
      releasedAt: nowIso(),
      releaseReason: "assigned",
    },
  });

  return perSiteHolds;
}
