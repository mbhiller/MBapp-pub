# Smoke Test Coverage (Sprint IV)

## Overview

Smoke tests are integration tests for critical API flows. All tests use idempotency keys for safe retry and include party/vendor seeding. Run with `node ops/smoke/smoke.mjs <test-name>`.

---

## 1. Current Smoke Flows

### Health & Core

| Flow | Steps | Assertions | Endpoints |
|------|-------|-----------|-----------|
| **smoke:ping** | 1. GET /ping | 200 OK, text response | `/ping` |

### Parties & Entities

| Flow | Steps | Assertions | Endpoints |
|------|-------|-----------|-----------|
| **smoke:parties:happy** | 1. Create party (person, customer role) 2. Search by name 3. Update notes | All 3 ops return 200; search finds created party; update succeeds | `/objects/party`, `/objects/party/search`, `/objects/party/{id}` |

### Inventory Management

| Flow | Steps | Assertions | Endpoints |
|------|-------|-----------|-----------|
| **smoke:inventory:onhand** | 1. Create item 2. Receive qty 3 3. Get onhand | Onhand >= 3; movement captured | `/objects/item`, `/objects/inventoryMovement`, `/inventory/{id}/onhand` |
| **smoke:inventory:guards** | 1. Create item 2. Receive qty 1 3. Try to reserve qty 2 (should fail) | Reserve fails with 400+; guards enforced | `/objects/item`, `/objects/inventoryMovement` |
| **smoke:inventory:onhand-batch** | 1. Create 2 items 2. Receive each 3. GET /inventory/onhand:batch | Both items in response; onhands correct | `/inventory/onhand:batch` |
| **smoke:inventory:list-movements** | 1. Create item 2. Receive 3, reserve 1, receive 2, reserve 1 3. List movements | 4 movements returned; all match item | `/inventory/{id}/movements` |

### Sales Orders

| Flow | Steps | Assertions | Endpoints |
|------|-------|-----------|-----------|
| **smoke:sales:happy** | 1. Create SO (draft) 2. Submit 3. Commit 4. Reserve L1 5. Fulfill L1(1) 6. Fulfill L1(1)+L2(1) 7. Close | Status flow: draft→submitted→committed→closed; onhand decrements | `/objects/salesOrder`, `/sales/so/{id}:submit`, `:commit`, `:reserve`, `:fulfill`, `:close` |
| **smoke:sales:guards** | 1. Create SO qty 5, onhand 2 2. Submit 3. Reserve 2 4. Try cancel (blocked) 5. Release & cancel 6. Create SO qty 9999, strict:true commit (blocked) | Cancel blocked while reserved; strict commit rejects oversell | `/sales/so/{id}:cancel`, `:release`, `:commit` |

### Purchase Orders

| Flow | Steps | Assertions | Endpoints |
|------|-------|-----------|-----------|
| **smoke:purchasing:happy** | 1. Create PO (draft) 2. Submit 3. Approve 4. Wait approved status 5. Receive 2 units line P1 6. Receive 1 P1 + 1 P2 7. Close | Status flow: draft→submitted→approved→received→closed; inventory increases | `/objects/purchaseOrder`, `/purchasing/po/{id}:submit`, `:approve`, `:receive`, `:close` |
| **smoke:purchasing:guards** | 1. Create PO 2. Try approve early (blocked) 3. Submit & approve 4. Try receive qty 3 (qty ordered is 2, blocked) 5. Try cancel (blocked) | Approve only after submit; receive qty guard; cancel blocked after approve | `/purchasing/po/{id}:approve`, `:receive`, `:cancel` |
| **smoke:po:save-from-suggest** | 1. Suggest PO (or hardcode draft) 2. Create from suggestion 3. Get created PO | PO id returned; status is draft | `/purchasing/suggest-po`, `/purchasing/po:create-from-suggestion`, `/objects/purchaseOrder/{id}` |
| **smoke:po:quick-receive** | 1. Create PO, submit, approve 2. Read full lines 3. Receive all outstanding | All lines received; status fulfilled | `/purchasing/po/{id}:receive` |
| **smoke:po:receive-line** | 1. Create product + item 2. Create PO line 3. Submit, approve 4. Receive 2 qty with lot+location 5. Retry same payload with different Idempotency-Key (idem via payload sig) 6. Retry again 7. Receive final qty | Status: draft→submitted→approved→partially_fulfilled; retries succeed (payload sig idempotency) | `/purchasing/po/{id}:receive` |
| **smoke:po:receive-line-batch** | 1. Create 2 products + items 2. Create PO 2 lines 3. Submit, approve 4. Receive line BL1 qty 2 + BL2 qty 1 5. Receive BL2 remaining qty 3 | BL1 fully received, BL2 fully received; status fulfilled | `/purchasing/po/{id}:receive` |
| **smoke:po:receive-line-idem-different-key** | 1. Create PO 2. Submit, approve 3. Receive with payload + KEY_A 4. Receive same payload + KEY_B 5. Finish receive with third key | Both KEY_A and KEY_B succeed idempotently; final status fulfilled | `/purchasing/po/{id}:receive` |

