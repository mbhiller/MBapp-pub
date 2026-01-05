# Smoke Test Coverage (Sprint S, 2025-12-31)

**Navigation:** [Roadmap](MBapp-Roadmap.md) · [Status/Working](MBapp-Status.md) · [Foundations](MBapp-Foundations.md) · [Cadence](MBapp-Cadence.md)  
**Last Updated:** 2026-01-04

---

## Overview

Smoke tests are integration tests for critical API flows. All tests use idempotency keys for safe retry and include party/vendor seeding.

---

## 🚀 Quick Start

**Before submitting a PR (PR parity — matches CI gating):**
```bash
npm run typecheck --workspaces --if-present
npm run smokes:run:core          # 41 core flows (~3-4 min)
```

**Run one smoke:**
```bash
node ops/smoke/smoke.mjs smoke:inventory:crud
```

**Run all smokes (local or full suite):**
```bash
npm run smokes:run:ci            # All 65 flows (~8-10 min)
```

**See all blessed commands:**
```bash
npm run smokes:help
```

---

## Tier System

Smokes are organized by tier for targeted CI validation:

| Tier | Flows | Duration | When | Command |
|------|-------|----------|------|--------|
| **core** | 42 | ~2–3 min | Every PR/push | `npm run smokes:run:core` |
| **extended** | 24 | ~2–3 min | Nightly (2 AM UTC) | `npm run smokes:run:extended` |
| **all** | 66 | ~5–6 min | Nightly full | `npm run smokes:run:ci` |

**Core flows:** Foundation + critical domain workflows (auth, objects, line ID, sales/purchase orders, inventory, fulfillment, backorders, suggestions).

**Extended flows:** Permission tests, views, workspaces, EPC/scanner, idempotency, advanced scenarios.

**Reference:** See [ci-smokes-guide.md](ci-smokes-guide.md) for detailed tier breakdown.

---

## CI Debugging Failed Smokes

**When a smoke fails locally or in CI:**

1. **Find the failing smoke name** in logs: `[ci-smokes] → node ops/smoke/smoke.mjs smoke:workspaces:list`

2. **Read the failure summary** (runner prints before exiting) with rerun command + manifest path.

3. **Rerun the specific smoke:** `node ops/smoke/smoke.mjs smoke:workspaces:list`

4. **Check the manifest** for cleanup details: Location is `ops/smoke/.manifests/{SMOKE_RUN_ID}.json` (printed at run start).

**Reference:** Full debugging guide and common issues at [ci-smokes-guide.md](ci-smokes-guide.md).

---

## Observability: Timing & Performance

**As of Sprint AR (2026-01-04):** The runner collects per-smoke wall-clock timing and prints slowest smokes on success:

```json
{
  "summary": {"totalFlows": 42, "totalElapsedMs": 79315, "totalElapsedSec": "79.31", "tier": "core"},
  "slowest": [{"rank": 1, "name": "smoke:close-the-loop", "elapsedMs": 4261, "elapsedSec": "4.26"}, ...top 10...]
}
```

**Use for:** Identifying performance regressions, bottleneck flows, and optimization targets.

---

## CI Artifacts (Smoke Manifests)

Smokes write a manifest locally to `ops/smoke/.manifests/` containing details about created entities (type, id, route, metadata) for debugging and cleanup.

**GitHub Actions Artifact Upload:**
- **PR/push (`ci-smokes` job):** Uploaded only on failure (7-day retention)
  - Artifact name: `smoke-manifests-core-{run_id}`
  - Use to inspect failed test artifacts when a core smoke fails
- **Nightly (`ci-smokes-nightly` job):** Uploaded always (14-day retention)
  - Artifact name: `smoke-manifests-nightly-{run_id}`
  - Useful for performance analysis and trend tracking across nightly runs

**Local Debugging:**
Manifest path is printed at run start: `ops/smoke/.manifests/smk-{timestamp}-{random}.json`

---

## Overview (Continued)

Sprint I (2026-01-02): No new smokes added; existing backorder → suggest-po → receive loops remain covered via `npm run smokes:run:ci`.

**CI Smoke Manifest:** The definitive list of tests run in CI is maintained in [ops/ci-smokes.json](../ops/ci-smokes.json). Additional flows exist in `ops/smoke/smoke.mjs` but are opt-in only. CI includes `smoke:views:crud`, `smoke:views:validate-filters`, `smoke:views:save-then-update`, `smoke:views-workspaces:permissions`, `smoke:workspaces:list`, `smoke:workspaces:mixed-dedupe`, `smoke:workspaces:get-fallback`, `smoke:workspaces:default-view-validation`, `smoke:views:apply-to-po-list`, `smoke:views:apply-to-product-list`, `smoke:views:apply-to-inventory-list`, `smoke:views:apply-to-party-list`, `smoke:views:apply-to-backorders-list`.

**Scanner Actions Flows (Sprint S, E2):**
- `smoke:scanner:actions:record` — **NEW** (E2). Validates POST /scanner/actions endpoint:
  - Creates product + inventory item
  - Seeds EPC mapping for a unique EPC → itemId
  - POST /scanner/actions with action="count", epc=<seeded>, qty=1, no sessionId (validates optional sessionId per spec)
  - Asserts response.type === "scannerAction" and response.itemId === expected
  - Lists /objects/scannerAction with retry for eventual consistency; verifies created record appears in list
  - Idempotency check: replays POST with same Idempotency-Key, asserts same id returned (no duplicate)
  - Final list query verifies no duplicate created (count remains 1)
  - Returns detailed steps including attempts, idempotency match, and final list count for diagnostics
  - **Key invariant validated:** sessionId parameter is optional; request succeeds without it per spec alignment (E1 API changes)

