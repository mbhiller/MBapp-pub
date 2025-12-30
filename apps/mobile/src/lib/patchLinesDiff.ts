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

export const SALES_ORDER_PATCHABLE_LINE_FIELDS = ["itemId", "qty", "uom"] as const;

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
 * Compute patch-lines ops to transform originalLines into currentLines.
 * Mirrors web implementation semantics.
 */
export function computePatchLinesDiff(
  originalLines: LineWithId[],
  currentLines: LineWithId[],
  fields: ReadonlyArray<string> = SALES_ORDER_PATCHABLE_LINE_FIELDS
): PatchLinesOp[] {
  const origByKey = new Map<string, LineWithId>();
  for (const ln of originalLines || []) {
    const k = getLineKey(ln);
    if (k) origByKey.set(k, ln);
  }

  const currByKey = new Map<string, LineWithId>();
  for (const ln of currentLines || []) {
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
  for (const ln of currentLines || []) {
    const key = getLineKey(ln);
    const inOriginal = key && origByKey.has(key);
    const base = inOriginal ? origByKey.get(key)! : undefined;

    const patch: Record<string, any> = {};
    if (inOriginal && base) {
      for (const field of fields) {
        const before = (base as any)[field];
        const after = (ln as any)[field];
        const changed = String(before ?? "") !== String(after ?? "");
        if (changed) patch[field] = after;
      }
    } else {
      for (const field of fields) {
        const val = (ln as any)[field];
        if (val !== undefined && val !== null) patch[field] = val;
      }
    }

    if (Object.keys(patch).length === 0) continue;

    const op: PatchLinesOp = { op: "upsert", patch };
    const id = String(ln.id || "").trim();
    const cid = String(ln.cid || "").trim();

    if (inOriginal) {
      if (id && !isClientOnlyId(id)) {
        op.id = id;
      } else if (cid || (id && isClientOnlyId(id))) {
        op.cid = cid || id;
      }
    } else {
      if (cid) {
        op.cid = cid;
      } else if (id && isClientOnlyId(id)) {
        op.cid = id;
      }
    }

    ops.push(op);
  }

  return ops;
}
