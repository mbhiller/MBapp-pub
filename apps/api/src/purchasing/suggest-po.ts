// apps/api/src/purchasing/suggest-po.ts
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, tableObjects } from "../common/ddb";
import { getObjectById } from "../objects/repo";

type Req = { requests: { backorderRequestId: string }[]; vendorId?: string | null };

const json = (s: number, b: unknown): APIGatewayProxyResultV2 => ({
  statusCode: s,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(b),
});

// Key helpers
const PK = process.env.MBAPP_TABLE_PK || "pk";
const SK = process.env.MBAPP_TABLE_SK || "sk";
const poDraftId = () => "po_" + Math.random().toString(36).slice(2, 10);

export async function handle(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const auth: any = (event as any).requestContext?.authorizer?.mbapp || {};
  const tenantId: string = auth.tenantId;

  const body: Req = event.body ? JSON.parse(event.body) : { requests: [] };
  const ids = (body.requests || []).map(r => r.backorderRequestId).filter(Boolean);
  if (ids.length === 0) return json(400, { message: "requests[] required" });

  // Load BackorderRequests
  const bos = await Promise.all(ids.map(id => getObjectById({ tenantId, type: "backorderRequest", id }).catch(() => null)));
  const open = bos.filter(Boolean).filter((r: any) => r.status === "open") as any[];

  if (open.length === 0) return json(400, { message: "No open backorder requests" });

  // Resolve vendor per item via Product.preferredVendorId; fallback to input vendorId
  const groups = new Map<string, any[]>(); // vendorId -> items
  for (const r of open) {
    const inv = await getObjectById({ tenantId, type: "inventory", id: r.itemId }).catch(() => null);
    const productId = (inv as any)?.productId;
    let vendor = null as string | null;
    if (productId) {
      const product = await getObjectById({ tenantId, type: "product", id: productId }).catch(() => null);
      vendor = (product as any)?.preferredVendorId || null;
      // Skip do-not-reorder
      if ((product as any)?.reorderEnabled === false) continue;
    }
    vendor = vendor ?? (body.vendorId ?? null);
    if (!vendor) return json(400, { message: `vendorId required for item ${r.itemId}` });

    const list = groups.get(vendor) || [];
    list.push({ ...r });
    groups.set(vendor, list);
  }

  // For this endpoint, return a single PO draft if a single vendor was determined,
  // else error (multi-vendor split UX deferred per plan).
  if (groups.size !== 1) {
    return json(400, { message: "Multiple vendors in selection; call per vendor or provide vendorId" });
  }
  const [vendorId, rows] = Array.from(groups.entries())[0];

  // Roll-up by itemId and round up to minOrderQty when applicable
  const roll = new Map<string, { itemId: string; qty: number; minOrderQty?: number | null }>();
  for (const r of rows) {
    const key = r.itemId;
    const cur = roll.get(key) || { itemId: key, qty: 0 };
    cur.qty += Number(r.qty || 0);
    roll.set(key, cur);
  }

  const lines = [] as any[];
  for (const { itemId, qty } of roll.values()) {
    let finalQty = qty;
    // Pull Product.minOrderQty if available
    const inv = await getObjectById({ tenantId, type: "inventory", id: itemId }).catch(() => null);
    const productId = (inv as any)?.productId;
    let minOrderQty: number | null = null;
    if (productId) {
      const product = await getObjectById({ tenantId, type: "product", id: productId }).catch(() => null);
      minOrderQty = (product as any)?.minOrderQty ?? null;
    }
    if (typeof minOrderQty === "number" && minOrderQty > 0 && finalQty < minOrderQty) {
      finalQty = minOrderQty;
    }
    lines.push({ id: "ln_" + Math.random().toString(36).slice(2, 8), itemId, qty: finalQty, uom: "ea" });
  }

  const draft = {
    id: poDraftId(),
    type: "purchaseOrder",
    vendorId,
    status: "draft",
    currency: "USD",
    lines,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    // optional annotations for the UI could be added later
  };

  return json(200, draft);
}