**CI-covered patch-lines flows (Sprint G, enhanced Sprint V):**
- `smoke:salesOrders:patch-lines` — Creates SO draft with 2 lines (L1, L2), updates L1 qty, removes L2, adds new line; asserts new line receives L3 (not reused L2), `idReused: false`, and all IDs stable. **Sprint V enhancements:** Added format validation: `addedLineIdIsValid` (regex /^L\d+$/ ensures server assigns L{n} format), `allIdsValid` (Array.every checks all IDs match L{n} pattern). Assertions object returned includes these boolean flags and original idReused check.
- `smoke:purchaseOrders:patch-lines` — Mirrors SO flow for PO; validates identical id assignment behavior, no id reuse, and stable L{n} sequence. **Sprint V enhancements:** Identical format assertions to SO test (`addedLineIdIsValid`, `allIdsValid` with /^L\d+$/ regex, assertions object in return).
- `smoke:so:patch-lines:cid` — Adds SO line via `cid`, asserts server assigns `L{n}` id, then patches the same line by `id` and verifies qty update.
- `smoke:po:patch-lines:cid` — Adds PO line via `cid`, asserts server assigns `L{n}` id, then patches the same line by `id` and verifies qty update (draft-only guard enforced by endpoint). **Sprint V enhancements:** Added format validation: `clientIdValid` (regex /^tmp-/ ensures client cid uses tmp-* prefix), enhanced assertions object with roundtrip validation (new line's cid must start with "tmp-", server-assigned id must match /^L\d+/).
- `smoke:salesOrders:patch-lines-draft-only-after-submit` — Proves SO patch-lines is allowed in draft and strictly blocked post-submit with 409 `SO_NOT_EDITABLE`.
- `smoke:salesOrders:fulfill-idempotency-replay` — Proves same Idempotency-Key replay returns 200 and does not increase fulfilledQty or advance status (no duplicate movements/state changes).
- `smoke:salesOrders:fulfill-idempotency-key-reuse-different-payload` — Proves first-write-wins: same key with different payload returns cached result and does not apply the second payload (line B unchanged).

**CI-covered Line Identity Canonical flows (Sprint O, 2025-12-29 — E1 through E5, enhanced Sprint V):**
- `smoke:line-identity:id-canonical` — Validates that all SO/PO line responses contain canonical `id` field and that action endpoints accept `id` (not `lineId`) in request payloads. Creates PO with 2 lines, receives them using `id` field; creates SO, reserves it using `id` field. Asserts all response lines have `id` and no `lineId` in responses. **Also validates:**
  - API normalizes legacy `lineId` input to `id` and logs structured events
  - Existing action smokes (close-the-loop, partial-receive, backorders-partial-fulfill, outbound-reserve-fulfill-release) all updated to use `id` in payloads
  - Web and mobile clients send canonical `id` in all action payloads (E4, E5)
  - **Sprint V enhancement:** Test 5 added to validate no-id-reuse (remove existing line → add new line → verify new line id ≠ removed id)

**Guarantee (Sprint V):** All patch-lines smokes validate invariants via deterministic pattern matching:
  1. Client-generated IDs (cids) must use `tmp-{uuid}` format (never /^L\d+$/)
  2. Server-assigned IDs must match `/^L\d+$/` pattern (never tmp-* or other formats)
  3. Removed line IDs are reserved and **never reused** by the server (validated by id-canonical Test 5)
  4. React keying stable (derived from id || cid || generated)
  5. All assertions use O(n) or O(1) operations (regex, Array.every, Array.find) for test determinism

**CI-covered Views/Workspaces flows (Sprint H + Sprint Q):**
- `smoke:views:crud` — Creates view with unique timestamped name, validates CRUD operations (create, list with `q=<exact name>`, get, update, delete). Uses 5-attempt retry with 300ms delay for eventual consistency. **Deterministic:** filters by exact unique name instead of paginating through all views. **CI:** ✅ Yes
- `smoke:views:validate-filters` (Sprint Q) — Validates server-side filter validation: rejects views with (1) missing field, (2) invalid operator (badOp), (3) "in" operator with non-array value, (4) object value for eq operator. Accepts valid filters (eq/in/ge with proper types). Returns 400 bad_request with clear error messages for invalid filters. **CI:** ✅ Yes (Sprint AB E1)
- `smoke:workspaces:list` — Creates 2 temp views with unique smokeTag names and different entityTypes, validates filtering by `q=<tag>` and `entityType=<type>`. **Pollution-resistant:** uses unique run timestamp in names and filters by created view IDs, not generic patterns. **CI:** ✅ Yes
- `smoke:views:apply-to-po-list` (Sprint Q) — Creates 2 POs with different statuses (draft, submitted), creates View with `status="draft"` filter, queries `/purchasing/purchase-orders?viewId={id}`, asserts draft PO present and submitted PO absent. Validates that applying a view with filters constrains list results as expected. **CI:** ✅ Yes
- `smoke:views:apply-to-product-list` (Sprint H, enhanced Sprint J) — Creates 2 products with distinct tokens (productName contains token1 vs. token2), creates View with `q contains token1` filter, lists products with `q=token1`, **asserts Product 1 (token1) present and Product 2 (token2) absent**. Validates that view filter actually constrains results (not just routing concern). Cleanup retries DELETE to avoid residue. **Sprint J enhancement:** Strengthened with dual-entity filtering assertions to prevent regressions in view-to-filter mapping. **CI:** ✅ Yes
- `smoke:views:apply-to-inventory-list` (NEW, Sprint J) — Creates Product A + Inventory Item A (itemName contains tokenA), then Product B + Item B (tokenB). Creates View with `productId eq {prodA.id}` filter. Lists inventory with `filter.productId={prodA.id}` (derived from view). **Asserts Item A present; Item B absent.** Validates productId filtering on inventory list and proper view-to-filter mapping. **CI:** ✅ Yes
- `smoke:views:apply-to-party-list` (NEW, Sprint J) — Creates Party A (name contains tokenA, role="customer"), Party B (tokenB, role="vendor"). Creates View with `q contains tokenA` filter. Lists parties with `q=tokenA` (derived from view). **Asserts Party A present; Party B absent.** Validates q filtering on parties list. Both new inventory/party smokes follow dual-entity pattern: distinct search tokens, single-entity filter, assertions validate filter constrains results. **CI:** ✅ Yes
- `smoke:views:apply-to-backorders-list` (NEW, Sprint AT) — Creates sales order + 2 backorders (status: open, ignored). Creates View with `status="open"` filter. Lists backorders with `status="open"` (derived from view). **Asserts Backorder A (open) present; Backorder B (ignored) absent.** Validates status filtering on backorders list and proper view-to-filter mapping. Follows same dual-entity pattern as inventory/party smokes: distinct filter values, single-entity filter, assertions validate filter constrains results. **CI:** ✅ Yes (Sprint AT E4)
- `smoke:views:save-then-update` (NEW, Sprint AB) — **PATCH workflow validation.** Creates 2 POs with different statuses (PO1=draft, PO2→submitted). Creates View with `status="draft"` filter. Applies view and asserts **only PO1 (draft) matches**. PATCHes view to `status="submitted"` filter. Applies updated view and asserts **only PO2 (submitted) matches** (results flip). Validates operator leverage: update existing view without creating duplicate; filters re-evaluated correctly on reapplication. **CI:** ✅ Yes (Sprint AB E2)
- `smoke:views-workspaces:permissions` (NEW, Sprint AB) — **RBAC boundary enforcement.** Mints admin token (operator role with view:write + workspace:write) and viewer token (read-only role). Admin creates view + workspace (expect 201). Viewer attempts POST/PATCH/DELETE on views (all expect 403). Viewer attempts POST/PATCH/DELETE on workspaces (all expect 403). Viewer confirms GET /views and GET /workspaces still succeed (read allowed). Validates permission boundaries: writes blocked for read-only roles, reads succeed. **CI:** ✅ Yes (Sprint AB E3)
- `smoke:workspaces:mixed-dedupe` (Sprint Q) — Forces mixed-source pagination across true workspaces and legacy view-backed workspaces, asserting duplicates are deduped before counting toward `limit`, multi-page cursors stay stable, and IDs remain unique across pages. **CI:** ✅ Yes
- `smoke:workspaces:get-fallback` (Sprint Q) — Verifies legacy view-backed workspaces still resolve via workspace GET when no dedicated workspace record exists (ensures migration fallback safety). **CI:** ✅ Yes
- `smoke:migrate-legacy-workspaces:creates-workspace` (NEW, Sprint AU) — **End-to-end migration test.** Creates a legacy workspace-shaped view (type="view", with name, views[], shared, ownerId, no filters) via `/views`. Optionally verifies fallback works: GET /workspaces/:id should return it before migration. Invokes `ops/tools/migrate-legacy-workspaces.mjs --confirm` to copy the view to a canonical workspace record (type="workspace"). Validates canonical workspace created via GET /workspaces/:id and asserts fields preserved (name, views[], type, shared, ownerId, entityType, description). **Requires AWS credentials** (tool needs DynamoDB access); SKIP in CI if creds unavailable. Records both artifacts (legacy view, migrated workspace) for cleanup. **Purpose:** Prove migration tool successfully copies legacy views to workspace source; validates copy-only behavior (legacy view preserved) and field preservation across the copy operation. **CI:** ⚠️ Local only (AWS credentials required); skips in CI.

**Note (2025-12-30):** No new smokes needed; `smoke:views:crud` revalidated after `/views` added server-side `entityType` filtering, and `smoke:workspaces:list` still passes with q + entityType filters across pages after pagination hardening.
**Note (2025-12-30):** During the workspace storage migration (primary `type="workspace"` with legacy `type="view"` fallback/dual-write), `smoke:workspaces:list` continues to validate list semantics across both sources; keep it as the guardrail for pagination + filter compatibility.
**Note (2026-01-02, Sprint J):** View apply smokes expanded from products only to include inventory and parties. All three `apply-to-*-list` smokes validate dual-entity filtering: create two entities with distinct search tokens, apply view with filter targeting one, assert only matching entity present in results. Strengthened product smoke with explicit filtering assertions per same pattern.

**Reliability Hardening (Sprint V/U/J/AT):**
- `smoke:views:apply-to-po-list` now wraps cleanup in try/finally and retries DELETE up to 5× to ensure created temp view is removed, improving CI hygiene and reducing flake.
- `smoke:workspaces:list` now paginates through all pages (up to 10) with up to 25 retry attempts to handle eventual consistency and non-deterministic ordering, ensuring created workspace IDs are found before filtering assertions.
- `smoke:views:apply-to-product-list` (Sprint J): Dual-entity filtering assertions added; creates Product 1 (token1) and Product 2 (token2), applies view with q filter on token1, validates Product 1 present and Product 2 absent.
- `smoke:views:apply-to-inventory-list` (Sprint J, NEW): Dual-entity productId filtering; creates items in two different products, applies productId filter, asserts correct item present and other product's item absent.
- `smoke:views:apply-to-party-list` (Sprint J, NEW): Dual-entity q filtering; creates parties with different search tokens, applies view with q filter on one token, asserts matching party present and non-matching absent.
- `smoke:views:apply-to-backorders-list` (Sprint AT, NEW): Dual-entity status filtering; creates backorders with different statuses (open, ignored), applies view with status filter, asserts matching backorder present and non-matching absent. Validates backorders list view-to-filter mapping. Cleanup retries DELETE with 5 attempts.
- `smoke:views:save-then-update` (Sprint AB, NEW): PATCH workflow; creates two POs (draft vs. submitted), view with draft filter (asserts PO1 found), PATCH view to submitted filter (asserts PO2 found, PO1 not found). Validates filter update + reapplication determinism, supports operator leverage pattern.
- `smoke:views-workspaces:permissions` (Sprint AB, NEW): RBAC boundary test; mints two tokens (admin with write perms, viewer read-only), admin creates view+workspace (201), viewer denied POST/PATCH/DELETE on both (403), viewer reads succeed (200). Validates permission enforcement at API layer, cleanup retries DELETE with admin token.

- Default tenant: any tenant starting with **SmokeTenant** (e.g., SmokeTenant, SmokeTenant-qa). Override only by setting `MBAPP_SMOKE_ALLOW_NON_SMOKE_TENANT=1` (dangerous).
- `SMOKE_RUN_ID` is emitted in the preflight log; set `SMOKE_RUN_ID` explicitly to tag runs or let the runner generate one.
  - The runner records a manifest per run in `ops/smoke/.manifests/<SMOKE_RUN_ID>.json` capturing created entities (type, id, route, meta).
  - Use the cleanup script to delete only artifacts from a specific `SMOKE_RUN_ID` via allowlisted single-delete endpoints.

**Consistency Contract:**
- `GET /inventory/movements?locationId=...` and `GET /inventory/{itemId}/movements` use a **time-ordered index** (pk=tenantId, sk=`inventoryMovementAt#{at}#{movementId}`) to retrieve movements in chronological order.
  - This eliminates sparse-locationId pagination issues: filtering by locationId/itemId on time-ordered data is O(limit).
  - Newly written movements appear immediately in the time-ordered index due to dual-write in `createMovement()`.
- Both endpoints use **consistent reads** within the tenant partition to avoid write-after-read gaps.
- **Smoke test determinism:** `smoke:inventory:movements-by-location` relies on the timeline index to ensure the newly written putaway movement appears in the by-location list immediately (within 1-2 poll attempts). Without the timeline index, pagination before filtering would cause transient failures.
- Response shape is unchanged; backward compatible with existing clients.

---

## Quick Start (TL;DR)

### Run Full Smoke Suite (Local Dev)
```powershell
# Set smoke-specific tenant (leaves your normal MBAPP_TENANT_ID untouched)
$env:MBAPP_SMOKE_TENANT_ID = "SmokeTenant"
$env:MBAPP_SMOKE_ALLOW_TENANT_MISMATCH = "1"  # until SmokeTenant JWT available
$env:MBAPP_API_BASE = "https://ki8kgivz1f.execute-api.us-east-1.amazonaws.com"
./ops/ci/Emit-CIEnv.ps1 -ShowToken           # or set $env:MBAPP_BEARER manually
npm run smokes:run:ci
# Manifest written to: ops/smoke/.manifests/smk-{timestamp}-{random}.json
```

### Run Single Test
```powershell
# Set env from above, then:
node ops/smoke/smoke.mjs smoke:inventory:crud
node ops/smoke/smoke.mjs smoke:views:crud
node ops/smoke/smoke.mjs smoke:close-the-loop

> Note: Inventory movement smokes call `GET /inventory/{id}/movements` with `limit=50` to reduce paging pressure in tenant-partition scans and improve read-after-write stability.
```

### Run Local CI-Equivalent (Exact CI Behavior)
```powershell
# Emulates CI environment exactly:
$env:MBAPP_SMOKE_TENANT_ID = "SmokeTenant"
$env:MBAPP_SMOKE_ALLOW_TENANT_MISMATCH = "1"
$env:MBAPP_API_BASE = "https://ki8kgivz1f.execute-api.us-east-1.amazonaws.com"
./ops/ci/Emit-CIEnv.ps1 -ShowToken
npm run smokes:run:ci
# Result: Tests run, manifest saved, no errors due to tenant mismatch
```

## Mint SmokeTenant Token

To eliminate tenant mismatch and allow CI to run strictly, mint a SmokeTenant-scoped JWT and add it as a GitHub Actions secret.

PowerShell (Windows):
```powershell
# 1) Point to your API base (nonprod or prod as appropriate)
$env:MBAPP_API_BASE = "https://ki8kgivz1f.execute-api.us-east-1.amazonaws.com"

# 2) Set the tenant to SmokeTenant for this shell
$env:MBAPP_TENANT_ID = "SmokeTenant"

# 3) Mint a dev-login token for SmokeTenant
./ops/Set-MBEnv.ps1 -Login

# 4) Copy the token (do not commit it)
echo $env:MBAPP_BEARER
```

Alternative (one-shot emit using CI helper):
```powershell
$env:MBAPP_API_BASE = "https://ki8kgivz1f.execute-api.us-east-1.amazonaws.com"
$env:MBAPP_TENANT_ID = "SmokeTenant"
./ops/ci/Emit-CIEnv.ps1 -EmitTokenOnly
# Copy the emitted token line (last line)
```

Add to GitHub Actions secrets:
- Open GitHub → Repo → Settings → Secrets and variables → Actions → New secret
- Name: `MBAPP_BEARER_SMOKE`
- Value: paste the token captured above

CI will prefer `MBAPP_BEARER_SMOKE` and run under `SmokeTenant` without mismatch overrides.

## How to Run Smokes & Cleanup (Canonical)

### Blessed Commands (Local & CI)

**Before submitting a PR (matches CI PR gating):**
```bash
npm run typecheck --workspaces --if-present
npm run smokes:run:core
```

**Run single smoke:**
```bash
node ops/smoke/smoke.mjs smoke:inventory:crud
node ops/smoke/smoke.mjs smoke:views:crud
node ops/smoke/smoke.mjs smoke:workspaces:list
```

**Run full smoke suite (local or manual CI trigger):**
```bash
npm run smokes:run:ci
```

**Run extended smokes only:**
```bash
npm run smokes:run:extended
```

**Typecheck single workspace:**
```bash
npm run typecheck -w apps/api
```

**See all blessed commands:**
```bash
npm run smokes:help
```

### CI Behavior

| Trigger | Smokes Job | Flows | Time |
|---------|-----------|-------|------|
| Pull Request | ci-smokes (core) | 41/65 | ~3-4 min |
| Push to main | ci-smokes (core) | 41/65 | ~3-4 min |
| Nightly (2 AM UTC) | ci-smokes-nightly (full) | 65/65 | ~8-10 min |

### Local-Friendly Run (Current Tenant)
Run a single smoke flow using your currently logged-in tenant (no SmokeTenant guard). Pass the flow name to the smoke runner.

```bash
# Example: run inventory CRUD against current tenant
node ops/smoke/smoke.mjs smoke:inventory:crud

# Or any other flow:
node ops/smoke/smoke.mjs smoke:views:crud
node ops/smoke/smoke.mjs smoke:workspaces:list
```

Notes:
- This path uses whatever is in `MBAPP_TENANT_ID` and your current bearer.
- If your bearer decodes to a different tenant than `MBAPP_TENANT_ID`, you must explicitly opt in:
  - Set `MBAPP_SMOKE_ALLOW_TENANT_MISMATCH=1` to allow running with mismatched token/header.
- Prefer `npm run smokes:run:ci` for strict `SmokeTenant` runs; it enforces tenant alignment and fails fast if a `SmokeTenant` JWT is not supplied.

**1) Run CI-style smokes locally (SmokeTenant header, DemoTenant JWT)**
```powershell
$env:MBAPP_TENANT_ID="DemoTenant"
$env:MBAPP_SMOKE_TENANT_ID="SmokeTenant"
$env:MBAPP_SMOKE_ALLOW_TENANT_MISMATCH="1"
Remove-Item Env:SMOKE_RUN_ID -ErrorAction SilentlyContinue
npm run smokes:run:ci
```

