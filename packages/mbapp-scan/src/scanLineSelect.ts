/**
 * Shared helpers for scan-to-line selection and capped increment.
 */

export type GetLineId = (line: any) => string;
export type GetLineItemId = (line: any) => string | undefined;
export type GetRemaining = (line: any) => number;

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
    if (remaining > bestRemaining) {
      bestRemaining = remaining;
      bestId = id;
    }
  }

  return bestId;
}

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
