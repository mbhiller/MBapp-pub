// apps/api/src/inventory/movements.ts
// Canonical movements list (verb = `action`; array response), with a real repo using pk/sk.

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { resolveTenantId } from "../common/tenant";

type SortDir = "asc" | "desc";

// --- Canonical action union + guard ---
const ACTIONS = ["receive","reserve","commit","fulfill","adjust","release","putaway","cycle_count"] as const;
export type Action = typeof ACTIONS[number];
function asAction(v: unknown): Action | undefined {
  const s = String(v ?? "").toLowerCase();
  return (ACTIONS as readonly string[]).includes(s) ? (s as Action) : undefined;
}

/**
 * InventoryMovement: Canonical movement record with action, qty, and optional linkage fields.
 * 
 * Linkage fields (soId, soLineId, poLineId) enable:
 * - Cross-action correlation: reserve→commit→fulfill flows
 * - Commit location derivation: so-commit queries reserve movements by soId+soLineId to derive locationId/lot
 * - Audit trails: track which PO/SO caused each movement
 * 
 * All linkage/location fields are optional for backwards compatibility.
 */
export type InventoryMovement = {
  id: string;
  itemId: string;
  action: Action;        // strict union
  qty: number;
  at?: string;
  note?: string;
  actorId?: string;
  refId?: string;
  poLineId?: string;     // purchase order line linkage
  soId?: string;         // sales order linkage (for reserve/commit/release/fulfill)
  soLineId?: string;     // sales order line linkage (enables commit location derivation)
  lot?: string;          // lot tracking
  locationId?: string;   // location tracking
  docType?: "inventoryMovement";
  createdAt?: string;    // storage field (used only for sorting fallback)
};

export type ListOptions = { next?: string | null; limit?: number; sort?: SortDir };
export type ListMovementsPage = {
  itemId: string;
  items: InventoryMovement[];
  next: string | null;
  // Optional richer pagination metadata; clients may ignore
  pageInfo?: { hasNext?: boolean; nextCursor?: string | null; pageSize?: number };
};

// ===== local helpers (no external json util) =====
function respond(status: number, body: unknown) {
  return { statusCode: status, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

function getTenantId(event: any): string {
  return resolveTenantId(event);
}

function encodeCursor(key: any | undefined): string | null {
  if (!key) return null;
  return Buffer.from(JSON.stringify(key)).toString("base64");
}
function decodeCursor(next?: string | null) {
  if (!next) return undefined;
  try { return JSON.parse(Buffer.from(next, "base64").toString("utf8")); } catch { return undefined; }
}

// ===== Dynamo repo (pk/sk) =====
const TABLE = process.env.DYNAMO_TABLE || process.env.TABLE_NAME || process.env.MBAPP_TABLE || "mbapp_objects";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

type RepoOut = { items: InventoryMovement[]; next: string | null };

async function repoListMovementsByItem(
  tenantId: string,
  itemId: string,
  opts: ListOptions
): Promise<RepoOut> {
  const requestedLimit = Math.max(1, Math.min(200, opts.limit ?? 50));
  const skPrefix = "inventoryMovement#";

  let matches: InventoryMovement[] = [];
  let lastKey = decodeCursor(opts.next || undefined);
  
  // Calculate scan page size: scan more to find matches faster
  const scanPageSize = Math.min(500, Math.max(50, requestedLimit * 10));
  const MAX_SCAN_PAGES = 10;

  for (let i = 0; i < MAX_SCAN_PAGES && matches.length < requestedLimit; i++) {
    const out = await ddb.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
      ExpressionAttributeValues: { ":pk": tenantId, ":sk": skPrefix },
      ExclusiveStartKey: lastKey,
      ConsistentRead: true,
      ScanIndexForward: false,  // Newest movements first (descending sk order)
      Limit: scanPageSize,
    }));

    const raw = (out.Items ?? []) as any[];
    const wantItemId = String(itemId); // normalize to avoid number/string mismatches

    const pageMatches: InventoryMovement[] = raw
      .filter((m) => {
        // Ensure it's actually a movement document
        const isMovement = m?.docType === "inventoryMovement" || m?.type === "inventoryMovement";
        if (!isMovement) return false;
        // Filter by itemId
        return String(m?.itemId) === wantItemId;
      })
      .map((m) => {
        const action =
          asAction(m?.action) ??
          asAction(m?.movement) ??
          asAction(m?.act) ??
          asAction(m?.verb);
        if (!action) return undefined;
        return {
          id: String(m.id),
          itemId: String(m.itemId),
          action,
          qty: Number(m.qty ?? 0),
          at: m.at || m.createdAt,
          note: m.note,
          actorId: m.actorId,
          refId: m.refId,
          poLineId: m.poLineId,
          soId: m.soId,
          soLineId: m.soLineId,
          lot: m.lot,
          locationId: m.locationId,
          docType: "inventoryMovement",
          createdAt: m.createdAt,
        } as InventoryMovement;
      })
      .filter(Boolean) as InventoryMovement[];

    matches.push(...pageMatches);
    lastKey = out.LastEvaluatedKey;
    if (!lastKey) break; // no more data in tenant
  }

  // In-memory stable sort by at/createdAt (newest first for desc, oldest first for asc)
  const dir = (opts.sort ?? "desc") === "asc" ? 1 : -1;
  matches.sort((a, b) => {
    const ta = Date.parse(a.at ?? a.createdAt ?? "0");
    const tb = Date.parse(b.at ?? b.createdAt ?? "0");
    if (ta === tb) return 0;
    return ta < tb ? -1 * dir : 1 * dir;
  });

  // Trim to the requested page size
  const items = matches.slice(0, requestedLimit);

  // If we didn’t hit pageTarget but still have a LastEvaluatedKey, that means
  // there may be more matches further; keep passing a cursor so clients can continue.
  const next = encodeCursor(lastKey);
  return { items, next };
}


