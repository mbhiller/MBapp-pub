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
  cid?: string;  // Client-only temporary id (e.g., tmp-*)
  itemId?: string;
  qty?: number;
  uom?: string;
  [key: string]: any;
};

export const SALES_ORDER_PATCHABLE_LINE_FIELDS = ["itemId", "qty", "uom"] as const;
export const PURCHASE_ORDER_PATCHABLE_LINE_FIELDS = ["itemId", "qty", "uom"] as const;

// Detect client-only temporary IDs (tmp-* prefix)
function isClientOnlyId(id: string | undefined): boolean {
  if (!id) return false;
  const trimmed = String(id).trim();
  return trimmed.startsWith("tmp-");
}

// Get stable key for line (prefer server id, fallback to cid)
function getLineKey(ln: LineWithId): string {
  const id = String(ln.id || "").trim();
  const cid = String(ln.cid || "").trim();
  
  // Server id takes precedence (unless it's client-only)
  if (id && !isClientOnlyId(id)) return id;
  
  // Client-only id or cid
  if (cid) return cid;
  if (id) return id;
  
  return "";
}

/**
 * Compute patch-lines ops to transform originalLines into currentLines.
 * 
 * @param originalLines - Lines as they existed when edit started (must have stable ids)
 * @param currentLines - Lines from current form state (may have new lines with cid)
 * @param fields - Fields to track for changes (default: SALES_ORDER_PATCHABLE_LINE_FIELDS)
 * @returns Array of patch operations (upsert/remove)
 * 
 * Rules:
 * - Removes: emit { op: "remove", id } for server lines, { op: "remove", cid } for client-only
 * - Updates: emit { op: "upsert", id, patch } with only changed fields (server lines only)
 * - Adds: emit { op: "upsert", cid, patch } for client lines (server assigns stable id)
 * - No-op updates are skipped (empty patch)
 * - Client-only IDs (tmp-*) are sent as cid, never as id
 */
export function computePatchLinesDiff(
  originalLines: LineWithId[],
  currentLines: LineWithId[],
  fields: ReadonlyArray<string> = SALES_ORDER_PATCHABLE_LINE_FIELDS
): PatchLineOp[] {
  // Index original lines by stable key (id or cid)
  const origByKey = new Map<string, LineWithId>();
  for (const ln of originalLines || []) {
    const k = getLineKey(ln);
    if (k) origByKey.set(k, ln);
  }

  // Index current lines by stable key
  const currByKey = new Map<string, LineWithId>();
  for (const ln of currentLines || []) {
    const k = getLineKey(ln);
    if (k) currByKey.set(k, ln);
  }

  const ops: PatchLineOp[] = [];

  // 1) Removes: any original key missing from current
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

  // 2) Upserts: for each current line
  for (const ln of currentLines || []) {
    const key = getLineKey(ln);
    const inOriginal = key && origByKey.has(key);
    const base = inOriginal ? origByKey.get(key)! : undefined;

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
      // New line: include required fields (server will assign stable id)
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
    
    const id = String(ln.id || "").trim();
    const cid = String(ln.cid || "").trim();
    
    if (inOriginal) {
      // Update existing: use server id if present and not client-only
      if (id && !isClientOnlyId(id)) {
        op.id = id;
      } else if (cid || (id && isClientOnlyId(id))) {
        op.cid = cid || id;
      }
    } else {
      // New line: send cid so server can track client intent across retries
      if (cid) {
        op.cid = cid;
      } else if (id && isClientOnlyId(id)) {
        op.cid = id;
      }
      // else: no id/cid (server assigns stable id)
    }
    
    ops.push(op);
  }

  return ops;
}
