// apps/api/src/purchasing/suggest-po.ts
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, tableObjects } from "../common/ddb";
import { getObjectById } from "../objects/repo";

/**
 * Request body shape
 */
type SuggestPoReq = {
  requests: { backorderRequestId: string }[];
  /** If provided, force all drafted lines to this vendor (Party.id with vendor role). */
  vendorId?: string | null;
};

/**
 * Outbound PO line (draft)
 */
type PurchaseOrderLine = {
  itemId: string;
  qty: number;
  uom?: string;
  /** Annotation for UI when MOQ bumps the quantity */
  minOrderQtyApplied?: number;
  adjustedFrom?: number;
};

/**
 * Outbound PO (draft, not persisted)
 */
type PurchaseOrderDraft = {
  id: string;
  type: "purchaseOrder";
  status: "draft";
  /** This is Party.id with PartyRole=vendor */
  vendorId: string;
  currency: string;
  lines: PurchaseOrderLine[];
  createdAt: string;
  updatedAt: string;
};

const json = (statusCode: number, body: unknown): APIGatewayProxyResultV2 => ({
  statusCode,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const PK = process.env.MBAPP_TABLE_PK || "pk";
const SK = process.env.MBAPP_TABLE_SK || "sk";

/** Simple id generator for transient drafts */
const poDraftId = () => "po_" + Math.random().toString(36).slice(2, 10);

/**
 * Load a BackorderRequest by id
 */
async function loadBackorder(tenantId: string, boId: string): Promise<any | null> {
  const res = await ddb.send(
    new GetCommand({
      TableName: tableObjects,
      Key: { [PK]: tenantId, [SK]: `backorderRequest#${boId}` },
    })
  );
  return (res.Item as any) ?? null;
}

/**
 * Load an inventory item to extract productId (works with either "inventory" or "inventoryItem" type)
 */
async function loadInventoryForProductId(tenantId: string, itemId: string): Promise<string | null> {
  const invRes = await ddb.send(
    new GetCommand({
      TableName: tableObjects,
      Key: { [PK]: tenantId, [SK]: `inventory#${itemId}` },
    })
  );
  const inv = invRes.Item as any;
  if (inv && (inv.type === "inventory" || inv.type === "inventoryItem")) {
    return inv.productId ? String(inv.productId) : null;
  }
  return null;
}

/**
 * Load product vendor preference and MOQ.
 * Treats any of preferredVendorId/vendorId/defaultVendorId as a Party.id (vendor role).
 */
async function loadProductVendorAndMoq(
  tenantId: string,
  productId: string
): Promise<{ vendorId: string | null; moq: number | null }> {
  const prod = (await getObjectById({
    tenantId,
    type: "product",
    id: String(productId),
    fields: ["preferredVendorId", "vendorId", "defaultVendorId", "minOrderQty", "moq"],
  }).catch(() => null)) as
    | null
    | {
        preferredVendorId?: string | null;
        vendorId?: string | null;
        defaultVendorId?: string | null;
        minOrderQty?: number | null;
        moq?: number | null;
      };

  const vendorId =
    (prod?.preferredVendorId ??
      prod?.vendorId ??
      prod?.defaultVendorId ??
      null) || null;

  const moq =
    typeof prod?.minOrderQty === "number"
      ? prod!.minOrderQty
      : typeof prod?.moq === "number"
      ? (prod as any).moq
      : null;

  return { vendorId, moq };
}

export async function handle(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const auth: any = (event as any).requestContext?.authorizer?.mbapp || {};
  const tenantId: string = auth.tenantId;
  const body: SuggestPoReq = event.body ? JSON.parse(event.body) : { requests: [] };

  if (!Array.isArray(body.requests) || body.requests.length === 0) {
    return json(400, { message: "requests[] required" });
  }

  // Gather BO items with derived vendor + MOQ
  const gathered: {
    boId: string;
    itemId: string;
    qty: number;
    preferredVendorId: string | null;
    minOrderQty: number | null;
  }[] = [];

  for (const r of body.requests) {
    const bo = await loadBackorder(tenantId, r.backorderRequestId);
    if (!bo || bo.type !== "backorderRequest") continue;

    // Accept "open" or "converted" (bulk flow converts then suggests). Skip only explicit ignores.
    if (bo.status === "ignored") continue;

    let preferredVendorId: string | null = bo?.preferredVendorId ?? null;
    let minOrderQty: number | null = null;

    // Derive vendor & MOQ if not present on BO
    if (!preferredVendorId) {
      const itemId = bo.itemId ? String(bo.itemId) : null;
      let productId: string | null = bo.productId ?? null;

      if (!productId && itemId) {
        productId = await loadInventoryForProductId(tenantId, itemId);
      }

      if (productId) {
        const { vendorId, moq } = await loadProductVendorAndMoq(tenantId, productId);
        preferredVendorId = vendorId;
        minOrderQty = moq;
      }
    }

    gathered.push({
      boId: bo.id,
      itemId: String(bo.itemId ?? bo.productId ?? ""),
      qty: Number(bo.qty ?? 0),
      preferredVendorId,
      minOrderQty,
    });
  }

  if (gathered.length === 0) {
    return json(200, { drafts: [] });
  }

  // Group lines by vendor. If request.vendorId is provided, force single-vendor grouping.
  const V_UNKNOWN = "__unknown__";
  const groupKey = (v?: string | null) => (v && v.trim() ? v : V_UNKNOWN);

  const groups = new Map<string, PurchaseOrderLine[]>();

  for (const it of gathered) {
    const forcedVendor = body.vendorId ?? null;
    const key = groupKey(forcedVendor ?? it.preferredVendorId);

    const baseQty = Math.max(0, Number(it.qty || 0));
    const bumpedQty =
      it.minOrderQty && baseQty > 0 && baseQty < it.minOrderQty ? it.minOrderQty : baseQty;

    const line: PurchaseOrderLine = {
      itemId: it.itemId,
      qty: bumpedQty,
    };
    if (it.minOrderQty && baseQty < it.minOrderQty) {
      line.minOrderQtyApplied = it.minOrderQty;
      line.adjustedFrom = baseQty;
    }

    const arr = groups.get(key) ?? [];
    const existing = arr.find((l) => l.itemId === line.itemId);
    if (existing) {
      existing.qty += line.qty;
    } else {
      arr.push(line);
    }
    groups.set(key, arr);
  }

  // Emit drafts
  const now = new Date().toISOString();
  const drafts: PurchaseOrderDraft[] = [];

  for (const [key, lines] of groups.entries()) {
    const vendorId =
      key === V_UNKNOWN ? (body.vendorId ?? "") : key; // empty string if unknown and no forced vendor

    drafts.push({
      id: poDraftId(),
      type: "purchaseOrder",
      status: "draft",
      vendorId,
      currency: "USD",
      lines,
      createdAt: now,
      updatedAt: now,
    });
  }

  // If exactly one draft, return both the array and a single-draft alias for backward compatibility.
  if (drafts.length === 1) {
    return json(200, { draft: drafts[0], drafts });
  }
  return json(200, { drafts });
}
