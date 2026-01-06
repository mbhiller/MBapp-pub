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
 * Compute patch-lines ops to transform originalLines into editedLines.
 * Shared implementation: both apps/web and apps/mobile use named args.
 *
 * @param originalLines - Lines as they existed when edit started (must have stable ids)
 * @param editedLines - Lines from current form state (may have new lines with cid)
 * @param patchableFields - Patchable fields (limited to itemId/qty/uom per INVARIANT 1)
 * @returns Array of ops ready for POST /so/{id}:patch-lines or /po/{id}:patch-lines
 */
export function computePatchLinesDiff(args: {
  originalLines: LineWithId[];
  editedLines: LineWithId[];
  patchableFields?: ReadonlyArray<string>;
  makeCid?: () => string; // optional helper to assign cid for new lines lacking one
}): PatchLinesOp[] {
  const { originalLines, editedLines, patchableFields = PATCHABLE_LINE_FIELDS, makeCid } = args;

  // Index original lines by stable key (id or cid)
  const origByKey = new Map<string, LineWithId>();
  for (const ln of originalLines || []) {
    const k = getLineKey(ln);
    if (k) origByKey.set(k, ln);
  }

  // Index edited lines by stable key
  const currByKey = new Map<string, LineWithId>();
  for (const ln of editedLines || []) {
    const k = getLineKey(ln);
    if (k) currByKey.set(k, ln);
  }

  const ops: PatchLinesOp[] = [];

  // Step 1: Removes (INVARIANT 2: use id for server lines, cid for client-only)
  // Any original line missing from edited is marked for deletion
  for (const [okey, oline] of origByKey.entries()) {
    if (!currByKey.has(okey)) {
      const oid = String(oline.id || "").trim();
      const ocid = String(oline.cid || "").trim();
      // Server id (not tmp-*) -> use id; otherwise use cid
      if (oid && !isClientOnlyId(oid)) {
        ops.push({ op: "remove", id: oid });
      } else if (ocid || (oid && isClientOnlyId(oid))) {
        ops.push({ op: "remove", cid: ocid || oid });
      }
    }
  }

  // Step 2: Upserts (INVARIANT 1,3,4,5: field limit, id/cid semantics, no-op skip)
  // Build update or new-line ops; skip if no field changes (INVARIANT 5: no-op skip)
  for (const ln of editedLines || []) {
    const key = getLineKey(ln);
    const inOriginal = key && origByKey.has(key);
    const base = inOriginal ? origByKey.get(key)! : undefined;

    // For new lines with no id/cid, optionally assign a cid via makeCid (without mutating caller state)
    const lineId = String(ln.id || "").trim();
    const lineCid = String(ln.cid || "").trim() || (!inOriginal && !lineId && makeCid ? makeCid() : "");

    // Compute patch: only include fields that changed (for updates) or are non-empty (for new lines)
    const patch: Record<string, any> = {};
    
    if (inOriginal && base) {
      // Update existing: compare each patchable field; include only changes
      for (const field of patchableFields) {
        const before = (base as any)[field];
        const after = (ln as any)[field];
        // Normalize to string for consistent comparison (handles undefined/null/0/"" cases)
        if (String(before ?? "") !== String(after ?? "")) {
          patch[field] = after;
        }
      }
    } else {
      // New line: include non-empty patchable fields (server will assign stable id)
      for (const field of patchableFields) {
        const value = (ln as any)[field];
        if (value !== undefined && value !== null) {
          patch[field] = value;
        }
      }
    }

    // INVARIANT 5: Skip no-op updates (no fields changed)
    if (Object.keys(patch).length === 0) continue;

    // Build operation with id/cid per INVARIANT 3
    const op: PatchLinesOp = { op: "upsert", patch };
    
    if (inOriginal) {
      // Existing line: use server id (unless tmp-*)
      if (lineId && !isClientOnlyId(lineId)) {
        op.id = lineId;
      } else if (lineCid || (lineId && isClientOnlyId(lineId))) {
        op.cid = lineCid || lineId;
      }
    } else {
      // New line: send cid (never fabricate id)
      if (lineCid) {
        op.cid = lineCid;
      } else if (lineId && isClientOnlyId(lineId)) {
        op.cid = lineId;
      }
      // else: omit id/cid; server assigns (INVARIANT 4: never fabricate L{n})
    }
    
    ops.push(op);
  }

  return ops;
}

/**
 * Positional-args wrapper for backwards compatibility.
 * Web previously used: computePatchLinesDiff(originalLines, currentLines, fields?)
 * Now both signatures are supported via named args (above) and positional (this wrapper).
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
