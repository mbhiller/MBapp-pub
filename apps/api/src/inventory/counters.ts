// apps/api/src/inventory/counters.ts
const ACTIONS = ["receive","reserve","commit","fulfill","adjust","release","putaway","cycle_count"] as const;
type Action = typeof ACTIONS[number];

const ACTIONS_SET = new Set<string>(ACTIONS);

export function deriveCounters(movs: Array<{ action?: string; qty?: number }>) {
  let onHand = 0, reserved = 0;
  for (const mv of movs) {
    const a = String(
      (mv as any)?.action ?? (mv as any)?.movement ?? (mv as any)?.act ?? (mv as any)?.verb ?? (mv as any)?.type ?? ""
    ).toLowerCase();
    const q = Number(mv?.qty ?? 0) || 0;
    if (!ACTIONS_SET.has(a) || !q) continue;

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
    const a = String(mv?.action ?? "").trim().toLowerCase();
    const dq = Math.abs(Number(mv?.qty ?? 0) || 0);
    if (!ACTIONS_SET.has(a) || !dq) continue;

    switch (a) {
      case "receive":
      case "adjust":
      case "cycle_count": {
        // Add to onHand at locationId (or unassigned)
        const key = mv.locationId ? String(mv.locationId) : "unassigned";
        const bucket = getOrCreate(key);
        bucket.onHand += dq;
        break;
      }

      case "putaway": {
        // Move qty from fromLocationId to toLocationId (movement.locationId)
        const toLocationId = mv.locationId ? String(mv.locationId) : null;
        
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
          cFrom.onHand -= dq;
        }

        // Always add to destination (conservative: if from unknown, we still track arrival)
        if (toLocationId) {
          const cTo = getOrCreate(toLocationId);
          cTo.onHand += dq;
        } else {
          // Destination also unknown, add to unassigned
          const cTo = getOrCreate("unassigned");
          cTo.onHand += dq;
        }
        break;
      }

      case "reserve": {
        // Location-aware: increment reserved at locationId (or unassigned if missing)
        // Same bucket as commit/release for proper correlation
        const key = mv.locationId ? String(mv.locationId) : "unassigned";
        const bucket = getOrCreate(key);
        bucket.reserved += dq;
        break;
      }

      case "commit": {
        // Location-aware: decrement onHand AND release reservation at locationId (or unassigned if missing)
        // Must use same bucket as reserve to properly release the reservation
        const key = mv.locationId ? String(mv.locationId) : "unassigned";
        const bucket = getOrCreate(key);
        bucket.onHand -= dq;
        bucket.reserved -= dq;  // Allow negative; will clamp in final output
        break;
      }

      case "release": {
        // Location-aware: decrement reserved at locationId (or unassigned if missing)
        // Same bucket as reserve/commit for proper correlation
        const key = mv.locationId ? String(mv.locationId) : "unassigned";
        const bucket = getOrCreate(key);
        bucket.reserved -= dq;  // Allow negative; will clamp in final output
        break;
      }

      case "fulfill": {
        // Subtract onHand at locationId (or unassigned)
        const key = mv.locationId ? String(mv.locationId) : "unassigned";
        const bucket = getOrCreate(key);
        bucket.onHand -= dq;
        break;
      }
    }
  }

  // Convert map to array with locationId, clamping reserved to >= 0
  return Array.from(counters.entries()).map(([locationId, { onHand, reserved }]) => ({
    locationId: locationId === "unassigned" ? null : locationId,
    onHand,
    reserved: Math.max(0, reserved),
    available: onHand - Math.max(0, reserved),
  }));
}