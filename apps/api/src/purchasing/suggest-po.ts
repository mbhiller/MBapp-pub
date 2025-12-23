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

type SkipReason = "ZERO_QTY" | "MISSING_VENDOR" | "IGNORED" | "NOT_FOUND";

type SkippedEntry = {
  backorderRequestId: string;
  reason: SkipReason;
};

/**
 * Outbound PO line (draft)
 */
type PurchaseOrderLine = {
  id?: string;
  itemId: string;
  qty: number;
  uom?: string;
  /** Annotation for UI when MOQ bumps the quantity */
  minOrderQtyApplied?: number;
  adjustedFrom?: number;
  backorderRequestIds?: string[];
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

  const overrideVendorId =
    typeof body.vendorId === "string" && body.vendorId.trim() ? body.vendorId.trim() : null;

  // Gather BO items with derived vendor + MOQ
  const gathered: {
    boId: string;
    itemId: string;
    qty: number;
    vendorId: string;
    minOrderQty: number | null;
  }[] = [];
  const skipped: SkippedEntry[] = [];

  for (const r of body.requests) {
    const bo = await loadBackorder(tenantId, r.backorderRequestId);
    if (!bo || bo.type !== "backorderRequest") {
      skipped.push({ backorderRequestId: r.backorderRequestId, reason: "NOT_FOUND" });
      continue;
    }

    // Accept "open" or "converted" (bulk flow converts then suggests). Skip only explicit ignores.
    if (bo.status === "ignored") {
      skipped.push({ backorderRequestId: bo.id, reason: "IGNORED" });
      continue;
    }

    const qty = Number(bo.qty ?? 0);
    if (!(qty > 0)) {
      skipped.push({ backorderRequestId: bo.id, reason: "ZERO_QTY" });
      continue;
    }

    let vendorId: string | null = overrideVendorId ?? (bo?.preferredVendorId ? String(bo.preferredVendorId).trim() : null);
    let minOrderQty: number | null = null;

    // Derive vendor & MOQ if not present on BO and no override
    if (!vendorId) {
      const itemId = bo.itemId ? String(bo.itemId) : null;
      let productId: string | null = bo.productId ?? null;

      if (!productId && itemId) {
        productId = await loadInventoryForProductId(tenantId, itemId);
      }

      if (productId) {
        const { vendorId: derivedVendorId, moq } = await loadProductVendorAndMoq(tenantId, productId);
        vendorId = derivedVendorId ? String(derivedVendorId).trim() : null;
        minOrderQty = moq;
      }
    }

    if (!vendorId) {
      skipped.push({ backorderRequestId: bo.id, reason: "MISSING_VENDOR" });
      continue;
    }

    gathered.push({
      boId: bo.id,
      itemId: String(bo.itemId ?? bo.productId ?? ""),
      qty,
      vendorId,
      minOrderQty,
    });
  }

  // Group lines by vendor (override already applied per entry).
  const groups = new Map<string, PurchaseOrderLine[]>();

  for (const it of gathered) {
    const key = it.vendorId;
    const baseQty = Math.max(0, Number(it.qty || 0));
    const bumpedQty =
      it.minOrderQty && baseQty > 0 && baseQty < it.minOrderQty ? it.minOrderQty : baseQty;

    // Find all backorderRequestIds for this item/vendor
    const backorderRequestIds = [it.boId];

    // Convert backorderRequest to status="converted" (minimal logic)
    try {
      const bo = await loadBackorder(tenantId, it.boId);
      if (bo && bo.status === "open") {
        // If convertBackorderRequest helper exists, use it; else update inline
        await ddb.send(new GetCommand({
          TableName: tableObjects,
          Key: { [PK]: tenantId, [SK]: `backorderRequest#${it.boId}` },
        }));
        bo.status = "converted";
        bo.updatedAt = new Date().toISOString();
        await ddb.send({
          TableName: tableObjects,
          Item: bo,
          // Use PutCommand if needed
        });
      }
    } catch {}

    const line: PurchaseOrderLine = {
      itemId: it.itemId,
      qty: bumpedQty,
      backorderRequestIds,
    };
    if (it.minOrderQty && baseQty < it.minOrderQty) {
      line.minOrderQtyApplied = it.minOrderQty;
      line.adjustedFrom = baseQty;
    }

    const arr = groups.get(key) ?? [];
    const existing = arr.find((l) => l.itemId === line.itemId);
    if (existing) {
      existing.qty += line.qty;
      // Merge backorderRequestIds
      existing.backorderRequestIds = Array.from(new Set([...(existing.backorderRequestIds ?? []), ...backorderRequestIds]));
    } else {
      arr.push(line);
    }
    groups.set(key, arr);
  }

  // Emit drafts
  const now = new Date().toISOString();
  const drafts: PurchaseOrderDraft[] = [];

  for (const [key, lines] of groups.entries()) {
    // Assign sequential line ids to any line missing one
    lines.forEach((ln, idx) => {
      if (!ln.id) ln.id = `L${idx + 1}`;
    });
    drafts.push({
      id: poDraftId(),
      type: "purchaseOrder",
      status: "draft",
      vendorId: key,
      currency: "USD",
      lines,
      createdAt: now,
      updatedAt: now,
    });
  }

  const payload: any = { drafts, skipped };

  // If exactly one draft, return both the array and a single-draft alias for backward compatibility.
  if (drafts.length === 1) {
    payload.draft = drafts[0];
  }

  return json(200, payload);
}