**2) Cleanup DRY RUN (latest manifest)**
```powershell
$env:MBAPP_TENANT_ID="DemoTenant"
$env:DRY_RUN="1"
Remove-Item Env:SMOKE_RUN_ID -ErrorAction SilentlyContinue
npm run smokes:cleanup
```

**3) Cleanup DRY RUN (specific run id)**
```powershell
$env:MBAPP_TENANT_ID="DemoTenant"
$env:DRY_RUN="1"
$env:SMOKE_RUN_ID="smk-...."
npm run smokes:cleanup
```

**4) REAL delete (explicitly armed)**
```powershell
$env:MBAPP_TENANT_ID="DemoTenant"
Remove-Item Env:DRY_RUN -ErrorAction SilentlyContinue
$env:MBAPP_SMOKE_CLEANUP="1"
npm run smokes:cleanup
```

### Glossary (Env Vars)
- MBAPP_TENANT_ID: Normal shell tenant (usually DemoTenant)
- MBAPP_SMOKE_TENANT_ID: Tenant used by ci-smokes child processes (set to SmokeTenant for smokes)
- MBAPP_SMOKE_ALLOW_TENANT_MISMATCH: Temporary override to allow DemoTenant JWT with SmokeTenant header
- MBAPP_SMOKE_CLEANUP: Arming switch for real deletes (must be "1")
- DRY_RUN: If truthy, forces planning-only mode

## Opt-in Smokes (Manual)

- `smoke:locations:crud`: Validates Location object CRUD via `/objects/location` (create, get, update, list/search). Records created `location` in the manifest for cleanup.
- `smoke:po-receive-lot-location-assertions`: Updated to create a real `location` and assert PO receive movements include the dynamic `locationId` and `lot`. Use only when validating receive+location integration.

## Smokes & Cleanup Cheat Sheet (PowerShell)

**Run smokes (CI-style, SmokeTenant header, DemoTenant JWT)**
```powershell
$env:MBAPP_TENANT_ID="DemoTenant"
$env:MBAPP_SMOKE_TENANT_ID="SmokeTenant"
$env:MBAPP_SMOKE_ALLOW_TENANT_MISMATCH="1"
Remove-Item Env:SMOKE_RUN_ID -ErrorAction SilentlyContinue
npm run smokes:run:ci
```

**Cleanup dry-run (latest manifest)**
```powershell
$env:MBAPP_TENANT_ID="DemoTenant"
$env:DRY_RUN="1"
Remove-Item Env:SMOKE_RUN_ID -ErrorAction SilentlyContinue
npm run smokes:cleanup
```

**Cleanup dry-run (specific run id)**
```powershell
$env:MBAPP_TENANT_ID="DemoTenant"
$env:DRY_RUN="1"
$env:SMOKE_RUN_ID="smk-...."
npm run smokes:cleanup
```

**Cleanup real delete (explicitly armed)**
```powershell
$env:MBAPP_TENANT_ID="DemoTenant"
Remove-Item Env:DRY_RUN -ErrorAction SilentlyContinue
$env:MBAPP_SMOKE_CLEANUP="1"
npm run smokes:cleanup
```

### Glossary (Env Vars)
- MBAPP_TENANT_ID: Normal shell tenant (usually DemoTenant)
- MBAPP_SMOKE_TENANT_ID: Tenant used by ci-smokes child processes (set to SmokeTenant for smokes)
- MBAPP_SMOKE_ALLOW_TENANT_MISMATCH: Temporary override to allow DemoTenant JWT with SmokeTenant header
- MBAPP_SMOKE_CLEANUP: Arming switch for real deletes (must be "1")
- DRY_RUN: If truthy, forces planning-only mode

