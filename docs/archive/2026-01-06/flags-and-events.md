# Feature Flags & Event Dispatcher (Sprint III)

## Overview

Feature flags provide opt-in control for new behaviors (vendor guard, event dispatch, simulation). The event dispatcher is a noop stub designed for future integration with EventBridge/SNS, with a simulation path for testing.

---

## 1. Feature Flag Catalog

| Flag | Environment | Header Override | Default | Purpose |
|------|-------------|-----------------|---------|---------|
| `featureVendorGuardEnabled` | `FEATURE_ENFORCE_VENDOR_ROLE` | `X-Feature-Enforce-Vendor` | `true` | Gate vendor role validation on PO submit/approve |
| `featureEventsEnabled` | `FEATURE_EVENT_DISPATCH_ENABLED` | `X-Feature-Events-Enabled` | `false` | Gate event dispatcher activation (currently noop) |
| `featureEventsSimulate` | `FEATURE_EVENT_DISPATCH_SIMULATE` | `X-Feature-Events-Simulate` | `false` | Signal test mode: emit "emitted" without publishing |

**Flag Pattern** ([apps/api/src/flags.ts](apps/api/src/flags.ts)):
- Factory: `withFlag(envName, headerName, default)` returns scoped function `(event) => boolean`
- Environment variable read in **production only** (respects `APP_ENV=prod`)
- Header override allowed in **development/CI** (bypasses env if header present)
- Safe default: prod never reads headers; dev allows override for testing

**Override Mechanism**:
- Dev/CI: `X-Feature-Enforce-Vendor: true/false` header overrides `FEATURE_ENFORCE_VENDOR_ROLE` env
- Production: Env var only; headers ignored
- Integration: Read in route handlers (po-submit, po-approve, dispatcher)

---

## 2. Event Types & Emitters

**Event Union** ([apps/api/src/events/dispatcher.ts](apps/api/src/events/dispatcher.ts)):
```typescript
type MBEvent =
  | { type: "po.received"; payload: { poId: string; actorId?: string | null; at: string } }
  | { type: "po.line.received"; payload: { poId: string; lineId: string; qty: number; 
      lot?: string; locationId?: string; actorId?: string | null; at: string } };
```

**Emitter Calls** ([apps/api/src/purchasing/po-receive.ts](apps/api/src/purchasing/po-receive.ts) lines 211–226):
- **po.received**: Fired once per PO when status transitions to `received`
  - Payload: PO ID, actor (null in current impl), ISO timestamp
  - Called at line 211 within idempotency guard
- **po.line.received**: Fired per line with qty > 0
  - Payload: PO ID, line ID, received qty, lot, location, actor (null), timestamp
  - Called at line 215 in loop over `reqLines`
  - Only emitted if `qty > 0` (skips zero-qty lines)

**No Other Emitters**: Event dispatch currently only called in `po-receive.ts`; no sales/SO events wired yet.

---

## 3. Dispatcher Implementation

**Dispatch Stub** ([apps/api/src/events/dispatcher.ts](apps/api/src/events/dispatcher.ts) lines 10–22):

```typescript
export async function dispatchEvent(_evt: MBEvent, _opts?: { event?: APIGatewayProxyEventV2 }): Promise<"noop" | "emitted"> {
  return "noop";  // TODO: wire EventBridge/SNS/etc later
}

export async function maybeDispatch(event: APIGatewayProxyEventV2, evt: MBEvent) {
  const simulated = featureEventsSimulate(event);
  if (simulated) {
    return "emitted" as const;  // Smoke test signal
  }
  return dispatchEvent(evt, { event });  // Currently noop
}
```

**Behavior**:
1. **Default (events disabled)**: `featureEventsEnabled=false` → `dispatchEvent()` calls are made but return `"noop"` (no bus wiring)
2. **Simulated mode**: `featureEventsSimulate=true` → `maybeDispatch()` returns `"emitted"` without calling dispatcher
3. **Future wiring**: Replace `dispatchEvent()` body with EventBridge/SNS calls; gate on `featureEventsEnabled(event)` in prod

**Integration Pattern**:
- Caller (`po-receive.ts`) always calls `maybeDispatch()`
- Dispatcher gates simulation at line 18; noop stub safe in prod
- Return value `"emitted"` or `"noop"` not currently persisted or logged

