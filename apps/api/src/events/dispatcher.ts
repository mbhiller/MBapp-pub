// apps/api/src/events/dispatcher.ts
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { featureEventsEnabled, featureEventsSimulate } from "../flags";

export type MBEvent =
  | { type: "po.received"; payload: { poId: string; actorId?: string | null; at: string } }
  | { type: "po.line.received"; payload: { poId: string; lineId: string; qty: number; lot?: string; locationId?: string; actorId?: string | null; at: string } };

// Pluggable bus (no-op by default). Replace internals later with EventBridge/SNS/etc.
export async function dispatchEvent(_evt: MBEvent, _opts?: { event?: APIGatewayProxyEventV2 }): Promise<"noop" | "emitted"> {
  // If you later wire a real bus, check featureEventsEnabled(event) and emit.
  return "noop";
}

export async function maybeDispatch(event: APIGatewayProxyEventV2, evt: MBEvent) {
  // In the future you can gate on featureEventsEnabled(event) for prod/non-prod behavior.
  const simulated = featureEventsSimulate(event);
  if (simulated) {
    // For smoke tests: we don’t actually emit, we just signal that we *would have*.
    return "emitted" as const;
  }
  return dispatchEvent(evt, { event });
}
