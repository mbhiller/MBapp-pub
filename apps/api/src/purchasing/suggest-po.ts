// apps/api/src/purchasing/suggest-po.ts
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, tableObjects } from "../common/ddb";
import { getObjectById } from "../objects/repo";
import { normalizeTypeParam } from "../objects/type-alias";
import { ensureLineIds } from "../shared/ensureLineIds";
import { resolveInventoryByEitherType } from "../backorders/related-refs";

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
  productId?: string;
  qty: number;               // qtySuggested (kept for backward compatibility)
  qtySuggested?: number;     // UI-friendly alias
  qtyRequested?: number;     // original requested qty before MOQ bump
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
  vendorName?: string;
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
 * Load an inventory item to extract productId (inventory/inventoryItem aliases are both supported)
 */
async function loadInventoryForProductId(tenantId: string, itemId: string): Promise<string | null> {
  // inventory and inventoryItem are aliases; resolve via shared helper so vendor derivation is resilient.
  const inv = await resolveInventoryByEitherType({ tenantId, itemId });
  const productId = inv?.obj?.productId;
  return productId ? String(productId) : null;
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

/**
 * Load MOQ from product without changing vendor selection.
 * Used when vendorId is already determined (from override or backorder).
 */
async function loadMinOrderQtyFromProduct(
  tenantId: string,
  productId: string
): Promise<number | null> {
  const prod = (await getObjectById({
    tenantId,
    type: "product",
    id: String(productId),
    fields: ["minOrderQty", "moq"],
  }).catch(() => null)) as
    | null
    | {
        minOrderQty?: number | null;
        moq?: number | null;
      };

  const moq =
    typeof prod?.minOrderQty === "number"
      ? prod!.minOrderQty
      : typeof prod?.moq === "number"
      ? (prod as any).moq
      : null;

  return moq;
}

async function loadVendorName(tenantId: string, vendorId: string, cache: Map<string, string | null>) {
  if (cache.has(vendorId)) return cache.get(vendorId) || undefined;
  try {
    const party = (await getObjectById({ tenantId, type: "party", id: vendorId, fields: ["name", "displayName", "legalName"] })) as any;
    const name = party?.name || party?.displayName || party?.legalName || null;
    cache.set(vendorId, name);
    return name || undefined;
  } catch {
    cache.set(vendorId, null);
    return undefined;
  }
}

function parseBody(event: APIGatewayProxyEventV2): SuggestPoReq | null {
  try {
    const parsed = event.body ? JSON.parse(event.body) : {};
    return parsed as SuggestPoReq;
  } catch {
    return null;
  }
}

export async function handle(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const auth: any = (event as any).requestContext?.authorizer?.mbapp || {};
  const tenantId: string = auth.tenantId;
  if (!tenantId) {
    return json(400, { message: "Missing tenant" });
  }

  const body = parseBody(event);
  if (!body) return json(400, { message: "Invalid JSON body" });

  if (!Array.isArray(body.requests) || body.requests.length === 0) {
    return json(400, { message: "requests[] required" });
  }

  for (const r of body.requests) {
    if (!r || typeof r.backorderRequestId !== "string" || !r.backorderRequestId.trim()) {
      return json(400, { message: "Each request must include backorderRequestId" });
    }
  }

  const overrideVendorId =
    typeof body.vendorId === "string" && body.vendorId.trim() ? body.vendorId.trim() : null;

  const vendorNameCache = new Map<string, string | null>();

  // Gather BO items with derived vendor + MOQ
  const gathered: {
    boId: string;
    itemId: string;
    productId: string | null;
    qtyRequested: number;
    vendorId: string;
    minOrderQty: number | null;
    uom?: string;
  }[] = [];
  const skipped: SkippedEntry[] = [];

  for (const r of body.requests) {
    const bo = await loadBackorder(tenantId, r.backorderRequestId);
    if (!bo || normalizeTypeParam(bo.type as string) !== "backorderRequest") {
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
    const boItemId = bo.itemId ? String(bo.itemId) : null;
    let boProductId: string | null = bo.productId ? String(bo.productId) : null;

    // Derive vendor & MOQ if not present on BO and no override
    if (!vendorId) {
      const itemId = boItemId;
      let productId: string | null = boProductId;

      if (!productId && itemId) {
        productId = await loadInventoryForProductId(tenantId, itemId);
        boProductId = productId;
      }

      if (productId) {
        const { vendorId: derivedVendorId, moq } = await loadProductVendorAndMoq(tenantId, productId);
        vendorId = derivedVendorId ? String(derivedVendorId).trim() : null;
        minOrderQty = moq;
      }
    }

    // If vendorId is now set (from override or BO), but MOQ not yet loaded, load it now
    if (vendorId && minOrderQty === null) {
      const itemId = boItemId;
      let productId: string | null = boProductId;

      if (!productId && itemId) {
        productId = await loadInventoryForProductId(tenantId, itemId);
        boProductId = productId;
      }

      if (productId) {
        minOrderQty = await loadMinOrderQtyFromProduct(tenantId, productId);
      }
    }

    if (!vendorId) {
      skipped.push({ backorderRequestId: bo.id, reason: "MISSING_VENDOR" });
      continue;
    }

    gathered.push({
      boId: bo.id,
      itemId: String(boItemId ?? boProductId ?? ""),
      productId: boProductId,
      qtyRequested: qty,
      vendorId,
      minOrderQty,
      uom: bo.uom ? String(bo.uom) : "ea",
    });
  }

  // Group lines by vendor (override already applied per entry).
  const groups = new Map<string, PurchaseOrderLine[]>();

  for (const it of gathered) {
    const key = it.vendorId;
    const baseQty = Math.max(0, Number(it.qtyRequested || 0));
    const bumpedQty =
      it.minOrderQty && baseQty > 0 && baseQty < it.minOrderQty ? it.minOrderQty : baseQty;

    // Find all backorderRequestIds for this item/vendor
    const backorderRequestIds = [it.boId];

    // NOTE: suggest-po is a pure read/compute endpoint. It does NOT mutate backorder status.
    // Callers must explicitly convert backorders via POST /objects/backorderRequest/{id}:convert
    // if they want to track conversion state. backorderRequestIds in the draft enables that flow.

    const line: PurchaseOrderLine = {
      itemId: it.itemId,
      productId: it.productId ?? undefined,
      qty: bumpedQty,
      qtySuggested: bumpedQty,
      qtyRequested: baseQty,
      uom: it.uom ?? "ea",
      backorderRequestIds,
    };
    if (it.minOrderQty && baseQty < it.minOrderQty) {
      line.minOrderQtyApplied = it.minOrderQty;
      line.adjustedFrom = baseQty;
    }

    const arr = groups.get(key) ?? [];
    const existing = arr.find((l) => l.itemId === line.itemId && l.productId === line.productId);
    if (existing) {
      existing.qty += line.qty;
      existing.qtySuggested = (existing.qtySuggested ?? 0) + line.qty;
      existing.qtyRequested = (existing.qtyRequested ?? 0) + baseQty;
      existing.backorderRequestIds = Array.from(new Set([...(existing.backorderRequestIds ?? []), ...backorderRequestIds]));
      if (!existing.uom) existing.uom = line.uom;
      if (line.minOrderQtyApplied && !existing.minOrderQtyApplied) existing.minOrderQtyApplied = line.minOrderQtyApplied;
      if (line.adjustedFrom && !existing.adjustedFrom) existing.adjustedFrom = line.adjustedFrom;
    } else {
      arr.push(line);
    }
    groups.set(key, arr);
  }

  // Emit drafts
  const now = new Date().toISOString();
  const drafts: PurchaseOrderDraft[] = [];

  for (const [key, lines] of groups.entries()) {
    const withIds = ensureLineIds<PurchaseOrderLine>(lines) as PurchaseOrderLine[];
    const vendorName = await loadVendorName(tenantId, key, vendorNameCache);
    drafts.push({
      id: poDraftId(),
      type: "purchaseOrder",
      status: "draft",
      vendorId: key,
      vendorName: vendorName ?? undefined,
      currency: "USD",
      lines: withIds,
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
