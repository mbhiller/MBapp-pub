import { EditableLine } from "../components/LineEditor";
import { ensureLineCid } from "./cidGeneration";

/**
 * Normalize API lines into editable client shape.
 * Ensures all lines have cid if they lack a server id (for new unsaved rows).
 * Never fabricates server ids (L{n} pattern).
 */
export function buildEditableLines(lines: any[] | undefined | null): EditableLine[] {
  return (lines || []).map((ln: any) => {
    const normalized: EditableLine = {
      id: ln?.id ? String(ln.id).trim() : undefined,
      cid: ln?.cid ? String(ln.cid).trim() : undefined,
      itemId: ln?.itemId ? String(ln.itemId).trim() : "",
      qty: Number(ln?.qty ?? 0) || 0,
      uom: ln?.uom ? String(ln.uom).trim() || "ea" : "ea",
    };
    // Ensure cid for new lines (no server id)
    return ensureLineCid(normalized);
  });
}

/**
 * Normalize in-editor lines (ensures trims and numeric qty).
 * Also ensures cid for new lines.
 */
export function normalizeEditableLines(lines: EditableLine[]): EditableLine[] {
  return (lines || []).map((ln) => {
    const normalized: EditableLine = {
      ...ln,
      itemId: (ln.itemId ?? "").trim(),
      uom: (ln.uom ?? "").trim() || "ea",
      qty: Number(ln.qty ?? 0) || 0,
    };
    // Ensure cid for new lines
    return ensureLineCid(normalized);
  });
}

