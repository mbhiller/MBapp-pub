// apps/api/src/shared/patchLines.ts
// Shared utility to apply minimal patch operations to an order's lines array.
// Notes:
// - This does NOT assign ids. Callers should run ensureLineIds() after apply.
// - Preserves original order; new lines are appended in op order.
// - Uses lineKey() for consistent id/cid resolution.

import { lineKey } from "./lineKey";

export type PatchLineOp =
  | { op: "upsert"; id?: string; cid?: string; patch: Partial<any> }
  | { op: "remove"; id?: string; cid?: string };

export function applyPatchLines<T extends { id?: string; cid?: string } & Record<string, unknown>>(
  existing: T[],
  ops: PatchLineOp[]
): { lines: T[]; summary: { added: number; updated: number; removed: number } } {
  // Start from a shallow copy of existing lines to avoid mutating caller-owned state.
  const lines: T[] = (existing || []).map((ln) => ({ ...(ln as T) }));

  let added = 0;
  let updated = 0;
  let removed = 0;

  for (const op of ops || []) {
    if (!op || typeof (op as any).op !== "string") continue;

    if (op.op === "remove") {
      // Build op's key from op.id/op.cid using lineKey logic
      const opKey = lineKey({ id: op.id, cid: op.cid });
      if (!opKey) continue; // No key to match against

      const idx = lines.findIndex((ln) => lineKey(ln) === opKey);
      if (idx >= 0) {
        lines.splice(idx, 1);
        removed += 1;
      }
      continue;
    }

    if (op.op === "upsert") {
      // Build op's key from op.id/op.cid
      const opKey = lineKey({ id: op.id, cid: op.cid });

      // Update existing line by key if found
      if (opKey) {
        const idx = lines.findIndex((ln) => lineKey(ln) === opKey);
        if (idx >= 0) {
          const current = lines[idx];
          const next = { ...current, ...(op.patch || {}) } as T;
          // Preserve original id/cid
          (next as any).id = current.id;
          (next as any).cid = current.cid;
          lines[idx] = next;
          updated += 1;
          continue;
        }
      }

      // No matching key: append a new line from patch (do NOT invent id here)
      const newLine = ({ ...(op.patch || {}) } as unknown) as T;
      lines.push(newLine);
      added += 1;
      continue;
    }
  }

  return { lines, summary: { added, updated, removed } };
}