### Cleanup (Dry Run - Always Start Here)
```powershell
$env:SMOKE_RUN_ID = "latest"                # Auto-picks most recent manifest
$env:MBAPP_TENANT_ID = "DemoTenant"         # Must match jwtTenant from manifest
$env:MBAPP_API_BASE = "https://ki8kgivz1f.execute-api.us-east-1.amazonaws.com"
$env:MBAPP_BEARER = $env:MBAPP_BEARER       # Token from smoke run
$env:DRY_RUN = "1"
npm run smokes:cleanup
# Output: Planned deletes printed, nothing deleted, exit 0
```

### Cleanup (Real Deletes - Explicit Opt-In)
```powershell
# Same as dry-run above, then:
$env:DRY_RUN = ""                           # Unset DRY_RUN to allow real deletes
$env:MBAPP_SMOKE_CLEANUP = "1"              # Explicit opt-in (required!)
npm run smokes:cleanup
# WARNING: Actually deletes artifacts from manifest
# If MBAPP_SMOKE_CLEANUP not set: fails with error and exits non-zero
```

### Tenant Rules (Important!)
- **MBAPP_TENANT_ID**: Your normal shell tenant (usually `DemoTenant`)
- **MBAPP_SMOKE_TENANT_ID**: Tenant used by the smoke runner for spawned processes (set to `SmokeTenant` for smokes)
- **MBAPP_SMOKE_ALLOW_TENANT_MISMATCH=1**: Allows DemoTenant JWT with SmokeTenant header (temporary until SmokeTenant JWT available)
- **Smoke runner**: Uses `MBAPP_SMOKE_TENANT_ID` (if set) or falls back to `MBAPP_TENANT_ID` or `"SmokeTenant"`
- **Requested tenant must start with `"SmokeTenant"`** (enforced in run-ci-smokes.mjs unless override)
- **Ergonomic local runs**: Set `MBAPP_SMOKE_TENANT_ID="SmokeTenant"` while keeping `MBAPP_TENANT_ID="DemoTenant"` for other work
- **Tenant mismatch**: If bearer token decodes to `DemoTenant` but you request `SmokeTenant`, set `MBAPP_SMOKE_ALLOW_TENANT_MISMATCH=1` (required until SmokeTenant JWT available)
- **Cleanup gate**: Real deletes require **both** `DRY_RUN=""` (unset) **and** `MBAPP_SMOKE_CLEANUP=1` (explicit opt-in)
- **Cleanup tenant**: Must match the `jwtTenant` recorded in the manifest (usually `DemoTenant`)
- **Future**: Once `SmokeTenant` JWT available, set `MBAPP_BEARER_SMOKE` secret and remove mismatch override

---

## How to Run Smokes

### 1. Normal Local Run (SmokeTenant)

Run the full CI smoke suite with proper environment setup:

```powershell
# Windows (PowerShell) - automatically emits CI env + runs smokes
npm run smokes:run:ci:win

# Or manually set env then run
./ops/ci/Emit-CIEnv.ps1 -ShowToken
npm run smokes:run:ci
```

**What happens:**
- Script reads `ops/ci-smokes.json` to determine which tests to run
- Generates unique `SMOKE_RUN_ID` (e.g., `smk-1766548600885-75q3`)
- Sets `MBAPP_TENANT_ID=SmokeTenant` and `MBAPP_API_BASE` from env
- Acquires JWT bearer token via `ops/ci/Emit-CIEnv.ps1` (sets `MBAPP_BEARER`)
- Runs each smoke test sequentially
- Writes manifest to `ops/smoke/.manifests/<SMOKE_RUN_ID>.json`

**Preflight check:**
Before running tests, smoke runner logs:
```json
{
  "base": "https://...",
  "tenant": "SmokeTenant",
  "smokeRunId": "smk-1766548600885-75q3",
  "tokenVar": "MBAPP_BEARER",
  "hasToken": true,
  "jwtTenant": "DemoTenant"
}
```

### 2. Tenant vs JWT Alignment

**Default Behavior (strict mode):**
- Smoke runner checks: `jwtTenant` (from token payload) **must equal** `MBAPP_TENANT_ID` (request header)
- If mismatch detected, smoke exits with code 2:
  ```
  [smokes] Bearer token tenant ("DemoTenant") does not match requested tenant ("SmokeTenant"). 
  Set MBAPP_SMOKE_ALLOW_TENANT_MISMATCH=1 to override.
  ```

**Override (CI mode or dev testing):**
When you need to allow tenant mismatch (e.g., CI uses DemoTenant JWT but requests SmokeTenant):
```powershell
$env:MBAPP_SMOKE_ALLOW_TENANT_MISMATCH = "1"
npm run smokes:run:ci
```

**SmokeTenant-specific JWT (future):**
To eliminate tenant mismatch entirely, use a SmokeTenant-scoped token:
```powershell
# CI runner will prefer MBAPP_BEARER_SMOKE over default token when tenant starts with "SmokeTenant"
$env:MBAPP_BEARER_SMOKE = "eyJhbG..."  # SmokeTenant-scoped JWT
npm run smokes:run:ci
# No mismatch override needed - jwtTenant will match MBAPP_TENANT_ID
```

**Why this guard exists:**
- Production tokens are scoped to one tenant (enforced by API via canonical `resolveTenantId`)
- Mismatch indicates configuration error or credential misuse
- CI override is safe because AWS env allows `X-Tenant-Id` header overrides for smoke tenant only
- Future: `MBAPP_BEARER_SMOKE` will allow clean tenant alignment without override

### 3. Manifest & SMOKE_RUN_ID

**Auto-generated run ID (default):**
Runner generates unique ID like `smk-1766548600885-75q3` and writes manifest to:
```
ops/smoke/.manifests/smk-1766548600885-75q3.json
```

**Stable run ID (for cleanup):**
Set `SMOKE_RUN_ID` explicitly to ensure consistent manifest naming:
```powershell
$env:SMOKE_RUN_ID = "smk-cleanup-test-001"
npm run smokes:run:ci
# Manifest written to: ops/smoke/.manifests/smk-cleanup-test-001.json
```

**Manifest structure:**
```json
{
  "smokeRunId": "smk-1766548600885-75q3",
  "base": "https://...",
  "tenantHeader": "SmokeTenant",
  "jwtTenant": "DemoTenant",
  "startedAt": "2025-12-24T04:05:05.502Z",
  "finishedAt": "2025-12-24T04:05:07.214Z",
  "entries": [
    {
      "type": "party",
      "id": "v9w295qrsmii0incdtfjzi",
      "route": "/objects/party",
      "meta": { "name": "smk-...-Seed Person", "status": 200 },
      "createdAt": "2025-12-24T04:05:05.817Z"
    },
    { "type": "product", "id": "...", ... },
    { "type": "salesOrder", "id": "...", ... }
  ]
}
```

### 4. Cleanup (DRY_RUN - Safe Preview)

**Always start with DRY_RUN to verify what will be deleted:**

```powershell
# Set required env vars
$env:SMOKE_RUN_ID = "smk-1766548600885-75q3"  # Match your manifest file
$env:MBAPP_API_BASE = "https://ki8kgivz1f.execute-api.us-east-1.amazonaws.com"
$env:MBAPP_TENANT_ID = "DemoTenant"  # MUST match jwtTenant from manifest (or set MBAPP_SMOKE_ALLOW_TENANT_MISMATCH=1)
$env:MBAPP_BEARER = "eyJhbG..."  # Get from Emit-CIEnv.ps1

# Preview deletions (safe - no actual deletes)
$env:DRY_RUN = "1"
npm run smokes:cleanup
```

**Output (DRY_RUN mode):**
```json
{"smokeRunId":"smk-1766548600885-75q3","tenant":"SmokeTenant","manifestEntries":7,"plannedDeletes":7,"plannedSkips":0,"dryRun":true}

--- Planned Deletes (7) ---
{"action":"DELETE","endpoint":"/objects/party/v9w295qrsmii0incdtfjzi","type":"party","id":"v9w295qrsmii0incdtfjzi"}
{"action":"DELETE","endpoint":"/objects/product/4hcbo701b3lac08cg4a4eh","type":"product","id":"4hcbo701b3lac08cg4a4eh"}
{"action":"DELETE","endpoint":"/objects/salesOrder/707921z6l64t7qey76czto","type":"salesOrder","id":"707921z6l64t7qey76czto"}
...

--- Planned Skips (0) ---
```

**Tenant mismatch handling:**
If `jwtTenant` ≠ `tenantHeader` in manifest, cleanup aborts unless:
```powershell
$env:MBAPP_SMOKE_ALLOW_TENANT_MISMATCH = "1"
```

### 5. Cleanup (Real Deletes - Explicit Opt-In)

**⚠️ DESTRUCTIVE: Only run after verifying DRY_RUN output**

```powershell
# Set required env (same as DRY_RUN above)
$env:SMOKE_RUN_ID = "smk-1766548600885-75q3"
$env:MBAPP_API_BASE = "https://..."
$env:MBAPP_TENANT_ID = "DemoTenant"
$env:MBAPP_BEARER = "eyJhbG..."

# ENABLE REAL DELETES (requires both flags)
$env:MBAPP_SMOKE_CLEANUP = "1"   # Explicit opt-in for deletions
Remove-Item Env:\DRY_RUN          # Ensure DRY_RUN is NOT set

npm run smokes:cleanup
```