// ===== Reusable API for other modules =====
export async function listMovementsByItem(
  tenantId: string,
  itemId: string,
  opts: ListOptions = {}
): Promise<ListMovementsPage> {
  const { items, next } = await repoListMovementsByItem(tenantId, itemId, opts);

  // Pass-through response includes all tracked fields for clients/smokes:
  // - poLineId, soId, soLineId: enable cross-action correlation (reserve→commit→fulfill)
  //   and support commit location derivation (so-commit queries reserve movements by soId+soLineId)
  // - lot, locationId: enable location-aware counters and audit trails
  // These fields are optional; if absent in DB, they are omitted from response (backwards compatible).
  const clean: InventoryMovement[] = items.map((m) => ({
    id: m.id,
    itemId: m.itemId,
    action: m.action as Action,
    qty: m.qty,
    at: m.at,
    note: m.note,
    actorId: m.actorId,
    refId: m.refId,
    poLineId: m.poLineId,        // purchase order line linkage
    soId: m.soId,                // sales order linkage (reserve/commit/fulfill)
    soLineId: m.soLineId,        // sales order line linkage (for commit location derivation)
    lot: m.lot,                  // lot tracking
    locationId: m.locationId,    // location tracking
    docType: "inventoryMovement",
  }));

  const pageInfo = next ? { hasNext: true as const, nextCursor: next, pageSize: opts.limit } : undefined;
  return { itemId, items: clean as InventoryMovement[], next: next ?? null, pageInfo };
}

