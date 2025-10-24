// apps/api/src/inventory/counters.ts
const ACTIONS = new Set(["receive","reserve","commit","fulfill","adjust","release"] as const);
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
      case "fulfill": /* no-op for counters */ break;
    }
  }
  return { onHand, reserved, available: onHand - reserved };
}
