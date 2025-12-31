import type { LineInput } from "../components/LineArrayEditor";

/**
 * Validate editable lines before submitting to API.
 * Provides granular per-line validation feedback.
 */
export function validateEditableLines(
  lines: LineInput[]
): { ok: true } | { ok: false; message: string } {
  if (!lines || lines.length === 0) {
    return { ok: false, message: "At least one line is required" };
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineLabel = `Line ${i + 1}`;

    // itemId required (after trim)
    const itemId = line.itemId?.trim();
    if (!itemId) {
      return { ok: false, message: `${lineLabel}: Item ID is required` };
    }

    // qty must be > 0
    const qty = Number(line.qty ?? 0);
    if (!(qty > 0)) {
      return { ok: false, message: `${lineLabel}: Quantity must be greater than 0` };
    }

    // uom required (after trim) - defaults to "ea" if empty
    const uom = line.uom?.trim() || "ea";
    if (!uom) {
      return { ok: false, message: `${lineLabel}: UOM is required` };
    }
  }

  return { ok: true };
}
