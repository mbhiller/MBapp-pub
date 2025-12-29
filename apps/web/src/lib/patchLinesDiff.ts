// Compute minimal patch-lines operations between original and current line arrays.
// Returns ops that can be sent to SO/PO :patch-lines endpoints.

export type PatchLineOp = {
  op: "upsert" | "remove";
  id?: string;
  cid?: string;
  patch?: Record<string, any>;
};

export type LineWithId = {
  id?: string;
  itemId?: string;
  qty?: number;
  uom?: string;
  [key: string]: any;
};

/**
 * Compute patch-lines ops to transform originalLines into currentLines.
 * 
 * @param originalLines - Lines as they existed when edit started (must have stable ids)
 * @param currentLines - Lines from current form state (may have new lines without ids)
 * @param fields - Fields to track for changes (default: ["itemId", "qty", "uom"])
 * @returns Array of patch operations (upsert/remove)
 * 
 * Rules:
 * - Removes: emit { op: "remove", id } for any original id missing from current
 * - Updates: emit { op: "upsert", id, patch } with only changed fields
 * - Adds: emit { op: "upsert", patch } (no id; server assigns)
 * - No-op updates are skipped (empty patch)
 * - Client-only fields (_key, etc.) are never included in ops
 */
export function computePatchLinesDiff(
  originalLines: LineWithId[],
  currentLines: LineWithId[],
  fields: string[] = ["itemId", "qty", "uom"]
): PatchLineOp[] {
  // Index original lines by id
  const origById = new Map<string, LineWithId>();
  for (const ln of originalLines || []) {
    const k = String(ln.id || "").trim();
    if (k) origById.set(k, ln);
  }

  // Index current lines by id
  const currById = new Map<string, LineWithId>();
  for (const ln of currentLines || []) {
    const k = String(ln.id || "").trim();
    if (k) currById.set(k, ln);
  }

  const ops: PatchLineOp[] = [];

  // 1) Removes: any original id missing from current
  for (const [oid] of origById.entries()) {
    if (!currById.has(oid)) {
      ops.push({ op: "remove", id: oid });
    }
  }

  // 2) Upserts: for each current line
  for (const ln of currentLines || []) {
    const idTrim = String(ln.id || "").trim();
    const inOriginal = idTrim && origById.has(idTrim);
    const base = inOriginal ? origById.get(idTrim)! : undefined;

    // Build patch: changed fields only for updates, required fields for new lines
    const patch: Record<string, any> = {};
    
    if (inOriginal && base) {
      // Update existing: include only changed fields
      for (const field of fields) {
        const before = (base as any)[field];
        const after = (ln as any)[field];
        // Compare as strings to handle type coercion consistently
        const changed = String(before ?? "") !== String(after ?? "");
        if (changed) {
          patch[field] = after;
        }
      }
    } else {
      // New line: include required fields (server will assign id)
      for (const field of fields) {
        const value = (ln as any)[field];
        if (value !== undefined && value !== null) {
          patch[field] = value;
        }
      }
    }

    // Skip no-op updates (empty patch)
    if (Object.keys(patch).length === 0) continue;

    // Build operation
    const op: PatchLineOp = { op: "upsert", patch };
    if (inOriginal) {
      op.id = idTrim; // update existing by id
    }
    // else: new line, no id (server assigns)
    
    ops.push(op);
  }

  return ops;
}