### Feature Flags & Events

| Flow | Steps | Assertions | Endpoints |
|------|-------|-----------|-----------|
| **smoke:po:vendor-guard:on** | 1. Create PO with vendor 2. Clear vendorId, try submit (blocked, VENDOR_REQUIRED) 3. Create PO, set wrong party role, try submit (blocked, VENDOR_ROLE_MISSING) | Vendor required guard works; role check enforced; flag ON | `/purchasing/po/{id}:submit` |
| **smoke:po:vendor-guard:off** | 1. Create PO, submit/approve with header X-Feature-Enforce-Vendor: 0 2. Clear vendorId, submit again 3. Receive | Submit/approve succeed without vendor; flag OFF via header | `/purchasing/po/{id}:submit`, `:approve`, `:receive` |
| **smoke:po:emit-events** | 1. Create PO, submit, approve 2. Receive with header X-Feature-Events-Simulate: 1 3. Check response._dev.emitted === true | Response includes _dev: { emitted: true }; event simulation works | `/purchasing/po/{id}:receive` |

### Pagination & Filtering

| Flow | Steps | Assertions | Endpoints |
|------|-------|-----------|-----------|
| **smoke:objects:list-pagination** | 1. GET /objects/purchaseOrder?limit=2&sort=desc 2. If next cursor, fetch second page | pageInfo or legacy `next` present; cursor works | `/objects/purchaseOrder` |
| **smoke:movements:filter-by-poLine** | 1. Create product + item, PO, submit, approve 2. Receive with lot/location 3. GET /inventory/{id}/movements?refId=poId&poLineId=lineId | Movements filtered by refId AND poLineId; lot/location captured | `/inventory/{id}/movements` |
| **smoke:objects:pageInfo-present** | 1. GET /objects/purchaseOrder?limit=2 | Response has items array AND (pageInfo OR legacy `next`) | `/objects/purchaseOrder` |

### Registrations (Sprint IV)

| Flow | Steps | Assertions | Endpoints |
|------|-------|-----------|--------|
| **smoke:registrations:crud** | 1. POST /registrations (eventId, partyId, status:draft) 2. GET /registrations/{id} 3. PUT /registrations/{id} (status:submitted) 4. DELETE /registrations/{id} 5. GET /registrations/{id} verify 404 | Create returns 201 with id; GET returns full object; PUT updates status; DELETE returns 204; verify removal | `/registrations`, `/registrations/{id}` |
| **smoke:registrations:filters** | 1. Create 3 registrations (2 with eventA, 2 with partyX, 2 with status:submitted) 2. GET /registrations?eventId=eventA 3. GET /registrations?partyId=partyX 4. GET /registrations?status=submitted | Filter by eventId returns 2; by partyId returns 2; by status returns 2; all counts match expected | `/registrations?eventId=...&partyId=...&status=...` |

### EPC & Misc

| Flow | Steps | Assertions | Endpoints |
|------|-------|-----------|-----------|
| **smoke:epc:resolve** | 1. GET /epc/resolve?epc=EPC-NOT-FOUND-{ts} | 404 status | `/epc/resolve` |

---

## 2. Coverage by Module