**Output (real delete mode):**
```json
{"smokeRunId":"smk-1766548600885-75q3","tenant":"SmokeTenant","manifestEntries":7,"plannedDeletes":7,"plannedSkips":0,"dryRun":false}
{"deleted":true,"endpoint":"/objects/party/v9w295qrsmii0incdtfjzi","type":"party","id":"v9w295qrsmii0incdtfjzi","status":204}
{"deleted":true,"endpoint":"/objects/product/4hcbo701b3lac08cg4a4eh","type":"product","id":"4hcbo701b3lac08cg4a4eh","status":204}
...
{"smokeRunId":"smk-1766548600885-75q3","result":"done","deleted":7,"failed":0}
```

**Safety guarantees:**
- Only deletes types in allowlist: `view`, `workspace`, `registration`, `product`, `inventory`, `inventoryItem`, `party`, `partyRole`, `resource`, `reservation`, `salesOrder`, `purchaseOrder`, `backorderRequest`
- Uses single-record DELETE endpoints only (no bulk operations)
- Refuses `/tools/gc/*` endpoints (hard stop)
- Reads manifest to determine exactly what to delete (no wildcards or scans)

### 6. Copy-Paste Commands Summary

```powershell
# ========== Run Smokes ==========
./ops/ci/Emit-CIEnv.ps1 -ShowToken
npm run smokes:run:ci

# ========== Cleanup (DRY_RUN Preview) ==========
$env:SMOKE_RUN_ID = "smk-1766548600885-75q3"
$env:MBAPP_API_BASE = "https://ki8kgivz1f.execute-api.us-east-1.amazonaws.com"
$env:MBAPP_TENANT_ID = "DemoTenant"  # Match jwtTenant
$env:MBAPP_BEARER = "eyJhbG..."
$env:DRY_RUN = "1"
npm run smokes:cleanup

# ========== Cleanup (REAL DELETES) ==========
# Same env as DRY_RUN, plus:
$env:MBAPP_SMOKE_CLEANUP = "1"
Remove-Item Env:\DRY_RUN
npm run smokes:cleanup
```

---

### 7. Special Case: Migration Smoke (Legacy Workspace Retirement)

