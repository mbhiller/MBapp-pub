// apps/api/src/products/explode.ts
// Given a productId and a quantity, return the list of { itemId, qty } to consume.
// Handles: simple product (defaultItemId), product with BOM, and bundle (nested).

import { getObjectById, listObjects } from "../objects/repo";

type ItemNeed = { itemId: string; qty: number };

type BomRow = {
  id?: string;
  productId?: string;
  itemId?: string;
  qtyPer?: number;
  qty?: number;
  quantity?: number;
};

type BundleLine = {
  id?: string;
  productId?: string; // nested product
  itemId?: string;    // direct item in bundle
  qtyPer?: number;
  qty?: number;
  quantity?: number;
};

type Product = {
  id: string;
  kind?: string;              // "good" | "bundle" | etc.
  defaultItemId?: string;
  bundleLines?: BundleLine[]; // if kind === "bundle"
  // Some models also keep a BOM separate in a table; we fetch via listObjects.
};

export async function explodeToItems(
  tenantId: string,
  productId: string,
  qty: number
): Promise<ItemNeed[]> {
  const needs: Record<string, number> = {};
  const visited = new Set<string>(); // cycle guard
  await explodeRec(tenantId, productId, normalizeQty(qty), needs, visited);
  return Object.entries(needs).map(([itemId, n]) => ({ itemId, qty: n }));
}

async function explodeRec(
  tenantId: string,
  productId: string,
  qty: number,
  acc: Record<string, number>,
  visited: Set<string>
) {
  if (!productId || qty <= 0) return;
  if (visited.has(productId)) return; // prevent cycles
  visited.add(productId);

  const product = await getProductSafe(tenantId, productId);
  if (!product) throw new Error(`product_not_found:${productId}`);

  const kind = String(product.kind || "good").toLowerCase();

  // 1) Bundles: expand bundle lines (productId and/or itemId)
  if (kind === "bundle") {
    const lines: BundleLine[] = Array.isArray(product.bundleLines) ? product.bundleLines : [];
    for (const bl of lines) {
      const lineQty = normalizeQty(bl.qtyPer ?? bl.qty ?? bl.quantity ?? 1) * qty;
      if (lineQty <= 0) continue;

      if (bl.itemId) {
        add(acc, String(bl.itemId), lineQty);
      } else if (bl.productId) {
        await explodeRec(tenantId, String(bl.productId), lineQty, acc, visited);
      }
    }
    return;
  }

  // 2) BOM rows (separate table): expand to items
  const bomRows = await getBomRows(tenantId, productId);
  if (bomRows.length > 0) {
    for (const row of bomRows) {
      const per = normalizeQty(row.qtyPer ?? row.qty ?? row.quantity ?? 0);
      if (per <= 0 || !row.itemId) continue;
      add(acc, String(row.itemId), per * qty);
    }
    return;
  }

  // 3) Simple mapping via defaultItemId
  if (product.defaultItemId) {
    add(acc, String(product.defaultItemId), qty);
    return;
  }

  // 4) Fallback: if your modeling allows productId == itemId
  if (await existsObject(tenantId, "inventory", productId)) {
    add(acc, productId, qty);
    return;
  }

  throw new Error(`product_not_mapped_to_items:${productId}`);
}

/* -------------------- helpers (typed + safe) -------------------- */

async function getProductSafe(tenantId: string, id: string): Promise<Product | null> {
  try {
    const p = await getObjectById({ tenantId, type: "product", id });
    return (p as Product) ?? null;
  } catch {
    return null;
  }
}

async function getBomRows(tenantId: string, productId: string): Promise<BomRow[]> {
  // If your listObjects supports a filter, prefer server-side:
  // const page = await listObjects({ tenantId, type: "productBom", limit: 200, where: { productId } });
  const page: any = await listObjects({ tenantId, type: "productBom", limit: 200 });
  const items: BomRow[] = Array.isArray(page?.items) ? page.items : [];
  return items.filter((r) => String((r as any).productId || "") === productId);
}

async function existsObject(tenantId: string, type: string, id: string): Promise<boolean> {
  try {
    const obj = await getObjectById({ tenantId, type, id, fields: ["id"] });
    return Boolean(obj?.id);
  } catch {
    return false; // treat 404/NotFound as "doesn't exist"
  }
}

function add(acc: Record<string, number>, itemId: string, q: number) {
  acc[itemId] = (acc[itemId] || 0) + q;
}

function normalizeQty(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}