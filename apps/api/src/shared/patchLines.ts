// apps/api/src/shared/patchLines.ts
// Shared utility to apply minimal patch operations to an order's lines array.
// Notes:
// - This does NOT assign ids. Callers should run ensureLineIds() after apply.
// - Preserves original order; new lines are appended in op order.

export type PatchLineOp =
  | { op: "upsert"; id?: string; cid?: string; patch: Partial<any> }
  | { op: "remove"; id?: string; cid?: string };

export function applyPatchLines<T extends { id?: string } & Record<string, unknown>>(
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
      // Prefer id-based match; fall back to best-effort cid match for in-memory cases.
      if (op.id && op.id.trim()) {
        const idx = lines.findIndex((ln) => String(ln.id || "").trim() === op.id!.trim());
        if (idx >= 0) {
          lines.splice(idx, 1);
          removed += 1;
        }
        continue;
      }
      if (op.cid && op.cid.trim()) {
        const idx = lines.findIndex((ln) => String((ln as any).cid || "").trim() === op.cid!.trim());
        if (idx >= 0) {
          lines.splice(idx, 1);
          removed += 1;
        }
      }
      continue;
    }

    if (op.op === "upsert") {
      // Update existing by id (preserve id even if patch includes id)
      if (op.id && op.id.trim()) {
        const idx = lines.findIndex((ln) => String(ln.id || "").trim() === op.id!.trim());
        if (idx >= 0) {
          const current = lines[idx];
          const next = { ...current, ...(op.patch || {}) } as T;
          // Preserve original id
          (next as any).id = current.id;
          lines[idx] = next;
          updated += 1;
          continue;
        }
      }

      // No matching id: append a new line from patch (do NOT invent id here)
      const newLine = ({ ...(op.patch || {}) } as unknown) as T;
      lines.push(newLine);
      added += 1;
      continue;
    }
  }

  return { lines, summary: { added, updated, removed } };
}
