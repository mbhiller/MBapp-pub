// apps/api/src/sales/so-commit.ts
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { ddb, tableObjects } from "../common/ddb";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import * as InvOnHandBatch from "../inventory/onhand-batch";
import { getObjectById, createObject } from "../objects/repo";
import { resolveTenantId } from "../common/tenant";

type SOStatus =
  | "draft"
  | "submitted"
  | "approved"
  | "committed"
  | "partially_fulfilled"
  | "fulfilled"
  | "cancelled"
  | "closed";

type SOLine = {
  id: string;
  itemId: string;
  uom?: string;
  qty: number;
  qtyCommitted?: number;
};

type SalesOrder = {
  pk: string; // tenant id
  sk: string; // salesOrder#<id>
  id: string;
  type: "salesOrder";
  status: SOStatus;
  lines?: SOLine[];
  [k: string]: any;
};

const DEBUG = process.env.MBAPP_DEBUG === "1" || process.env.DEBUG === "1";
const log = (event: APIGatewayProxyEventV2, tag: string, data: Record<string, any>) => {
  if (!DEBUG) return;
  const reqId = (event.requestContext as any)?.requestId;
  try { console.log(JSON.stringify({ tag, reqId, ...data })); } catch {}
};

const json = (statusCode: number, body: unknown): APIGatewayProxyResultV2 => ({
  statusCode,
  headers: {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "OPTIONS,GET,POST,PUT,DELETE",
    "access-control-allow-headers": "Authorization,Content-Type,Idempotency-Key,X-Tenant-Id,Accept",
  },
  body: JSON.stringify(body),
});

function tenantIdOf(event: APIGatewayProxyEventV2): string {
  return resolveTenantId(event);
}

function isStrict(event: APIGatewayProxyEventV2): boolean {
  const q = event.queryStringParameters || {};
  if (q.strict === "1" || q.strict === "true") return true;
  if (event.body) {
    try {
      const b = JSON.parse(event.body);
      if (b?.strict === true) return true;
    } catch {}
  }
  return false;
}

async function loadSO(tenantId: string, id: string): Promise<SalesOrder | null> {
  const sk = `salesOrder#${id}`;
  const res = await ddb.send(
    new GetCommand({
      TableName: tableObjects,
      Key: { pk: tenantId, sk },
    })
  );
  return (res.Item as SalesOrder) ?? null;
}

async function saveSO(order: SalesOrder): Promise<void> {
  const now = new Date().toISOString();
  const out: SalesOrder = { ...order, updatedAt: now };
  await ddb.send(new PutCommand({ TableName: tableObjects, Item: out }));
}

async function getProductForItem(tenantId: string, itemId: string) {
  const inv = await getObjectById({ tenantId, type: "inventory", id: itemId }).catch(() => null);
  const productId = (inv as any)?.productId;
  if (!productId) return null;
  return await getObjectById({ tenantId, type: "product", id: productId }).catch(() => null);
}
function boId() { return "bo_" + Math.random().toString(36).slice(2, 10); }