| Module | Smoke Tests | Status | Notes |
|--------|------------|--------|-------|
| **Inventory** | onhand, guards, onhand-batch, list-movements | ✅ Complete | CRUD + guards + batch ops + filter |
| **Sales Orders** | sales:happy, sales:guards | ✅ Complete | Lifecycle (draft→closed) + guards (reserve lock, oversell) |
| **Purchase Orders** | purchasing:happy, purchasing:guards, po:save-from-suggest, po:quick-receive, po:receive-line*, po:receive-line-batch, po:receive-line-idem-* | ✅ Complete | Lifecycle, receipt variants, idempotency, vendor guard, events |
| **Parties** | parties:happy | ✅ Complete | Create, search, update |
| **Pagination & Filtering** | objects:list-pagination, objects:pageInfo-present, movements:filter-by-poLine | ✅ Complete | Cursor pagination, field filters |
| **Feature Flags** | po:vendor-guard:on, po:vendor-guard:off, po:emit-events | ✅ Complete | Header overrides, simulation |
| **EPC** | epc:resolve | ✅ Complete | 404 case only |
| **Registrations** | registrations:crud, registrations:filters | ✅ Complete (Sprint IV) | CRUD lifecycle + filters (eventId, partyId, status); feature-flagged (default OFF) |
| **Views** | ❌ None | ⚠️ Gap | Spec defines /views (CRUD) — not tested |
| **Workspaces** | ❌ None | ⚠️ Gap | Spec defines /workspaces (CRUD) — not tested |
| **Backorders** | ❌ None | ⚠️ Gap | Spec defines backorderRequest (ignore, convert) — not tested |
| **Routing** | ❌ None | ⚠️ Gap | Spec defines /routing/graph, /routing/plan (deprecated in Sprint III?) — not tested |
| **Scanner** | ❌ None | ⚠️ Gap | Spec defines sessions, actions, simulate — not tested |
| **Audit** | ❌ None | ⚠️ Gap | Spec defines /admin/audit — not tested |

---

## 3. Gaps vs. Spec (Sprint IV Scope)

**Sprint IV Delivered** (Registrations v1):
- ✅ registrations:crud — POST → GET → PUT → DELETE lifecycle
- ✅ registrations:filters — Query filters (eventId, partyId, status)
- ✅ Feature flag tested via X-Feature-Registrations-Enabled header

**Critical Gaps (Still Pending)**:
1. **smoke:views:crud** — No test for create/read/update/delete views (Sprint III scope deferred)
2. **smoke:workspaces:list** — No test for workspaces listing (Sprint III scope deferred)
3. **smoke:events:enabled-noop** — Event dispatch flag gating NOT tested (featureEventsEnabled still noop stub)

**Out of Scope (Not Expected in Current Tier)**:
- Registration actions (:cancel, :checkin, :checkout) — Tier 2
- Registration payments, capacity rules — Tier 2+
- Backorder workflows (ignore, convert)
- Routing (graph, plan)
- Scanner (sessions, actions, simulate)
- Audit log query

---

## 4. Proposed New Flows (Sprint III)

### smoke:views:crud

**Purpose**: Validate views create/read/update/delete operations.

**Exact Steps**:
1. POST `/views` with `{ name: "ViewA", type: "dashboard", config: { tiles: [] } }`
2. Assert 200/201; capture `viewId` from response
3. GET `/views/{viewId}`
4. Assert 200; body.name === "ViewA"
5. PUT `/views/{viewId}` with `{ name: "ViewA-Updated", config: { tiles: [{ id: "T1" }] } }`
6. Assert 200; body.name === "ViewA-Updated"
7. DELETE `/views/{viewId}` (or POST `:delete` if POST-only)
8. GET `/views/{viewId}` again; assert 404

**Expected Assertions**:
- ✅ Create returns 201 with id + name + config
- ✅ Read returns full view object
- ✅ Update persists; read reflects changes
- ✅ Delete returns 204 or success; subsequent read is 404

**Target Endpoints**: `/views`, `/views/{id}`

---

### smoke:workspaces:list

**Purpose**: Validate workspaces listing with pagination.

**Exact Steps**:
1. POST `/workspaces` with `{ name: "WS-Smoke", description: "test workspace" }` (create at least 1)
2. GET `/workspaces?limit=10&sort=desc`
3. Assert 200; check response.items is array
4. Assert response includes at least 1 item with name "WS-Smoke"
5. If response.pageInfo?.nextCursor exists, fetch second page with `?limit=10&next={cursor}`
6. Assert second page has items array

**Expected Assertions**:
- ✅ Create returns 201 with id + name
- ✅ List returns items array + pagination metadata (pageInfo or legacy next)
- ✅ Cursor pagination works (if > 10 workspaces)
- ✅ Items include name, description, timestamps

**Target Endpoints**: `/workspaces`, `/workspaces?limit=...&next=...`

---

### smoke:events:enabled-noop

**Purpose**: Validate event dispatcher flag gating (featureEventsEnabled) and noop behavior.