// ===== List movements by location (new endpoint) =====
async function repoListMovementsByLocation(
  tenantId: string,
  locationId: string,
  opts: ListOptions & { action?: string; refId?: string }
): Promise<RepoOut> {
  const pageTarget = Math.max(1, Math.min(200, opts.limit ?? 50));
  const skPrefix = "inventoryMovement#";

  let items: InventoryMovement[] = [];
  let lastKey = decodeCursor(opts.next || undefined);
  const MAX_PAGES = 8;

  for (let i = 0; i < MAX_PAGES && items.length < pageTarget; i++) {
    const out = await ddb.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
      ExpressionAttributeValues: { ":pk": tenantId, ":sk": skPrefix },
      ExclusiveStartKey: lastKey,
      ScanIndexForward: (opts.sort ?? "desc") === "asc",
      Limit: Math.min(pageTarget * 3, 300),
    }));

    const raw = (out.Items ?? []) as any[];
    const wantLocationId = String(locationId);

    const pageItems: InventoryMovement[] = raw
      .filter((m) => {
        // Ensure it's actually a movement document
        const isMovement = m?.docType === "inventoryMovement" || m?.type === "inventoryMovement";
        if (!isMovement) return false;
        // Required filter: locationId must match
        if (String(m?.locationId ?? "") !== wantLocationId) return false;
        // Optional filters
        if (opts.action && asAction(m?.action) !== opts.action) return false;
        if (opts.refId && String(m?.refId ?? "") !== opts.refId) return false;
        return true;
      })
      .map((m) => {
        const action =
          asAction(m?.action) ??
          asAction(m?.movement) ??
          asAction(m?.act) ??
          asAction(m?.verb);
        if (!action) return undefined;
        return {
          id: String(m.id),
          itemId: String(m.itemId),
          action,
          qty: Number(m.qty ?? 0),
          at: m.at || m.createdAt,
          note: m.note,
          actorId: m.actorId,
          refId: m.refId,
          poLineId: m.poLineId,
          soId: m.soId,
          soLineId: m.soLineId,
          lot: m.lot,
          locationId: m.locationId,
          docType: "inventoryMovement",
          createdAt: m.createdAt,
        } as InventoryMovement;
      })
      .filter(Boolean) as InventoryMovement[];

    items.push(...pageItems);
    lastKey = out.LastEvaluatedKey;
    if (!lastKey) break;
  }

  // In-memory stable sort by at/createdAt
  const dir = (opts.sort ?? "desc") === "asc" ? 1 : -1;
  items.sort((a, b) => {
    const ta = Date.parse(a.at ?? a.createdAt ?? "0");
    const tb = Date.parse(b.at ?? b.createdAt ?? "0");
    if (ta === tb) return 0;
    return ta < tb ? -1 * dir : 1 * dir;
  });

  // Trim to the requested page size
  items = items.slice(0, pageTarget);

  const next = encodeCursor(lastKey);
  return { items, next };
}

export type ListMovementsByLocationResponse = {
  items: InventoryMovement[];
  next: string | null;
};

export async function listMovementsByLocation(
  tenantId: string,
  locationId: string,
  opts: ListOptions & { action?: string; refId?: string } = {}
): Promise<ListMovementsByLocationResponse> {
  const { items, next } = await repoListMovementsByLocation(tenantId, locationId, opts);

  // Include all linkage fields (soId, soLineId, poLineId) for audit trail and cross-action correlation.
  // These enable commit location derivation (querying reserve movements by soId+soLineId)
  // and location-aware counter reconciliation. Fields are optional; omitted if not present.
  const clean: InventoryMovement[] = items.map((m) => ({
    id: m.id,
    itemId: m.itemId,
    action: m.action as Action,
    qty: m.qty,
    at: m.at,
    note: m.note,
    actorId: m.actorId,
    refId: m.refId,
    poLineId: m.poLineId,        // purchase order line linkage
    soId: m.soId,                // sales order linkage
    soLineId: m.soLineId,        // sales order line linkage
    lot: m.lot,                  // lot tracking
    locationId: m.locationId,    // location tracking
    docType: "inventoryMovement",
  }));

  return { items: clean as InventoryMovement[], next: next ?? null };
}

// ===== HTTP handler for GET /inventory/{id}/movements =====

// ===== Shared movement writer for consistency across putaway, cycle-count, adjust, etc. =====
function generateMovementId(prefix = "mv"): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export interface CreateMovementRequest {
  tenantId: string;
  itemId: string;
  action: Action;
  qty: number;
  locationId?: string;
  lot?: string;
  note?: string;
  refId?: string;
  poLineId?: string;
  soId?: string;
  soLineId?: string;
  actorId?: string;
}