---

## 4. Simulation & Testing

**Enable Simulation** (Development):
```bash
# Environment variable
export FEATURE_EVENT_DISPATCH_SIMULATE=true

# Or HTTP header (dev/CI only)
curl -H "X-Feature-Events-Simulate: true" https://api/po/receive
```

**Verify Emitted Signal**:
- When simulated, response includes `_dev: { emitted: true }` metadata (line 233 in po-receive.ts)
- Smoke test `smoke:po:emit-events` (ops/smoke/smoke.mjs:667) verifies both `po.received` and `po.line.received` payloads
- No external bus call occurs; ideal for CI testing

**Current Smoke Test Status**:
- ✅ `smoke:po:emit-events` passes: confirms event payloads shape correctly
- ✅ `smoke:po:vendor-guard:on|off` passes: confirms flag header override works
- ⚠️ No validation of actual event bus delivery (stub returns noop)

---

## 5. Observability & Telemetry Gaps

**Current Logging**:
- `po-receive.ts` line 230: `console.warn("dispatchEvent failed", e)` on dispatcher exception
- `po-receive.ts` line 236: `console.error(err)` on top-level handler error
- `so-commit.ts`, `so-reserve.ts`: Structured JSON logs with `tag`, `reqId`, operation metadata (not event-specific)
- No dedicated event dispatch logging or metrics

**Missing**:
- Event emission success/failure metrics (events emitted counter, latency histogram)
- Audit trail linking event -> PO/line ID for compliance
- Event bus delivery confirmation (async) or retry policy
- Telemetry/tracing IDs (e.g., X-Amzn-Trace-Id correlation)
- Feature flag adoption metrics (how often events enabled in prod?)

**Risk**: Without observability, silent failures in event bus wiring go undetected until downstream systems report data loss.

---

## 6. Known Risks & TODOs

| Risk | Severity | Mitigation | Owner |
|------|----------|-----------|-------|
| **Dispatcher is noop** | High | Placeholder comment at line 11; wiring deferred post-Sprint III | TBD (integration team) |
| **No state persistence** | Medium | `maybeDispatch()` returns string signal; response metadata not persisted or journaled | Event store design needed |
| **Simulation signal in response** | Low | `_dev: { emitted: true }` exposed in HTTP response; clients must ignore in prod | Client-side docs |
| **No feature flag registry** | Medium | 3 flags scattered in flags.ts; no central config or deployment docs | Feature flag docs PR |
| **actorId always null** | Medium | `po-receive.ts` line 211 hardcodes `actorId: null`; should capture authenticated user | Auth wiring (blocked by JWT parsing) |
| **No EventBridge/SNS credentials** | High | Dispatcher has no AWS SDK imports; EventBridge/SNS integration requires IAM role & client setup | Infra/deployment TBD |
| **Error handling doesn't propagate** | Medium | `catch (e)` at line 229 swallows dispatcher errors; receipt still succeeds even if event fails | Consider retry policy |
| **No feature flag version tracking** | Low | Flag changes not versioned; no rollback plan if flag breaks prod | Feature flag strategy doc needed |

---

## References

- **Specification**: [spec/MBapp-Modules.yaml](../spec/MBapp-Modules.yaml) (no event bus spec yet; see Issue #TODO)
- **Flag Definitions**: [apps/api/src/flags.ts](apps/api/src/flags.ts)
- **Dispatcher**: [apps/api/src/events/dispatcher.ts](apps/api/src/events/dispatcher.ts)
- **PO Receive Handler**: [apps/api/src/purchasing/po-receive.ts](apps/api/src/purchasing/po-receive.ts) (emitter calls at lines 211, 215)
- **Smoke Tests**: [ops/smoke/smoke.mjs](ops/smoke/smoke.mjs) lines 604–717 (vendor guard & emit event tests)
- **CORS Headers**: [apps/api/src/index.ts](apps/api/src/index.ts) line ~103 (flag names for override docs)

---

**Last Updated**: Dec 2025 (Sprint III snapshot)  
**Status**: Pre-integration (flags working, events noop, simulation functional for smoke tests)
