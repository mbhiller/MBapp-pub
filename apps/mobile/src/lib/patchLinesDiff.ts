/**
 * Compute minimal patch-lines operations for SO/PO draft edits.
 * Returns ops matching the `/so/{id}:patch-lines` and `/po/{id}:patch-lines` request contract.
 *
 * INVARIANTS (enforced by all implementations: web, mobile):
 * 1. FIELD LIMIT: Only itemId, qty, uom are patchable (schema-defined editable set)
 * 2. REMOVE SEMANTICS: Remove ops always use id (never cid) when server id exists
 * 3. UPSERT SEMANTICS: Upsert uses id for existing lines, cid for new lines
 * 4. CID GENERATION: Clients assign tmp-* cids for new lines only; never fabricate L{n} ids
 * 5. NO-OP SKIP: Updates with no field changes are omitted from ops
 * 6. TYPE SAFETY: PatchLinesOp types match backend request schema
 */

export type PatchLinesOp = {
  op: "upsert" | "remove";
  id?: string;     // Server-assigned line id (stable L{n} pattern); used for existing lines
  cid?: string;    // Client-assigned temporary id (tmp-* prefix); used only for new unsaved lines
  patch?: Record<string, any>; // Partial update; fields limited to itemId/qty/uom
};

export type LineWithId = {
  id?: string;     // Server-assigned stable id (L{n})
  cid?: string;    // Client-assigned temporary id (tmp-*); not sent to API
  itemId?: string; // Editable
  qty?: number;    // Editable
  uom?: string;    // Editable
  [key: string]: any; // Other fields (not patchable)
};

// Patchable fields: explicitly limited to prevent accidental data loss
export const PATCHABLE_LINE_FIELDS = ["itemId", "qty", "uom"] as const;
export const SALES_ORDER_PATCHABLE_LINE_FIELDS = PATCHABLE_LINE_FIELDS;
export const PURCHASE_ORDER_PATCHABLE_LINE_FIELDS = PATCHABLE_LINE_FIELDS;

/** Detect client-only temporary IDs (tmp-* prefix; never sent as id to API) */
function isClientOnlyId(id: string | undefined): boolean {
  if (!id) return false;
  const trimmed = String(id).trim();
  return trimmed.startsWith("tmp-");
}

/** Stable line key for matching before/after: prefer server id (unless tmp-*), fallback to cid */
function getLineKey(ln: LineWithId): string {
  const id = String(ln.id || "").trim();
  const cid = String(ln.cid || "").trim();
  // Server id takes precedence (unless it's client-only tmp-*)
  if (id && !isClientOnlyId(id)) return id;
  // Client-only id or cid
  if (cid) return cid;
  if (id) return id;
  return "";
}

/**
 * Shared implementation for mobile (wrapper with named args).
 * Mirrors web semantics exactly; see web patchLinesDiff.ts for invariant details.
 *
 * INVARIANT 1 (FIELD LIMIT): Only fields in patchableFields array are sent.
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

  // Step 1: Removes (INVARIANT 2: Remove ops always use id, never cid, for server rows)
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

  // Step 2: Upserts
  // INVARIANT 1 (FIELD LIMIT): Only patchableFields sent in patch.
  // INVARIANT 3 (UPSERT ID): Existing lines use id; new lines use cid.
  // INVARIANT 4 (CID GENERATION): Clients assign tmp-* only; never fabricate L{n}.
  // INVARIANT 5 (NO-OP SKIP): Omit patch if no field changes.
  for (const ln of editedLines || []) {
    const key = getLineKey(ln);
    const inOriginal = key && origByKey.has(key);
    const base = inOriginal ? origByKey.get(key)! : undefined;

    // For new lines with no id/cid, optionally assign a cid via makeCid (without mutating caller state)
    const lineId = String(ln.id || "").trim();
    const lineCid = String(ln.cid || "").trim() || (!inOriginal && !lineId && makeCid ? makeCid() : "");

    const patch: Record<string, any> = {};
    if (inOriginal && base) {
      // Existing line: only include fields that changed (INVARIANT 5: no-op skip)
      for (const field of patchableFields) {
        const before = (base as any)[field];
        const after = (ln as any)[field];
        const changed = String(before ?? "") !== String(after ?? "");
        if (changed) patch[field] = after;
      }
    } else {
      // New line: include all defined patchable fields (INVARIANT 1: only patchableFields)
      for (const field of patchableFields) {
        const val = (ln as any)[field];
        if (val !== undefined && val !== null) patch[field] = val;
      }
    }

    if (Object.keys(patch).length === 0) continue; // INVARIANT 5: skip no-ops

    const op: PatchLinesOp = { op: "upsert", patch };

    if (inOriginal) {
      // INVARIANT 3: Existing lines use id (prefer server id if not tmp-*)
      if (lineId && !isClientOnlyId(lineId)) {
        op.id = lineId;
      } else if (lineCid || (lineId && isClientOnlyId(lineId))) {
        op.cid = lineCid || lineId;
      }
    } else {
      // INVARIANT 3: New lines use cid (never invent server ids per INVARIANT 4)
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

/**
 * Positional-args wrapper for cross-platform signature parity with web.
 * Web uses: computePatchLinesDiff(originalLines, currentLines, fields?)
 * Mobile can now use either named args (above) or positional args (this wrapper).
 * 
 * Both signatures delegate to the same implementation; behavior is identical.
 */
export function computePatchLinesDiffPositional(
  originalLines: LineWithId[],
  editedLines: LineWithId[],
  patchableFields?: ReadonlyArray<string>,
  makeCid?: () => string
): PatchLinesOp[] {
  return computePatchLinesDiff({ originalLines, editedLines, patchableFields, makeCid });
}
