import { EditableLine } from "../components/LineEditor";

// Normalize API lines into editable client shape
export function buildEditableLines(lines: any[] | undefined | null): EditableLine[] {
  return (lines || []).map((ln: any) => ({
    id: ln?.id ? String(ln.id).trim() : undefined,
    cid: ln?.cid ? String(ln.cid).trim() : undefined,
    itemId: ln?.itemId ? String(ln.itemId).trim() : "",
    qty: Number(ln?.qty ?? 0) || 0,
    uom: ln?.uom ? String(ln.uom).trim() || "ea" : "ea",
  }));
}

// Normalize in-editor lines (ensures trims and numeric qty)
export function normalizeEditableLines(lines: EditableLine[]): EditableLine[] {
  return (lines || []).map((ln) => ({
    ...ln,
    itemId: (ln.itemId ?? "").trim(),
    uom: (ln.uom ?? "").trim() || "ea",
    qty: Number(ln.qty ?? 0) || 0,
  }));
}