**Test:** `smoke:migrate-legacy-workspaces:creates-workspace` ([ops/smoke/smoke.mjs](../ops/smoke/smoke.mjs#L13765))

**Purpose:** Validates end-to-end legacy-to-canonical workspace migration (Phase 1 of retirement plan).

**Requirements:**
- AWS credentials (tool invokes DynamoDB scan/put)
- Local run only (CI skips if creds unavailable)

**How to Run:**

```bash
# With AWS credentials in shell environment
node ops/smoke/smoke.mjs smoke:migrate-legacy-workspaces:creates-workspace

# Expected Output (PASS):
# {
#   "test": "smoke:migrate-legacy-workspaces:creates-workspace",
#   "result": "PASS",
#   "summary": "Legacy workspace-shaped view successfully migrated to canonical workspace record",
#   "artifacts": {
#     "legacyViewId": "view-xyz...",
#     "workspaceId": "ws-abc...",
#     "viewName": "LegacyWorkspace-smk-..."
#   },
#   "assertions": {
#     "preFallbackWorked": true,
#     "namePreserved": true,
#     "viewsArrayPreserved": true,
#     "typeIsWorkspace": true,
#     "sharedPreserved": true,
#     "ownerPreserved": true,
#     "entityTypePreserved": true,
#     "descriptionPreserved": true
#   }
# }

# Expected Output (SKIP):
# {
#   "test": "smoke:migrate-legacy-workspaces:creates-workspace",
#   "result": "SKIP",
#   "reason": "AWS credentials not available; cannot run migration tool in CI",
#   "detail": "Run this smoke locally with AWS credentials to test migration",
#   "legacyViewId": "view-xyz..."
# }
```

**What It Tests:**
1. Creates legacy workspace-shaped view (type="view" with name, views[], shared, ownerId, entityType)
2. Verifies GET /workspaces/:id returns it via fallback
3. Runs migration tool: `ops/tools/migrate-legacy-workspaces.mjs --confirm`
4. Verifies GET /workspaces/:id now returns canonical workspace (type="workspace")
5. Asserts all fields preserved (name, views[], type, shared, owner, entityType, description)
6. Records artifacts in manifest for cleanup

**Troubleshooting:**

| Result | Possible Cause | Fix |
|--------|---|---|
| FAIL - create-legacy-view | POST /views blocked or failed | Check `/views` endpoint is live; verify auth token |
| FAIL - pre-migration-fallback-get | Fallback read doesn't work | Verify legacy view was created; check workspace GET fallback logic |
| FAIL - migration-tool-execution | Tool failed | Check tool exit code + stderr; verify `--confirm --confirm-tenant` match |
| FAIL - post-migration-workspace-read | Workspace record not readable | Verify migration tool created workspace; check workspace GET endpoint |
| FAIL - field-preservation | Fields don't match | Compare expected vs actual fields; check copy logic in migration tool |
| SKIP | No AWS credentials | Set `AWS_ACCESS_KEY_ID`, `AWS_SESSION_TOKEN`, or `AWS_PROFILE` env vars |

---

### Cleanup Controls (Reference)


- **Env: `SMOKE_RUN_ID`**: Required. Selects which manifest to use for cleanup.
- **Env: `MBAPP_SMOKE_CLEANUP`**: Required (set to `1`) to perform deletions. Without this, cleanup operates in dry-run mode regardless of `DRY_RUN` setting.
- **Env: `DRY_RUN`**: When `1`, prints planned deletes but does not call DELETE endpoints (safer preview mode).
- **Tenant Guard**: Cleanup reads `tenantHeader` and `jwtTenant` from the manifest. If they mismatch, cleanup aborts unless `MBAPP_SMOKE_ALLOW_TENANT_MISMATCH=1`.
- **Allowlist (strict)**: Only deletes the following types via single-record endpoints:
  - Sprint III: `DELETE /views/{id}`, `DELETE /workspaces/{id}`, `DELETE /registrations/{id}`
  - Objects: `DELETE /objects/{type}/{id}` where type ∈ {`product`, `inventory`, `inventoryItem`, `party`, `partyRole`, `resource`, `reservation`, `salesOrder`, `purchaseOrder`, `backorderRequest`}
- **Hard Stops**:
  - Cleanup refuses any `/tools/gc/*` endpoints.
  - Bulk-delete or non-single endpoints are not used.
  - Types not in allowlist are skipped with reason logged.

### Commands (Reference)

- Run cleanup (dry-run default):
  - `npm run smokes:cleanup`
  - Required env: `SMOKE_RUN_ID`, `MBAPP_API_BASE`, `MBAPP_TENANT_ID`, `MBAPP_BEARER`
- Real deletion (opt-in):
  - `MBAPP_SMOKE_CLEANUP=1 npm run smokes:cleanup` (ensure `DRY_RUN` is NOT set)
- Preview mode:
  - `DRY_RUN=1 npm run smokes:cleanup`

**Close-the-loop flow:** Deterministic vendor/customer seeding → item onhand reset to 0 → SO submit+commit (forces BO) → convert BOs → suggest-po with explicit vendorId → create-from-suggestion → submit + approve → receive with Idempotency-Key (replay validated) → onhand delta >= expected → BOs fulfilled. Runs in CI via [ops/ci-smokes.json](../ops/ci-smokes.json).

**Feature flag testing:** Tests explicitly set feature flag headers (e.g., `X-Feature-Registrations-Enabled: 0`) to ensure deterministic behavior regardless of AWS environment defaults.

---

## 1. Current Smoke Flows

### Health & Core

| Flow | Steps | Assertions | Endpoints |
|------|-------|-----------|----------|
| **smoke:parties:crud** | 1. POST /objects/party (create with kind, name, roles) 2. GET /objects/party/{id} 3. PUT /objects/party/{id} (update name) 4. GET /objects/party/{id} (verify) 5. POST /objects/party/search with retry (eventual consistency) | Create returns 200 + id; both GETs return matching name; update succeeds; search finds party within 5×200ms | `/objects/party`, `/objects/party/{id}`, `/objects/party/search` |
| **smoke:products:crud** | 1. POST /objects/product (sku, name, type, uom, price, preferredVendorId) with Idempotency-Key 2. GET /objects/product/{id} with 5×200ms retry 3. PUT /objects/product/{id} (update name+price) 4. GET /objects/product/{id} (verify) 5. GET /objects/product?q={name} with retry | Create returns 200 + id; get succeeds after eventual consistency; update succeeds; search finds product within 5×200ms | `/objects/product`, `/objects/product/{id}`, `/objects/product?q=...` |
| **smoke:inventory:crud** | 1. POST /objects/inventoryItem (itemId, productId, name) with Idempotency-Key 2. GET /objects/inventoryItem/{id} 3. PUT /objects/inventoryItem/{id} (update name) 4. GET /objects/inventoryItem/{id} (verify) 5. GET /inventory/{id}/onhand (optional, graceful if 404) | Create returns 200 + id; get succeeds; update succeeds; verify updated name; onhand endpoint returns 200 or 404 | `/objects/inventoryItem`, `/objects/inventoryItem/{id}`, `/inventory/{id}/onhand` |

### Health & Core (continued)

| Flow | Steps | Assertions | Endpoints |
|------|-------|-----------|-----------|
| **smoke:ping** | 1. GET /ping | 200 OK, text response | `/ping` |
| **smoke:wipe-tool:safety-guards** | 1. Invoke `ops/tools/wipe-tenant.mjs` with missing `--confirm-tenant` (expect exit 2) 2. Invoke with mismatched `--confirm-tenant` (expect exit 2) 3. Invoke with non-allowlisted tenant (expect exit 2) 4. Invoke in dry-run mode (no `--confirm`, expect exit 0) — **skipped in CI when AWS credentials unavailable** | All 4 safety guards enforce correctly: confirm-tenant match required, allowlist enforced (SmokeTenant/DemoTenant only), dry-run succeeds with no deletes. Dry-run subtest runs only when AWS credentials are present; skipped in CI (which intentionally lacks AWS creds). **Non-destructive**: never performs deletes. | `ops/tools/wipe-tenant.mjs` (CLI tool) |

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
| **smoke:inventory:movements-by-location** | 1. Create 2 locations (locA, locB) 2. Create product + item with onHand=2 3. Putaway qty 1 to locB with lot 4. GET /inventory/movements?locationId=locBId&limit=20 5. Verify all items have locationId===locBId | All returned movements have locationId=locB; putaway movement found with correct action/qty/lot | `/objects/location`, `/inventory/{id}:putaway`, `/inventory/movements?locationId=...` |

### Sales Orders

| Flow | Steps | Assertions | Endpoints |
|------|-------|-----------|-----------|
| **smoke:sales:happy** | 1. Create SO (draft) 2. Submit 3. Commit 4. Reserve L1 5. Fulfill L1(1) 6. Fulfill L1(1)+L2(1) 7. Close | Status flow: draft→submitted→committed→closed; onhand decrements | `/objects/salesOrder`, `/sales/so/{id}:submit`, `:commit`, `:reserve`, `:fulfill`, `:close` |
| **smoke:sales:guards** | 1. Create SO qty 5, onhand 2 2. Submit 3. Reserve 2 4. Try cancel (blocked) 5. Release & cancel 6. Create SO qty 9999, strict:true commit (blocked) | Cancel blocked while reserved; strict commit rejects oversell | `/sales/so/{id}:cancel`, `:release`, `:commit` |
| **smoke:sales:fulfill-with-location** | 1. Create locations A+B 2. Create product+item, receive 5, putaway to locB 3. Create SO qty 2, submit, commit 4. Fulfill with `{ locationId: locBId, lot: \"LOT-SO\" }` 5. Assert fulfill OK, movement has locationId+lot, GET `/inventory/{id}/onhand:by-location` shows locB onHand decreased by 2 | Fulfill with location/lot succeeds; movement recorded; per-location counters accurate | `/objects/location`, `/inventory/{id}:putaway`, `/sales/so/{id}:fulfill`, `/inventory/{id}/onhand:by-location` |
| **smoke:salesOrders:commit-strict-shortage** | 1. Create product+item onHand=0 2. Create SO qty 5 3. Submit 4. Commit strict:true | Commit returns 409 with shortages[]; no backorderRequest created | `/sales/so/{id}:commit`, `/objects/backorderRequest/search` |
| **smoke:salesOrders:commit-nonstrict-backorder** | 1. Create product+item onHand=0 2. Create SO qty 4 3. Submit 4. Commit (strict=false default) 5. Poll backorderRequest | Commit 200 with shortages[]; backorderRequest created (open) | `/sales/so/{id}:commit`, `/objects/backorderRequest/search` |
| **smoke:sales:fulfill-without-reserve** | 1. Create product+item, receive qty 2 2. Create SO qty 2, submit, commit 3. Fulfill directly (skip reserve) 4. Poll inventoryMovement | SO status fulfilled; movement action=fulfill with correct soId/soLineId | `/sales/so/{id}:commit`, `/sales/so/{id}:fulfill`, `/objects/inventoryMovement/search` |
| **smoke:outbound:reserve-fulfill-release-cycle** | 1. Create product+item, receive qty 5 2. Create SO qty 3, submit, commit 3. Reserve qty 3 4. Fulfill qty 2 (partial) 5. Release qty 1 6. Poll movements and counters | 3 movements created (reserve/fulfill/release); counter transitions: +3 reserved, -1 released; fulfill is counter no-op | `/sales/so/{id}:reserve`, `:fulfill`, `:release`, `/objects/inventoryMovement/search`, `/inventory/{id}/onhand:by-location` |

**Outbound Semantics** (Sales Orders):
- **Fulfill** does NOT auto-apply reserved qty server-side; clients default fulfill quantities (reserved qty if present, else remaining qty).
- **Fulfill** is a counter no-op; inventory changes happen on commit (decrement onhand), reserve/release (manage reserved balance).

### Purchase Orders

| Flow | Steps | Assertions | Endpoints |
|------|-------|-----------|-----------|
| **smoke:purchasing:happy** | 1. Create PO (draft) 2. Submit 3. Approve 4. Wait approved status 5. Receive 2 units line P1 6. Receive 1 P1 + 1 P2 7. Close | Status flow: draft→submitted→approved→received→closed; inventory increases | `/objects/purchaseOrder`, `/purchasing/po/{id}:submit`, `:approve`, `:receive`, `:close` |
| **smoke:purchasing:guards** | 1. Create PO 2. Try approve early (blocked) 3. Submit & approve 4. Try receive qty 3 (qty ordered is 2, blocked) 5. Try cancel (blocked) | Approve only after submit; receive qty guard; cancel blocked after approve | `/purchasing/po/{id}:approve`, `:receive`, `:cancel` |
| **smoke:purchasing:suggest-po-skips** | 1. Create backorderRequest qty 0 and another with missing vendor 2. POST /purchasing/suggest-po with both ids | ZERO_QTY and MISSING_VENDOR/NOT_FOUND appear in skipped; drafts (if any) have vendorId | `/objects/backorderRequest`, `/purchasing/suggest-po` |
| **smoke:po:save-from-suggest** | 1. Suggest PO (or hardcode draft) 2. Create from suggestion 3. Get created PO | PO id returned; status is draft | `/purchasing/suggest-po`, `/purchasing/po:create-from-suggestion`, `/objects/purchaseOrder/{id}` |
| **smoke:po:quick-receive** | 1. Create PO, submit, approve 2. Read full lines 3. Receive all outstanding | All lines received; status fulfilled | `/purchasing/po/{id}:receive` |
| **smoke:po:receive-line** | 1. Create product + item 2. Create PO line (qty 3) 3. Submit, approve 4. Receive 2 qty with lot+location 5. Retry over-receive attempt (deltaQty 2 when only 1 remains) with same Idempotency-Key → 409 conflict 6. Retry again with same key → 409 again (failed ops not cached) | Status: draft→submitted→approved→partially-received; over-receive validation returns 409 with RECEIVE_EXCEEDS_REMAINING; failed operations are NOT cached for idempotency | `/purchasing/po/{id}:receive` |
| **smoke:po:receive-line-batch** | 1. Create 2 products + items 2. Create PO 2 lines 3. Submit, approve 4. Receive line BL1 qty 2 + BL2 qty 1 5. Receive BL2 remaining qty 3 | BL1 fully received, BL2 fully received; final PO status transitions to `fulfilled` (not `received`) | `/purchasing/po/{id}:receive` |
| **smoke:po:receive-line-idem-different-key** | 1. Create PO (line qty 3) 2. Submit, approve 3. Receive deltaQty 2 with KEY_A (succeeds) 4. Receive same payload + KEY_B → 409 conflict (over-receive) 5. Finish receive deltaQty 1 with third key → status `fulfilled` | KEY_A succeeds; KEY_B fails over-receive validation (409 with RECEIVE_EXCEEDS_REMAINING); final status `fulfilled`; validates that payload-sig idempotency happens AFTER validation | `/purchasing/po/{id}:receive` |
| **smoke:po:receive-with-location-counters** | 1. Create PO 2 lines 2. Submit, approve 3. Receive with `{ locationId, lot }` 4. Poll movements search 5. Check by-location counters | Movements for `receive` include `poLineId`, `locationId`, `lot`; per-location onHand increments as expected | `/purchasing/po/{id}:receive`, `/objects/inventoryMovement/search`, `/inventory/{id}/onhand:by-location` |
| **smoke:po:receive-line-negative-qty** | 1. Create PO (approved) 2. Attempt `deltaQty=0` and `deltaQty=-1` on a line | API returns 400 (bad request) and includes line reference (e.g., `lineId`) in error details | `/purchasing/po/{id}:receive` |
| **smoke:backorders:partial-fulfill** | 1. Create product+vendor+item onHand=0 2. Create SO qty=10, commit non-strict → backorder created 3. Suggest PO, create, approve 4. Receive only qty=5 (partial) 5. Check backorder status/counters | Backorder status NOT "fulfilled" (should be "converted" or "open"); fulfilledQty=5, remainingQty=5 | `/sales/so/{id}:commit`, `/purchasing/suggest-po`, `/purchasing/po:create-from-suggestion`, `/purchasing/po/{id}:receive`, `/objects/backorderRequest/{id}` |
| **smoke:backorders:ignore** | 1. Create product+vendor+item onHand=0 2. Create SO qty=10, commit non-strict → backorder created 3. Wait for backorder (polling with waitForBackorders helper) 4. POST `:ignore` action 5. GET by ID, assert status=ignored 6. Search open backorders (filter.status=open), assert ID not present 7. Search ignored backorders (filter.status=ignored), assert ID present | Backorder status transitions to "ignored"; removed from open worklist; appears in ignored list; validates status transition + search filtering | `/sales/so/{id}:commit`, `/objects/backorderRequest/{id}:ignore`, `/objects/backorderRequest/{id}`, `/objects/backorderRequest/search` | **✅ CI** |
| **smoke:suggest-po:moq** | 1. Create product with minOrderQty=50 2. Create backorder qty=10 (below MOQ) 3. Call suggest-po 4. Assert draft line qty bumped to 50 | Draft line.qty === 50; line.adjustedFrom === 10 (if tracked); minOrderQtyApplied === 50 (if tracked) | `/purchasing/suggest-po` |

**Receiving UX (Sprint E):**
- Web bulk receive: "Receive All Remaining (Apply Defaults)" builds a multi-line payload and applies order-level defaults (location, lot) to empty fields only; blocks when required defaults are missing.
- Keyboard ergonomics: Enter applies defaults on the defaults inputs; Enter on line inputs can submit receiving.
- Mobile quick receive: Order-level defaults for location/lot are applied to missing fields without overriding line-specific values; per-line modal remains available.

### Feature Flags & Events

| Flow | Steps | Assertions | Endpoints |
|------|-------|-----------|-----------|
| **smoke:po:vendor-guard:on** | 1. Create PO with vendor 2. Clear vendorId, try submit (blocked, VENDOR_REQUIRED) 3. Create PO, set wrong party role, try submit (blocked, VENDOR_ROLE_MISSING) | Vendor required guard works; role check enforced; flag ON | `/purchasing/po/{id}:submit` |
| **smoke:po:vendor-guard:off** | 1. Create PO, submit/approve with header X-Feature-Enforce-Vendor: 0 2. Clear vendorId, submit again 3. Receive | Submit/approve succeed without vendor; flag OFF via header | `/purchasing/po/{id}:submit`, `:approve`, `:receive` |
| **smoke:po:emit-events** | 1. Create PO, submit, approve 2. Receive with header X-Feature-Events-Simulate: 1 3. Check response._dev.emitted === true | Response includes _dev: { emitted: true }; event simulation works | `/purchasing/po/{id}:receive` |

### Pagination & Filtering

| Flow | Steps | Assertions | Endpoints |
|------|-------|-----------|-----------|
| **smoke:objects:list-simple-key-cursor** | 1. Create 5 parties 2. GET /objects/party?limit=2 (page1, 2 items) 3. Decode cursor, assert pk+sk present, no offset field 4. GET page2 with cursor (2 items) 5. GET page3 with cursor 6. Verify no overlap across pages, all unique | Cursor is DynamoDB key format (pk+sk), not offset; pagination works; no duplicates across pages; all page IDs unique | `/objects/party?limit=...` | **Protects:** Simple path (no filters/q) uses efficient key cursors |
| **smoke:objects:list-pagination** | 1. GET /objects/purchaseOrder?limit=2&sort=desc 2. If next cursor, fetch second page | pageInfo or legacy `next` present; cursor works | `/objects/purchaseOrder` |
| **smoke:objects:list-filter-soId** | 1. Create SO with 2 lines, shortage qty 2. Commit to trigger backorder requests 3. GET /objects/backorderRequest?filter.soId={soId}&limit=1 4. If next cursor, fetch page 2 with same filter | All returned items have soId matching filter; pagination respects filter on both pages | `/objects/backorderRequest?filter.soId=...` |
| **smoke:objects:list-filter-itemId** | *(Planned Sprint XXI)* 1. Create SO with backorders 2. GET /objects/backorderRequest?filter.itemId={itemId} | All returned items have itemId matching filter | `/objects/backorderRequest?filter.itemId=...` |
| **smoke:objects:list-filter-status** | *(Planned Sprint XXI)* 1. Create backorder requests with mixed status 2. GET /objects/backorderRequest?filter.status=open 3. GET /objects/backorderRequest?filter.status=ignored | Returned items match status filter | `/objects/backorderRequest?filter.status=...` |
| **smoke:objects:list-filter-soId+itemId** | *(Planned Sprint XXI)* 1. Create SO with 2 backorder lines 2. GET /objects/backorderRequest?filter.soId={soId}&filter.itemId={itemId1} | Only items matching both soId AND itemId returned (AND logic) | `/objects/backorderRequest?filter.soId=...&filter.itemId=...` |
| **smoke:movements:filter-by-poLine** | 1. Create product + item, PO, submit, approve 2. Receive with lot/location 3. GET /inventory/{id}/movements?refId=poId&poLineId=lineId | Movements filtered by refId AND poLineId; lot/location captured | `/inventory/{id}/movements` |

### Objects Contract Invariants (Sprint AM)

| Flow | Steps | Assertions | Endpoints |
|------|-------|-----------|-----------|
| **smoke:objects:inventory-alias-update-delete** | 1. POST /objects/inventory (create) 2. GET /objects/inventoryItem/{id} (canonical) 3. GET /objects/inventory/{id} (alias) 4. PUT /objects/inventoryItem/{id} (update via canonical) 5. Verify update via alias route 6. PUT /objects/inventory/{id} (update via alias) 7. DELETE /objects/inventoryItem/{id} (delete via canonical) 8. Verify 404 via both routes 9. Create second item, DELETE /objects/inventory/{id} (delete via alias) 10. Verify 404 via both routes | Create via alias stores as inventoryItem; GET works via both routes; UPDATE works via both routes; DELETE works via both routes; alias resolution is symmetric | `/objects/inventory`, `/objects/inventoryItem/{id}` |
| **smoke:objects:search-inventory-alias-union** | 1. POST /objects/inventory (create with unique marker) 2. POST /objects/inventory/search (search with q=marker) 3. Verify item found, responseType=inventoryItem | Create via alias stores as inventoryItem; union search query finds item; type normalization consistent | `/objects/inventory`, `/objects/inventory/search` |
| **smoke:objects:update-casing-variants** | 1. Create inventoryItem 2. PUT /objects/inventoryitem/{id} (lowercase, update name) 3. Verify update succeeded 4. PUT /objects/INVENTORYITEM/{id} (uppercase, update name) 5. Verify update succeeded | Type normalization handles lowercase and uppercase variants; updates succeed regardless of casing | `/objects/inventoryitem/{id}`, `/objects/INVENTORYITEM/{id}` |
| **smoke:objects:list-inventory-pagination-alias** | 1. Create 2 inventoryItems 2. GET /objects/inventory?limit=2 (first page) 3. If cursor present, GET page 2 | List via alias route returns items; pagination cursor handling correct; fallback to single-type when cursor present | `/objects/inventory?limit=...` |
| **smoke:objects:create-casing-normalization** | 1. POST /objects/PRODUCT (uppercase, create product) 2. Verify responseType=product (canonical casing) 3. POST /objects/salesorder (lowercase, create SO) 4. Verify responseType=salesOrder (canonical casing) | Type normalization on create; response returns canonical type regardless of input casing | `/objects/PRODUCT`, `/objects/salesorder` |

**Sprint AM Contract Hardening (2026-01-04):**
- **E1 (update.ts canonical type usage):** All type-specific conditionals in PUT handler now use `normalizeTypeParam()` to ensure logic sees canonical type even when alias resolution returns variant form.
- **E2 (permission prefix hardening):** `typeToPermissionPrefix()` refactored to normalize type first, eliminating dual source of truth for type mappings.
- **E3 (union deduplication):** `listObjectsWithAliases()` and `searchObjectsWithAliases()` now deduplicate by id before sorting to protect against data corruption with both `inventory#{id}` and `inventoryItem#{id}` SKs.
- **E4 (comprehensive smoke tests):** 5 new/extended smokes validate: inventory alias CRUD symmetry, SEARCH union queries, UPDATE casing variants, LIST pagination fallback, CREATE casing normalization.
- **Invariants Documented:** [MBapp-Foundations.md § Objects Contract Invariants](MBapp-Foundations.md) codifies type normalization on ingress, canonical SK building, inventory alias behavior, union query constraints, and PUT merge semantics.

| **smoke:objects:pageInfo-present** | 1. GET /objects/purchaseOrder?limit=2 | Response has items array AND (pageInfo OR legacy `next`) | `/objects/purchaseOrder` |
| **smoke:webish:purchaseOrders:list-detail-join** | 1. Create vendor, products, items, and PO draft 2. GET created PO detail (verify type, status, vendorId) 3. List draft POs (first page, 50 items) 4. Pick any PO from list (prefer one with vendorId) 5. GET detail for picked PO 6. GET vendor detail for join validation | Created PO is fetchable; list returns results with pageInfo; listed PO detail fetch succeeds; vendor join succeeds; **No ordering dependency** (does not scan pages to find created PO) | `/objects/purchaseOrder`, `/objects/purchaseOrder/{id}`, `/objects/party/{vendorId}` |

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

**See:** [Module Coverage Matrix](MBapp-Status.md#module-coverage-matrix) in MBapp-Status.md for the canonical, up-to-date module coverage tracking (Spec/Backend/Smokes/UI status for all 16 modules).

**This section focuses on test coverage details** — which specific smoke tests validate each module, and what flows are covered. For overall module implementation status, refer to the canonical matrix.

### Test Coverage Summary by Module

| Module | Key Smoke Tests | Coverage Notes |
|--------|----------------|----------------|
| **Inventory** | onhand, guards, onhand-batch, list-movements, movements-by-location, inventory:crud | CRUD + guards + batch ops + filters (item/location) |
| **Sales Orders** | sales:happy, sales:guards, sales:fulfill-without-reserve, outbound:reserve-fulfill-release-cycle, salesOrders:commit-* | Lifecycle + guardrails + outbound patterns + strict/non-strict shortage |
| **Purchase Orders** | purchasing:happy, purchasing:guards, po:save-from-suggest, po:quick-receive, po:receive-line*, po:receive-with-location-counters | Lifecycle + receipt variants + idempotency + vendor guard + events |
| **Parties** | parties:happy, parties:crud | CRUD lifecycle + search + eventual consistency (in CI) |
| **Products** | products:crud | CRUD lifecycle + search + eventual consistency (in CI) |
| **Registrations** | registrations:crud, registrations:filters | CRUD + filters (eventId, partyId, status); feature-flagged (in CI) |
| **Views** | views:crud | CRUD + list pagination + q/entityType filters + eventual consistency (in CI) |
| **Workspaces** | workspaces:list | List + q/entityType filters + pagination (in CI) |
| **Events** | events:enabled-noop | Event dispatcher flag gating (in CI) |
| **Pagination & Filtering** | objects:list-pagination, objects:list-filter-soId, objects:pageInfo-present, movements:filter-by-poLine | Cursor pagination + query filters |
| **Feature Flags** | po:vendor-guard:on, po:vendor-guard:off, po:emit-events | Header overrides + simulation |

**Gaps:** Routing, Scanner, Audit (spec-defined but not smoke-tested)

---

## 3. Gaps vs. Spec (Sprint IV Scope)

**Sprint IV Delivered** (Registrations v1):
- ✅ registrations:crud — POST → GET → PUT → DELETE lifecycle
- ✅ registrations:filters — Query filters (eventId, partyId, status)
- ✅ Feature flag tested via X-Feature-Registrations-Enabled header

**Sprint XXVIII Delivered** (Views + Workspaces v1):
- ✅ smoke:views:crud — POST/GET/PUT/DELETE views + list pagination + q/entityType filters
- ✅ smoke:workspaces:list — GET /workspaces + q/entityType filters + pagination
- ✅ smoke:events:enabled-noop — Event dispatcher flag gating (noop/simulate modes)

**Critical Gaps (Still Pending)**:
- None for Sprint XXVIII scope (Views/Workspaces v1 complete)

**Out of Scope (Not Expected in Current Tier)**:
- Registration actions (:cancel, :checkin, :checkout) — Tier 2
- Registration payments, capacity rules — Tier 2+
- Backorder workflows (ignore, convert)
- Routing (graph, plan)
- Scanner (sessions, actions, simulate)
- Audit log query
Sprint XXVIII Flows (Views + Workspaces v1)

### smoke:views:crud

**Purpose**: Validate views CRUD operations with pagination and filters.

**CI**: ✅ Yes (in ops/ci-smokes.json)

**Exact Steps** (from ops/smoke/smoke.mjs lines 1424-1558):
1. POST `/views` with `{ name: "SmokeView-{timestamp}", entityType: "inventoryItem", filters: [...], columns: [...] }`
2. Assert 201/200; capture `viewId` from response.id
3. GET `/views?entityType=inventoryItem&q={uniqueName}&limit=100` with retry (up to 5 attempts, 200ms backoff) and pagination (up to 3 pages)
4. Assert created view appears in list within retry window (eventual consistency handling)
5. GET `/views/{viewId}` (single view)
6. Assert 200; body.id === viewId
7. PUT `/views/{viewId}` with updated name + additional filters
8. Assert 200; body.name === updatedName
9. DELETE `/views/{viewId}`
10. Assert 204 or success; verify view NOT in list after delete (3 retry attempts)

**Expected Assertions**:
- ✅ Create returns 200/201 with id + name + entityType + filters + columns
- ✅ List pagination works (q, entityType filters, cursor)
- ✅ List includes created view within 5×200ms retry window
- ✅ Read returns full view object
- ✅ Update persists; name/filters change
- ✅ Delete succeeds; view no longer in list

**Target Endpoints**: `/views`, `/views?q=...&entityType=...&limit=...&next=...`, `/views/{id}`

**Feature Flags**: None (pure RBAC via view:read, view:write)

---

### smoke:workspaces:list

**Purpose**: Validate workspaces list with query filters (q, entityType) and pagination.

**CI**: ✅ Yes (in ops/ci-smokes.json)

**Exact Steps** (from ops/smoke/smoke.mjs lines 1560-1659):
1. POST `/views` (2 temp views: "WS Test A" entityType=purchaseOrder, "WS Sample B" entityType=salesOrder) with header `X-Feature-Views-Enabled: true`
2. Assert both creates return 200/201 with id
3. GET `/workspaces?limit=50` (all workspaces)
4. Assert 200; response.items is array
5. GET `/workspaces?q=Test&limit=50` (name filter)
6. Assert at least one item with "Test" in name
7. GET `/workspaces?entityType=purchaseOrder&limit=50` (entity type filter)
8. Assert all returned items have entityType === "purchaseOrder"
9. DELETE both temp views (cleanup)

**Expected Assertions**:
- ✅ Workspaces list returns items array
- ✅ q filter (substring match on name) works
- ✅ entityType filter (exact match) works
- ✅ Pagination metadata present (next cursor if needed)
- ✅ Items include name, entityType, timestamps

**Target Endpoints**: `/workspaces`, `/workspaces?q=...&entityType=...&limit=...`

**Feature Flags**: `X-Feature-Views-Enabled: true` (dev header override)

**Note**: Sprint III v1 workspaces endpoint is a read-only wrapper around views (queries type="view" and filters in-memory).

---

### smoke:events:enabled-noop

**Purpose**: Validate event dispatcher flag gating (noop vs. simulate modes).

**CI**: ✅ Yes (in ops/ci-smokes.json)

**Exact Steps** (from ops/smoke/smoke.mjs lines 1659+):
1. Create PO (draft) with vendorId and line items
2. POST `/purchasing/po/{id}:submit`
3. POST `/purchasing/po/{id}:approve` → wait for status=approved
4. POST `/purchasing/po/{id}:receive` with headers:
   - `Future Flows (Deferred)abled: true`
   - `X-Feature-Events-Simulate: true`
5. Assert 200; response._dev.emitted === true (simulation signal)
6. Repeat receive with `X-Feature-Events-Enabled: false` (flag OFF)
7. Assert 200; dispatcher is noop regardless (no _dev metadata or always noop)
8. Repeat receive with both flags ON
9. Assert 200; response._dev.emitted === true (simulate path active)

**Expected Assertions**:
- ✅ With events enabled=OFF: dispatch is noop, no _dev.emitted
- ✅ With events enabled=ON, simulate=OFF: dispatch is noop (stub), no _dev.emitted
- ✅ With events enabled=ON, simulate=ON: response._dev.emitted === true
- ✅ PO status updates correctly in all cases (events don't block actions)

**Target Endpoints**: `/purchasing/po/{id}:receive`

**Feature Flags**:
- `X-Feature-Events-Enabled: true` (env: FEATURE_EVENT_DISPATCH_ENABLED)
- `X-Feature-Events-Simulate: true` (env: FEATURE_EVENT_DISPATCH_SIMULATE)

**Note**: Events are noop in Sprint XXVIII; dispatchEvent() returns stub. Simulation mode adds _dev.emitted signal for testing flag logic.

---

## 4. ARCHIVED: Proposed New Flows (Sprint III) — IMPLEMENTED

**Note:** The flows below were proposed in Sprint III and have since been **implemented and added to CI**. This section is preserved for historical reference only. See [ops/ci-smokes.json](../ops/ci-smokes.json) for the current CI smoke manifest.

<details>
<summary>Click to expand archived Sprint III proposals</summary>

### smoke:views:crud (IMPLEMENTED ✅)

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

**ExacRunning Smoke Test
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
- ✅7. Known Limitationnts enabled=ON, simulate=ON: response includes _dev.emitted === true
- ✅ Simulation path overrides both flags; always signals "emitted"
- ✅ PO status updated correctly in all cases (events don't block receipt)

**Target Endpoints**: `/purchasing/po/{id}:receive`

**Feature Flags**:
- `X-Feature-Events-Enabled: 1` (env: FEATURE_EVENT_DISPATCH_ENABLED)
- `X-Feature-Events-Simulate: 1` (env: FEATURE_EVENT_DISPATCH_SIMULATE)

</details>

---

## 5. Running Smoke Tests

### Prerequisites

```bash
# Required: AWS API Gateway endpoint (no localhost fallback)
export MBAPP_API_BASE="https://ki8kgivz1f.execute-api.us-east-1.amazonaws.com"
export MBAPP_TENANT_ID="DemoTenant"

# Required: Valid bearer token (smokes fail fast if missing; no dev-login fallback)
export MBAPP_BEARER="<your-token>"

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
- **List/index reads may lag**: DynamoDB GSI projections and list endpoints (e.g., `GET /inventory/movements?locationId=X`) may not immediately reflect recently created items due to eventual consistency
- **Smokes poll before failing**: Tests that query list/index endpoints retry for up to 10 seconds with exponential backoff (200ms → 1000ms) before reporting failure
- **Avoid assuming immediate list visibility**: After creating an item, prefer querying by primary key (e.g., `GET /inventory/{id}/movements`) for immediate read-your-writes consistency; list queries may require polling

---

## 7. References

- **Smoke Test File**: [ops/smoke/smoke.mjs](ops/smoke/smoke.mjs) (2508 lines, 25+ flows)
- **Smoke Seeds**: [ops/smoke/seed/](ops/smoke/seed/) (routing.ts, parties.ts, vendor seeding)
- **Feature Flags Docs**: [docs/flags-and-events.md](flags-and-events.md)
- **Spec**: [spec/MBapp-Modules.yaml](../spec/MBapp-Modules.yaml)
- **CORS/Feature Headers**: [apps/api/src/index.ts](../apps/api/src/index.ts) line ~103
- **CI Smokes Config**: [ops/ci-smokes.json](../ops/ci-smokes.json)
- **CI Runner**: [ops/tools/run-ci-smokes.mjs](../ops/tools/run-ci-smokes.mjs)
