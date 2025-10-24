// apps/src/api/flags.ts
// Minimal feature flags with header overrides. No envs needed.
// Defaults:
// - Vendor guard: ON
// - Event dispatch: OFF
// - Event simulate: OFF

import type { APIGatewayProxyEventV2 } from "aws-lambda";

function h(e: APIGatewayProxyEventV2, name: string): string | undefined {
  const v = e.headers?.[name] ?? e.headers?.[name.toLowerCase()];
  return typeof v === "string" ? v : undefined;
}
function asBool(v: string | undefined, dflt: boolean): boolean {
  if (!v) return dflt;
  const s = v.toLowerCase();
  if (["1", "true", "yes", "on"].includes(s)) return true;
  if (["0", "false", "no", "off"].includes(s)) return false;
  return dflt;
}

export function vendorGuardEnabled(event: APIGatewayProxyEventV2, dflt = true): boolean {
  return asBool(h(event, "X-Feature-Enforce-Vendor"), dflt);
}
export function eventDispatchEnabled(event: APIGatewayProxyEventV2, dflt = false): boolean {
  return asBool(h(event, "X-Feature-Events-Enabled"), dflt);
}
export function eventSimulateEnabled(event: APIGatewayProxyEventV2, dflt = false): boolean {
  return asBool(h(event, "X-Feature-Events-Simulate"), dflt);
}
