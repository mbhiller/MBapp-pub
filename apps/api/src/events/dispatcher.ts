// apps/api/src/events/dispatcher.ts
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { featureEventsEnabled, featureEventsSimulate } from "../flags";

export type MBEvent =
  | { type: "po.received"; payload: { poId: string; actorId?: string | null; at: string } }
  | { type: "po.line.received"; payload: { poId: string; lineId: string; qty: number; lot?: string; locationId?: string; actorId?: string | null; at: string } };

export type DispatchMeta = { emitted: boolean; provider: string };

// Pluggable bus (no-op by default). Replace internals later with EventBridge/SNS/etc.
export async function dispatchEvent(_evt: MBEvent, _opts?: { event?: APIGatewayProxyEventV2 }): Promise<DispatchMeta> {
  // If you later wire a real bus, check featureEventsEnabled(event) and emit.
  // Default provider label is "noop" for the built-in no-op implementation.
  return { emitted: false, provider: "noop" };
}

export async function maybeDispatch(event: APIGatewayProxyEventV2, evt: MBEvent) {
  // In the future you can gate on featureEventsEnabled(event) for prod/non-prod behavior.
  // For simulate mode we return a simulated meta indicating what would have happened.
  const simulated = featureEventsEnabled(event) && featureEventsSimulate(event);
  if (simulated) {
    // For smoke tests: do not call any external bus; just signal simulation metadata.
    return { emitted: true, provider: "noop" };
  }
  return dispatchEvent(evt, { event });
}