export async function handle(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  try {
    const tenantId = tenantIdOf(event);
    const id = event.pathParameters?.id;
    if (!tenantId || !id) return json(400, { message: "Missing tenant or id" });

    const strict = isStrict(event);

    const so = await loadSO(tenantId, id);
    if (!so) return json(404, { message: "Sales order not found" });
    log(event, "so-commit.load", { id: so.id, status: so.status, lines: (so.lines ?? []).length, strict });

    // Allow from submitted/approved; if already committed, idempotent
    if (so.status !== "submitted" && so.status !== "approved" && so.status !== "committed") {
      return json(409, { message: `Cannot commit from status=${so.status}` });
    }

    const lines: SOLine[] = Array.isArray(so.lines) ? so.lines : [];
    const itemIds = [...new Set(lines.map((l) => l.itemId).filter(Boolean))];

    if (itemIds.length === 0) {
      const before = so.status;
      if (so.status === "submitted" || so.status === "approved") so.status = "committed";
      await saveSO(so);
      log(event, "so-commit.saved", { id: so.id, before, after: so.status, reason: "no_lines" });
      return json(200, so);
    }

    // Query availability using the in-process onhand-batch handler
    const batchEvt: APIGatewayProxyEventV2 = {
      ...event,
      body: JSON.stringify({ itemIds }),
      requestContext: {
        ...event.requestContext,
        http: { ...(event.requestContext as any)?.http, method: "POST", path: "/inventory/onhand:batch" },
      } as any,
      rawPath: "/inventory/onhand:batch",
    };
    const batchRes = await InvOnHandBatch.handle(batchEvt);
    const batchBody = (() => {
      try { return JSON.parse(batchRes.body || "{}"); } catch { return {}; }
    })();
    const availability: Record<string, { onHand: number; reserved: number; available: number }> = {};
    for (const it of batchBody?.items ?? []) {
      availability[it.itemId] = {
        onHand: Number(it.onHand ?? 0),
        reserved: Number(it.reserved ?? 0),
        available: Number(it.available ?? 0),
      };
    }

    // Sum required qty by item across lines (minus any prior committed)
    const needByItem = new Map<string, number>();
    for (const l of lines) {
      const already = Number(l.qtyCommitted ?? 0);
      const need = Math.max(0, Number(l.qty ?? 0) - already);
      needByItem.set(l.itemId, (needByItem.get(l.itemId) ?? 0) + need);
    }

    const shortages: Array<{ lineId: string; itemId: string; backordered: number }> = [];
    for (const l of lines) {
      const need = needByItem.get(l.itemId) ?? 0;
      const avail = availability[l.itemId]?.available ?? 0;
      const backordered = Math.max(0, need - avail);
      if (backordered > 0 && !shortages.find((s) => s.itemId === l.itemId)) {
        shortages.push({ lineId: l.id, itemId: l.itemId, backordered });
      }
    }
    log(event, "so-commit.availability", { itemIds, availability, shortages, strict });

    if (strict && shortages.length > 0) {
      return json(409, { message: "Insufficient availability", shortages });
    }

    // Non-strict: proceed and mark committed (idempotently).
    const before = so.status;
    // Advance status if needed
    if (so.status === "submitted" || so.status === "approved") {
      so.status = "committed";
    }

    // Persist shortages for UI (optional, non-strict path)
    if (shortages.length > 0) {
      (so as any).backorders = shortages.map(s => ({
        itemId: s.itemId,
        lineId: s.lineId,
        backordered: s.backordered
      }));
    } else {
      delete (so as any).backorders;
    }
    
    await saveSO(so);
    log(event, "so-commit.saved", { id: so.id, before, after: so.status, strict, shortagesCount: shortages.length });

    // Create BackorderRequest rows for actionable shortages (reorderEnabled only)
    if (!strict && shortages.length > 0) {
      const tenantId = tenantIdOf(event);
      const now = new Date().toISOString();
      for (const s of shortages) {
        const product = await getProductForItem(tenantId, s.itemId);
        const reorderEnabled = product == null ? true : (product as any).reorderEnabled !== false;
        if (!reorderEnabled) continue;
        
        // Derive preferredVendorId from inventory item or product
        let preferredVendorId: string | undefined;
        try {
          const inv = await getObjectById({ tenantId, type: "inventory", id: s.itemId }).catch(() => null);
          preferredVendorId = (inv as any)?.preferredVendorId ?? (inv as any)?.vendorId;
          if (!preferredVendorId && product) {
            preferredVendorId = (product as any)?.preferredVendorId ?? (product as any)?.vendorId ?? (product as any)?.defaultVendorId;
          }
        } catch {}
        
        const bo: any = {
          id: boId(),
          type: "backorderRequest",
          tenantId,
          soId: so.id,
          soLineId: s.lineId,
          itemId: s.itemId,
          qty: s.backordered,
          status: "open",
          createdAt: now,
          updatedAt: now,
        };
        if (preferredVendorId) bo.preferredVendorId = preferredVendorId;
        await createObject({ tenantId, type: "backorderRequest", body: bo });
      }
    }

    // Return order plus shortages[] (for UI awareness)
    return json(200, { ...so, shortages: shortages.length ? shortages : undefined });
  } catch (err: any) {
    log(event, "so-commit.error", { message: err?.message });
    return json(500, { message: err?.message ?? "Internal Server Error" });
  }
}
