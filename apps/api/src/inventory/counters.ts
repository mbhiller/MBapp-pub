// apps/api/src/inventory/counters.ts
const ACTIONS = new Set(["receive","reserve","commit","fulfill","adjust","release","putaway","cycle_count"] as const);
type Action = typeof ACTIONS extends Set<infer T> ? T : never;

export function deriveCounters(movs: Array<{ action?: string; qty?: number }>) {
  let onHand = 0, reserved = 0;
  for (const mv of movs) {
    const a = String(
      (mv as any)?.action ?? (mv as any)?.movement ?? (mv as any)?.act ?? (mv as any)?.verb ?? (mv as any)?.type ?? ""
    ).toLowerCase() as Action;
    const q = Number(mv?.qty ?? 0) || 0;
    if (!ACTIONS.has(a as Action) || !q) continue;

    switch (a) {
      case "receive": onHand += q; break;
      case "reserve": reserved += q; break;
      case "commit":  onHand -= q; reserved = Math.max(0, reserved - q); break;
      case "release": reserved = Math.max(0, reserved - q); break;
      case "adjust":  onHand += q; break;   // q may be negative
      case "cycle_count": onHand += q; break;  // treat like adjust (count correction)
      case "putaway": /* no-op for counters */ break;  // location trace only
      case "fulfill": /* no-op for counters */ break;
    }
  }
  return { onHand, reserved, available: onHand - reserved };
}
export type LocationCounters = {
  locationId: string | null;
  onHand: number;
  reserved: number;
  available: number;
};

/**
 * Derive inventory counters grouped by location.
 * Movements without locationId are grouped under "unassigned".
 * 
 * Action semantics:
 * - receive/adjust/cycle_count: +onHand at locationId (or "unassigned")
 * - putaway: move qty from fromLocationId to toLocationId (movement.locationId)
 *   - fromLocationId parsed from note "from=..." OR fromLocationId field (if exists)
 *   - if from cannot be determined, only add to destination (conservative)
 * - reserve/commit/release: apply to "unassigned" (these movements don't carry locationId)
 * - fulfill: -onHand at locationId (or "unassigned")
 */
export function deriveCountersByLocation(
  movs: Array<{ action?: string; qty?: number; locationId?: string; note?: string; [k: string]: any }>
): LocationCounters[] {
  const counters = new Map<string, { onHand: number; reserved: number }>();

  const getOrCreate = (locId: string | null | undefined) => {
    const key = locId || "unassigned";
    if (!counters.has(key)) {
      counters.set(key, { onHand: 0, reserved: 0 });
    }
    return counters.get(key)!;
  };

  for (const mv of movs) {
    const a = String(
      (mv as any)?.action ?? (mv as any)?.movement ?? (mv as any)?.act ?? (mv as any)?.verb ?? (mv as any)?.type ?? ""
    ).toLowerCase() as Action;
    const q = Number(mv?.qty ?? 0) || 0;
    if (!ACTIONS.has(a as Action) || !q) continue;

    const locId = (mv as any)?.locationId ?? null;

    switch (a) {
      case "receive":
      case "adjust":
      case "cycle_count": {
        // Add to onHand at locationId (or unassigned)
        const c = getOrCreate(locId);
        c.onHand += q;
        break;
      }

      case "putaway": {
        // Move qty from fromLocationId to toLocationId (movement.locationId)
        const toLocationId = locId;
        
        // Try to extract fromLocationId from note "from=..." or explicit field
        let fromLocationId: string | null = null;
        if ((mv as any)?.fromLocationId) {
          fromLocationId = (mv as any).fromLocationId;
        } else if (mv.note) {
          // Parse note for "from=LOC-A" pattern (case insensitive)
          const match = mv.note.match(/from\s*=\s*([^\s,;]+)/i);
          if (match) fromLocationId = match[1];
        }

        // If we can determine source location, subtract qty
        if (fromLocationId) {
          const cFrom = getOrCreate(fromLocationId);
          cFrom.onHand -= q;
        }

        // Always add to destination (conservative: if from unknown, we still track arrival)
        if (toLocationId) {
          const cTo = getOrCreate(toLocationId);
          cTo.onHand += q;
        } else {
          // Destination also unknown, add to unassigned
          const cTo = getOrCreate(null);
          cTo.onHand += q;
        }
        break;
      }

      case "reserve": {
        // Apply to unassigned (these movements don't carry locationId today)
        const c = getOrCreate(null);
        c.reserved += q;
        break;
      }

      case "commit": {
        // Apply to unassigned
        const c = getOrCreate(null);
        c.onHand -= q;
        c.reserved = Math.max(0, c.reserved - q);
        break;
      }

      case "release": {
        // Apply to unassigned
        const c = getOrCreate(null);
        c.reserved = Math.max(0, c.reserved - q);
        break;
      }

      case "fulfill": {
        // Subtract onHand at locationId (or unassigned)
        const c = getOrCreate(locId);
        c.onHand -= q;
        break;
      }
    }
  }

  // Convert map to array with locationId
  return Array.from(counters.entries()).map(([locationId, { onHand, reserved }]) => ({
    locationId: locationId === "unassigned" ? null : locationId,
    onHand,
    reserved,
    available: onHand - reserved,
  }));
}