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
  docType?: "inventoryMovement";
  createdAt?: string;    // storage field (used only for sorting fallback)
};

export type ListOptions = { next?: string | null; limit?: number; sort?: SortDir };
export type ListMovementsPage = {
  itemId: string;
  items: InventoryMovement[];
  next: string | null;
  // NEW (optional): richer pagination metadata; clients may ignore
  pageInfo?: { hasNext?: boolean; nextCursor?: string | null; pageSize?: number };
};

// ===== local helpers (no external json util) =====
function respond(status: number, body: unknown) {
  return { statusCode: status, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

function getTenantId(event: any): string {
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
  const limit = Math.max(1, Math.min(1000, opts.limit ?? 50));
  const skPrefix = "inventoryMovement#";

  const cmd = new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
    ExpressionAttributeValues: { ":pk": tenantId, ":sk": skPrefix },
    ExclusiveStartKey: decodeCursor(opts.next || undefined),
    Limit: limit,
    ScanIndexForward: (opts.sort ?? "desc") === "asc",
  });

  const out = await ddb.send(cmd);
  const raw = (out.Items ?? []) as any[];

  // Filter to requested item + coerce to canonical shape
  const items: InventoryMovement[] = raw
    .filter((m) => m?.itemId === itemId)
    .map((m) => {
      // Accept verb from multiple legacy fields if needed
      const action =
        asAction(m?.action) ??
        asAction(m?.movement) ??
        asAction(m?.act) ??
        asAction(m?.verb) ??
        asAction(m?.type);
      // Skip any rows that don't have a valid canonical action
      if (!action) return undefined;
      const out: InventoryMovement = {
        id: String(m.id),
        itemId: String(m.itemId),
        action,                      // <- union type ensured
        qty: Number(m.qty ?? 0),
        at: m.at || m.createdAt,
        note: m.note,
        actorId: m.actorId,
        refId: m.refId,
        poLineId: m.poLineId,
        docType: "inventoryMovement",
        createdAt: m.createdAt,
      };
      return out;
    })
    .filter(Boolean) as InventoryMovement[];

  // Secondary in-memory sort (by at/createdAt) for stability
  const dir = (opts.sort ?? "desc") === "asc" ? 1 : -1;
  items.sort((a, b) => {
    const ta = Date.parse(a.at ?? a.createdAt ?? "0");
    const tb = Date.parse(b.at ?? b.createdAt ?? "0");
    if (ta === tb) return 0;
    return ta < tb ? -1 * dir : 1 * dir;
  });

  const next = encodeCursor(out.LastEvaluatedKey);
  return { items, next };
}

// ===== Reusable API for other modules =====
export async function listMovementsByItem(
  tenantId: string,
  itemId: string,
  opts: ListOptions = {}
): Promise<ListMovementsPage> {
  const { items, next } = await repoListMovementsByItem(tenantId, itemId, opts);

  // Clean pass-through (already canonical), but keep a final cast so TS knows it's exact:
  const clean: InventoryMovement[] = items.map((m) => ({
    id: m.id,
    itemId: m.itemId,
    action: m.action as Action,
    qty: m.qty,
    at: m.at,
    note: m.note,
    actorId: m.actorId,
    refId: m.refId,
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
  const next: string | undefined = qs.next || undefined;
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