export async function createMovement(req: CreateMovementRequest): Promise<InventoryMovement> {
  const PK = process.env.MBAPP_TABLE_PK || "pk";
  const SK = process.env.MBAPP_TABLE_SK || "sk";

  const now = new Date().toISOString();
  const movementId = generateMovementId("mv");

  const movement = {
    [PK]: req.tenantId,
    [SK]: `inventoryMovement#${movementId}`,
    id: movementId,
    type: "inventoryMovement",
    docType: "inventoryMovement",
    itemId: req.itemId,
    action: req.action,
    qty: req.qty,
    at: now,
    createdAt: now,
    updatedAt: now,
    ...(req.locationId && { locationId: req.locationId }),
    ...(req.lot && { lot: req.lot }),
    ...(req.note && { note: req.note }),
    ...(req.refId && { refId: req.refId }),
    ...(req.poLineId && { poLineId: req.poLineId }),
    ...(req.soId && { soId: req.soId }),
    ...(req.soLineId && { soLineId: req.soLineId }),
    ...(req.actorId && { actorId: req.actorId }),
  };

  await ddb.send(
    new PutCommand({
      TableName: TABLE,
      Item: movement as any,
    })
  );

  return {
    id: movementId,
    itemId: req.itemId,
    action: req.action,
    qty: req.qty,
    at: now,
    note: req.note,
    actorId: req.actorId,
    refId: req.refId,
    poLineId: req.poLineId,
    soId: req.soId,
    soLineId: req.soLineId,
    lot: req.lot,
    locationId: req.locationId,
    docType: "inventoryMovement",
    createdAt: now,
  };
}

export async function handle(event: any) {
  const id: string | undefined = event?.pathParameters?.id;
  if (!id) return respond(400, { error: "BadRequest", message: "Missing id" });

  let tenantId: string;
  try {
    tenantId = getTenantId(event);
  } catch (err: any) {
    const status = err?.statusCode ?? 400;
    return respond(status, { error: err?.code ?? "TenantError", message: err?.message ?? "Tenant resolution failed" });
  }
  const qs = event?.queryStringParameters ?? {};
  const limit = Number.isFinite(+qs.limit) ? Math.max(1, Math.min(1000, +qs.limit)) : 50;
  const sort: SortDir = String(qs.sort ?? "desc").toLowerCase() === "asc" ? "asc" : "desc";
  const next: string | undefined = (qs.next || qs.cursor || qs.pageToken) || undefined; // accept aliases
  const refId: string | undefined = qs.refId || undefined;
  const poLineId: string | undefined = qs.poLineId || undefined;

  const page = await listMovementsByItem(tenantId, id, { limit, sort, next });
  // Additive in-memory filters
  const items = page.items.filter(m => {
    if (refId && m.refId !== refId) return false;
    if (poLineId && m.poLineId !== poLineId) return false;
    return true;
  });
  const out = { ...page, items };
  return respond(200, out);
}

// ===== HTTP handler for GET /inventory/movements?locationId={id} =====
export async function handleByLocation(event: any) {
  let tenantId: string;
  try {
    tenantId = getTenantId(event);
  } catch (err: any) {
    const status = err?.statusCode ?? 400;
    return respond(status, { error: err?.code ?? "TenantError", message: err?.message ?? "Tenant resolution failed" });
  }

  const qs = event?.queryStringParameters ?? {};
  const locationId = String(qs.locationId ?? "").trim();
  if (!locationId) {
    return respond(400, { error: "BadRequest", message: "locationId is required" });
  }

  const limit = Number.isFinite(+qs.limit) ? Math.max(1, Math.min(200, +qs.limit)) : 50;
  const sort: SortDir = String(qs.sort ?? "desc").toLowerCase() === "asc" ? "asc" : "desc";
  const next: string | undefined = (qs.next || qs.cursor || qs.pageToken) || undefined;
  const action: string | undefined = qs.action ? String(qs.action).toLowerCase() : undefined;
  const refId: string | undefined = qs.refId ? String(qs.refId).trim() : undefined;

  const result = await listMovementsByLocation(tenantId, locationId, { limit, sort, next, action, refId });
  return respond(200, result);
}

export default { handle, handleByLocation, listMovementsByItem, listMovementsByLocation, createMovement };

