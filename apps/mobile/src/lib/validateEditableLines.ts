import type { EditableLine } from "../components/LineEditor";

/**
 * Validate editable lines before submitting patch-lines ops.
 * Matches existing SO/PO edit screen validation rules.
 */
export function validateEditableLines(
  lines: EditableLine[]
): { ok: true } | { ok: false; message: string } {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineLabel = `Line ${i + 1}`;

    // itemId required (after trim)
    if (!line.itemId?.trim()) {
      return { ok: false, message: `${lineLabel}: Item is required` };
    }

    // uom required (after trim)
    if (!line.uom?.trim()) {
      return { ok: false, message: `${lineLabel}: UOM is required` };
    }

    // qty must be > 0
    if (!(Number(line.qty) > 0)) {
      return { ok: false, message: `${lineLabel}: Qty must be greater than 0` };
    }
  }

  return { ok: true };
}
