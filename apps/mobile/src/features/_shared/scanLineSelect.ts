/**
 * Shared helpers for scan-to-line selection and capped increment.
 *
 * Types are permissive and local to avoid heavy imports.
 * A line-like object should expose accessor functions provided by the caller.
 */

export type GetLineId = (line: any) => string;
export type GetLineItemId = (line: any) => string | undefined;
export type GetRemaining = (line: any) => number; // caller computes e.g., qty - received/fulfilled

/**
 * pickBestMatchingLineId
 *
 * Algorithm:
 * - Filter lines where getLineItemId(line) === itemId (case-insensitive string compare)
 * - Filter remaining > 0 (using caller-provided getRemaining)
 * - Choose the line with the largest remaining
 * - Tie-break deterministically by first appearance order in the original array
 * - Return the selected lineId or null if none available
 */
export function pickBestMatchingLineId(params: {
  lines: any[];
  itemId: string;
  getLineId: GetLineId;
  getLineItemId: GetLineItemId;
  getRemaining: GetRemaining;
}): string | null {
  const { lines, itemId, getLineId, getLineItemId, getRemaining } = params;
  if (!Array.isArray(lines) || !itemId) return null;

  const target = String(itemId).toLowerCase();
  let bestId: string | null = null;
  let bestRemaining = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const id = getLineId(line);
    if (!id) continue;
    const li = getLineItemId(line);
    if (!li || String(li).toLowerCase() !== target) continue;
    const remaining = Math.max(0, Number(getRemaining(line) || 0));
    if (remaining <= 0) continue;
    // prefer larger remaining; tie-break favors first seen
    if (remaining > bestRemaining) {
      bestRemaining = remaining;
      bestId = id;
    }
  }

  return bestId;
}

/**
 * incrementCapped
 *
 * Increments the current pending value for a lineId by `delta` (default 1),
 * caps at `remaining`, and returns a NEW Map (immutability-friendly).
 */
export function incrementCapped(
  map: Map<string, number>,
  lineId: string,
  remaining: number,
  delta: number = 1
): Map<string, number> {
  const current = map.get(lineId) ?? 0;
  const cap = Math.max(0, Number(remaining) || 0);
  const next = Math.min(current + delta, cap);
  const updated = new Map(map);
  updated.set(lineId, next);
  return updated;
}
