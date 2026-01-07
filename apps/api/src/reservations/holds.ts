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

/**
 * Generalized resource assignment for discrete resource types (stalls, RV sites, etc.).
 * Handles idempotency, conflict detection, and per-resource hold creation (Sprint BM).
 */
export async function assignResourcesToRegistration({
  tenantId,
  registrationId,
  eventId,
  itemType,
  resourceIds,
  conflictCode,
  expectedResourceType,
  assertResourcesFn,
}: {
  tenantId?: string;
  registrationId: string;
  eventId: string;
  itemType: string; // "stall" | "rv" | future types
  resourceIds: string[];
  conflictCode: string; // e.g., "stall_already_assigned"
  expectedResourceType: string; // e.g., "stall"
  assertResourcesFn: (args: Record<string, any>) => Promise<any[]>; // Validator function
}) {
  const { getObjectById } = await import("../objects/repo");

  if (!resourceIds || resourceIds.length === 0) {
    throw Object.assign(new Error(`No ${itemType} IDs provided`), { 
      code: `no_${itemType}s`, 
      statusCode: 400 
    });
  }

  // Validate uniqueness
  const unique = new Set(resourceIds);
  if (unique.size !== resourceIds.length) {
    throw Object.assign(new Error(`Duplicate ${itemType} IDs`), { 
      code: `duplicate_${itemType}s`, 
      statusCode: 400 
    });
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
      new Error(`Registration status ${regStatus} does not allow ${itemType} assignment`),
      { code: "invalid_registration_state", statusCode: 400 }
    );
  }

  // Validate resources exist and belong to this event
  // Build the correct parameter object for the assertion function
  const assertArgs: Record<string, any> = { tenantId, eventId };
  if (itemType === "stall") {
    assertArgs.stallIds = resourceIds;
  } else if (itemType === "rv") {
    assertArgs.rvSiteIds = resourceIds;
  } else {
    // For future types, use a generic key
    assertArgs[`${itemType}Ids`] = resourceIds;
  }
  await assertResourcesFn(assertArgs);

  // Check existing holds and build idempotent + to-create lists
  const ownerConfirmed = await listObjects({
    tenantId,
    type: "reservationHold",
    filters: {
      ownerType: "registration",
      ownerId: registrationId,
      itemType,
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
      itemType,
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
      itemType,
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
      itemType,
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
  const resourcesToCreate: string[] = [];

  for (const resourceId of resourceIds) {
    const owned = ownerItems.find((item: any) => (item as any)?.resourceId === resourceId && (String((item as any)?.state) === "held" || String((item as any)?.state) === "confirmed"));
    if (owned) {
      // Idempotent: already assigned to this registration
      preexistingHolds.push(owned);
      continue;
    }

    const conflict = eventItems.find((item: any) => (item as any)?.resourceId === resourceId && (String((item as any)?.state) === "held" || String((item as any)?.state) === "confirmed") && String((item as any)?.ownerType) === "registration" && String((item as any)?.ownerId) !== String(registrationId));
    if (conflict) {
      throw Object.assign(
        new Error(`${itemType} ${resourceId} is already assigned`),
        { code: conflictCode, statusCode: 409 }
      );
    }

    resourcesToCreate.push(resourceId);
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
      itemType,
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
      new Error(`No ${itemType} block hold found for registration`),
      { code: "block_hold_not_found", statusCode: 400, context: { ownerId: registrationId, eventId, counts: debugCounts } }
    );
  }

  const blockQty = (blockHold as any)?.qty;
  if (blockQty !== resourceIds.length) {
    throw Object.assign(
      new Error(`Block hold qty (${blockQty}) does not match requested ${itemType} IDs (${resourceIds.length})`),
      { code: "qty_mismatch", statusCode: 400 }
    );
  }

  // Create per-resource holds with same state as block hold
  const blockState = (blockHold as any)?.state || "held";
  const perResourceHolds: any[] = [];

  // Include any preexisting holds (idempotent)
  for (const h of preexistingHolds) {
    perResourceHolds.push(h);
  }

  for (const resourceId of resourcesToCreate) {
    const perResourceHold = await createObject({
      tenantId,
      type: "reservationHold",
      body: {
        type: "reservationHold",
        ownerType: "registration",
        ownerId: registrationId,
        scopeType: "event",
        scopeId: eventId,
        itemType,
        qty: 1,
        resourceId,
        state: blockState,
        heldAt: (blockHold as any)?.heldAt || nowIso(),
        ...(blockState === "confirmed" ? { confirmedAt: nowIso() } : {}),
      },
    });
    perResourceHolds.push(perResourceHold);
  }

  // Release block hold with reason
  const releasedBlockHold = await updateObject({
    tenantId,
    type: "reservationHold",
    id: (blockHold as any)?.id,
    body: {
      state: "released",
      releasedAt: nowIso(),
      releaseReason: "assigned",
    },
  });

  // Return per-resource holds followed by released block hold
  return [...perResourceHolds, releasedBlockHold];
}

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
  const { assertStallResourcesExistAndAvailable } = await import("../resources/stalls");

  return assignResourcesToRegistration({
    tenantId,
    registrationId,
    eventId,
    itemType: "stall",
    resourceIds: stallIds,
    conflictCode: "stall_already_assigned",
    expectedResourceType: "stall",
    assertResourcesFn: assertStallResourcesExistAndAvailable as (args: Record<string, any>) => Promise<any[]>,
  });
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
  const { assertRvResourcesExistAndAvailable } = await import("../resources/rv-sites");

  return assignResourcesToRegistration({
    tenantId,
    registrationId,
    eventId,
    itemType: "rv",
    resourceIds: rvSiteIds,
    conflictCode: "rv_site_already_assigned",
    expectedResourceType: "rv",
    assertResourcesFn: assertRvResourcesExistAndAvailable as (args: Record<string, any>) => Promise<any[]>,
  });
}

