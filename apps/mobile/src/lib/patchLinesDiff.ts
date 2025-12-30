// apps/mobile/src/lib/patchLinesDiff.ts
// Mobile copy of web patchLinesDiff: compute minimal ops between original and current lines.

export type PatchLinesOp = {
  op: "upsert" | "remove";
  id?: string;
  cid?: string;
  patch?: Record<string, any>;
};

export type LineWithId = {
  id?: string;
  cid?: string; // client-only id for new lines
  itemId?: string;
  qty?: number;
  uom?: string;
  [key: string]: any;
};

export const PATCHABLE_LINE_FIELDS = ["itemId", "qty", "uom"] as const;
export const SALES_ORDER_PATCHABLE_LINE_FIELDS = PATCHABLE_LINE_FIELDS;
export const PURCHASE_ORDER_PATCHABLE_LINE_FIELDS = PATCHABLE_LINE_FIELDS;

// Detect client-only temp ids
function isClientOnlyId(id: string | undefined): boolean {
  if (!id) return false;
  const trimmed = String(id).trim();
  return trimmed.startsWith("tmp-");
}

// Prefer server id; fall back to cid
function getLineKey(ln: LineWithId): string {
  const id = String(ln.id || "").trim();
  const cid = String(ln.cid || "").trim();
  if (id && !isClientOnlyId(id)) return id;
  if (cid) return cid;
  if (id) return id;
  return "";
}

/**
 * Compute patch-lines ops to transform originalLines into editedLines.
 * Mirrors web semantics: existing lines patch by `id`, new lines by `cid`,
 * removes by `id` (or `cid` for unsaved client-only rows), and skips no-op patches.
 *
 * Example (conceptual):
 * - before: [{ id: "L1", itemId: "A", qty: 2, uom: "ea" }]
 * - after:  [{ id: "L1", itemId: "A", qty: 3, uom: "ea" }, { cid: "tmp-1", itemId: "B", qty: 1, uom: "ea" }]
 * - ops: [ { op: "upsert", id: "L1", patch: { qty: 3 } }, { op: "upsert", cid: "tmp-1", patch: { itemId: "B", qty: 1, uom: "ea" } } ]
 *
 * Remove cases:
 * - before: [{ id: "L2", itemId: "C", qty: 1, uom: "ea" }]
 *   after:  []
 *   ops:   [ { op: "remove", id: "L2" } ]
 * - before: [{ cid: "tmp-9", itemId: "X", qty: 1, uom: "ea" }]
 *   after:  []
 *   ops:   [ { op: "remove", cid: "tmp-9" } ]
 */
export function computePatchLinesDiff(args: {
  originalLines: LineWithId[];
  editedLines: LineWithId[];
  patchableFields?: ReadonlyArray<string>;
  makeCid?: () => string; // optional helper to assign cid for new lines lacking one
}): PatchLinesOp[] {
  const { originalLines, editedLines, patchableFields = PATCHABLE_LINE_FIELDS, makeCid } = args;

  const origByKey = new Map<string, LineWithId>();
  for (const ln of originalLines || []) {
    const k = getLineKey(ln);
    if (k) origByKey.set(k, ln);
  }

  const currByKey = new Map<string, LineWithId>();
  for (const ln of editedLines || []) {
    const k = getLineKey(ln);
    if (k) currByKey.set(k, ln);
  }

  const ops: PatchLinesOp[] = [];

  // Removes: any original missing from current
  for (const [okey, oline] of origByKey.entries()) {
    if (!currByKey.has(okey)) {
      const oid = String(oline.id || "").trim();
      const ocid = String(oline.cid || "").trim();
      if (oid && !isClientOnlyId(oid)) {
        ops.push({ op: "remove", id: oid });
      } else if (ocid || (oid && isClientOnlyId(oid))) {
        ops.push({ op: "remove", cid: ocid || oid });
      }
    }
  }

  // Upserts
  for (const ln of editedLines || []) {
    const key = getLineKey(ln);
    const inOriginal = key && origByKey.has(key);
    const base = inOriginal ? origByKey.get(key)! : undefined;

    // For new lines with no id/cid, optionally assign a cid via makeCid (without mutating caller state)
    const lineId = String(ln.id || "").trim();
    const lineCid = String(ln.cid || "").trim() || (!inOriginal && !lineId && makeCid ? makeCid() : "");

    const patch: Record<string, any> = {};
    if (inOriginal && base) {
      for (const field of patchableFields) {
        const before = (base as any)[field];
        const after = (ln as any)[field];
        const changed = String(before ?? "") !== String(after ?? "");
        if (changed) patch[field] = after;
      }
    } else {
      for (const field of patchableFields) {
        const val = (ln as any)[field];
        if (val !== undefined && val !== null) patch[field] = val;
      }
    }

    if (Object.keys(patch).length === 0) continue;

    const op: PatchLinesOp = { op: "upsert", patch };

    if (inOriginal) {
      if (lineId && !isClientOnlyId(lineId)) {
        op.id = lineId;
      } else if (lineCid || (lineId && isClientOnlyId(lineId))) {
        op.cid = lineCid || lineId;
      }
    } else {
      if (lineCid) {
        op.cid = lineCid;
      } else if (lineId && isClientOnlyId(lineId)) {
        op.cid = lineId;
      }
      // no id/cid and no makeCid => still omit to avoid inventing server ids
    }

    ops.push(op);
  }

  return ops;
}