**Exact Steps**:
1. Create PO, submit, approve as in smoke:po:emit-events
2. GET `/objects/purchaseOrder/{id}`; capture lines
3. POST `/purchasing/po/{id}:receive` with header `X-Feature-Events-Enabled: 1` (flag ON) + `X-Feature-Events-Simulate: 0` (simulation OFF)
4. Assert 200; capture response (should NOT have _dev.emitted since simulate=OFF)
5. POST `/purchasing/po/{id}:receive` again with header `X-Feature-Events-Enabled: 0` (flag OFF)
6. Assert 200; same behavior (noop stub regardless)
7. POST `/purchasing/po/{id}:receive` with `X-Feature-Events-Enabled: 1` + `X-Feature-Events-Simulate: 1` (both ON)
8. Assert 200; response._dev.emitted === true (simulation overrides noop)

**Expected Assertions**:
- ✅ With events enabled=OFF: dispatch is noop, no _dev metadata
- ✅ With events enabled=ON, simulate=OFF: dispatch is noop (stub), no _dev metadata
- ✅ With events enabled=ON, simulate=ON: response includes _dev.emitted === true
- ✅ Simulation path overrides both flags; always signals "emitted"
- ✅ PO status updated correctly in all cases (events don't block receipt)

**Target Endpoints**: `/purchasing/po/{id}:receive`

**Feature Flags**:
- `X-Feature-Events-Enabled: 1` (env: FEATURE_EVENT_DISPATCH_ENABLED)
- `X-Feature-Events-Simulate: 1` (env: FEATURE_EVENT_DISPATCH_SIMULATE)

---

## 5. Running Smoke Tests

### Prerequisites

```bash
export MBAPP_API_BASE="http://localhost:3000"
export MBAPP_TENANT_ID="DemoTenant"
export MBAPP_DEV_EMAIL="dev@example.com"

# Optional: Bearer token (if not using dev-login)
export MBAPP_BEARER="eyJ..."

# Optional: override movement type (default inventoryMovement)
export SMOKE_MOVEMENT_TYPE="inventoryMovement"
```

### Run All Tests

```bash
node ops/smoke/smoke.mjs list          # Show available tests
node ops/smoke/smoke.mjs smoke:ping    # Run single test
node ops/smoke/smoke.mjs smoke:parties:happy
```

### Run Multiple in CI

```bash
#!/bin/bash
set -e
export MBAPP_API_BASE="http://localhost:3000"
export MBAPP_TENANT_ID="DemoTenant"

TESTS=(
  "smoke:ping"
  "smoke:parties:happy"
  "smoke:inventory:onhand"
  "smoke:sales:happy"
  "smoke:purchasing:happy"
  "smoke:po:vendor-guard:on"
  "smoke:po:vendor-guard:off"
  "smoke:po:emit-events"
)

for test in "${TESTS[@]}"; do
  node ops/smoke/smoke.mjs "$test" || exit 1
done

echo "✅ All tests passed"
```

### Feature Flag Overrides (Dev/CI)

```bash
# Disable vendor guard
node ops/smoke/smoke.mjs smoke:po:vendor-guard:off
# (uses X-Feature-Enforce-Vendor: 0 header internally)

# Enable event simulation
node ops/smoke/smoke.mjs smoke:po:emit-events
# (uses X-Feature-Events-Simulate: 1 header internally)
```

### Test Output Format

Each test returns JSON:
```json
{
  "test": "name",
  "result": "PASS|FAIL",
  "status": 200,
  "create": { "ok": true, "status": 201, "body": { "id": "..." } },
  "artifacts": { ... }
}
```

Exit code: 0 (PASS), 1 (FAIL)

---

## 6. Known Limitations

- **Events are noop**: dispatchEvent() returns "noop" stub; no EventBridge/SNS integration yet
- **Simulation signal only**: _dev.emitted is response metadata only; not persisted or journaled
- **No real event bus tests**: Can't verify downstream consumers receive events
- **Dev-only header overrides**: Feature flag headers only work in dev/CI (prod ignores)
- **No concurrent test isolation**: Tests share DemoTenant; sequential execution recommended

---

## References

- **Smoke Test File**: [ops/smoke/smoke.mjs](ops/smoke/smoke.mjs) (724 lines, 20 flows)
- **Smoke Seeds**: [ops/smoke/seed/](ops/smoke/seed/) (routing.ts, parties.ts, vendor seeding)
- **Feature Flags Docs**: [docs/flags-and-events.md](flags-and-events.md)
- **Spec**: [spec/MBapp-Modules.yaml](../spec/MBapp-Modules.yaml)
- **CORS/Feature Headers**: [apps/api/src/index.ts](../apps/api/src/index.ts) line ~103

---

**Last Updated**: Dec 20, 2025 (Sprint IV)  
**Status**: 22 test flows implemented (includes Registrations v1); Views/Workspaces CRUD deferred
