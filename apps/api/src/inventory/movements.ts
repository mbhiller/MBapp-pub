// apps/api/src/inventory/movements.ts
// Canonical movements list (verb = `action`; array response), with a real repo using pk/sk.

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";

type SortDir = "asc" | "desc";

// --- Canonical action union + guard ---
const ACTIONS = ["receive","reserve","commit","fulfill","adjust","release"] as const;
export type Action = typeof ACTIONS[number];
function asAction(v: unknown): Action | undefined {
  const s = String(v ?? "").toLowerCase();
  return (ACTIONS as readonly string[]).includes(s) ? (s as Action) : undefined;
}

export type InventoryMovement = {
  id: string;
  itemId: string;
  action: Action;        // strict union
  qty: number;
  at?: string;
  note?: string;
  actorId?: string;
  refId?: string;
  poLineId?: string;
  lot?: string;          // NEW: surface lot
  locationId?: string;   // NEW: surface location
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
  // Prefer authorizer if present, then headers, finally default
  const auth = event?.requestContext?.authorizer?.mbapp?.tenantId
           ||  event?.requestContext?.authorizer?.jwt?.claims?.["custom:tenantId"];
  if (auth) return String(auth);
  const h = event?.headers || {};
  return h["X-Tenant-Id"] || h["x-tenant-id"] || h["X-tenant-id"] || h["x-Tenant-Id"] || "DemoTenant";
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
  const pageTarget = Math.max(1, Math.min(1000, opts.limit ?? 50));
  const skPrefix = "inventoryMovement#";

  let items: InventoryMovement[] = [];
  let lastKey = decodeCursor(opts.next || undefined);
  // Safety cap so we don’t scan forever if a tenant has tons of data
  const MAX_PAGES = 8;

  for (let i = 0; i < MAX_PAGES && items.length < pageTarget; i++) {
    const out = await ddb.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
      ExpressionAttributeValues: { ":pk": tenantId, ":sk": skPrefix },
      ExclusiveStartKey: lastKey,
      // This is still lexicographic on sk; we’ll re-sort by timestamps in memory below
      ScanIndexForward: (opts.sort ?? "desc") === "asc",
      // We purposely fetch a fatter page because we local-filter by itemId
      Limit: Math.min(pageTarget * 3, 300),
    }));

    const raw = (out.Items ?? []) as any[];

    const pageItems: InventoryMovement[] = raw
      .filter((m) => m?.itemId === itemId)
      .map((m) => {
        const action =
          asAction(m?.action) ??
          asAction(m?.movement) ??
          asAction(m?.act) ??
          asAction(m?.verb) ??
          asAction(m?.type);
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
          lot: m.lot,
          locationId: m.locationId,
          docType: "inventoryMovement",
          createdAt: m.createdAt,
        } as InventoryMovement;
      })
      .filter(Boolean) as InventoryMovement[];

    items.push(...pageItems);
    lastKey = out.LastEvaluatedKey;
    if (!lastKey) break; // no more data
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

  // Pass-through, but include poLineId + lot + locationId so clients/smokes can assert them.
  const clean: InventoryMovement[] = items.map((m) => ({
    id: m.id,
    itemId: m.itemId,
    action: m.action as Action,
    qty: m.qty,
    at: m.at,
    note: m.note,
    actorId: m.actorId,
    refId: m.refId,
    poLineId: m.poLineId,        // keep
    lot: m.lot,                  // keep
    locationId: m.locationId,    // keep
    docType: "inventoryMovement",
  }));

  const pageInfo = next ? { hasNext: true as const, nextCursor: next, pageSize: opts.limit } : undefined;
  return { itemId, items: clean as InventoryMovement[], next: next ?? null, pageInfo };
}

// ===== HTTP handler for GET /inventory/{id}/movements =====
export async function handle(event: any) {
  const id: string | undefined = event?.pathParameters?.id;
  if (!id) return respond(400, { error: "BadRequest", message: "Missing id" });

  const tenantId = getTenantId(event);
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

export default { handle, listMovementsByItem };
