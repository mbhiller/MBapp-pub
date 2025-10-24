// Pluggable dispatcher – no-op by default. Enable simulate for smokes/CI.
export type MBEvent =
  | { type: "po.received"; payload: { poId: string; actorId?: string | null; at: string } }
  | { type: "po.line.received"; payload: { poId: string; lineId: string; qty: number; lot?: string; locationId?: string; actorId?: string | null; at: string } };

const ENABLED = (process.env.FEATURE_EVENT_DISPATCH_ENABLED ?? "false") === "true";
const SIMULATE = (process.env.FEATURE_EVENT_DISPATCH_SIMULATE ?? process.env.CI ?? "false") === "true";

export async function dispatchEvent(evt: MBEvent): Promise<"noop" | "emitted"> {
  if (!ENABLED && !SIMULATE) return "noop";
  if (SIMULATE) console.log("[event]", JSON.stringify(evt));
  // Wire a real bus here when ready (SNS/EventBridge/etc.)
  return "emitted";
}
