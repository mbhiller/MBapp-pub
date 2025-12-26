# Smoke Test Coverage (Sprint IV)

## Overview

Smoke tests are integration tests for critical API flows. All tests use idempotency keys for safe retry and include party/vendor seeding. Run with `node ops/smoke/smoke.mjs <test-name>`.

- Default tenant: any tenant starting with **SmokeTenant** (e.g., SmokeTenant, SmokeTenant-qa). Override only by setting `MBAPP_SMOKE_ALLOW_NON_SMOKE_TENANT=1` (dangerous).
- `SMOKE_RUN_ID` is emitted in the preflight log; set `SMOKE_RUN_ID` explicitly to tag runs or let the runner generate one.
  - The runner records a manifest per run in `ops/smoke/.manifests/<SMOKE_RUN_ID>.json` capturing created entities (type, id, route, meta).
  - Use the cleanup script to delete only artifacts from a specific `SMOKE_RUN_ID` via allowlisted single-delete endpoints.

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

### Local-Friendly Run (Current Tenant)
Run a single smoke flow using your currently logged-in tenant (no SmokeTenant guard). Pass the flow name after `--`.

```powershell
# Example: run inventory CRUD against current tenant
npm run smokes:run -- smoke:inventory:crud

# Or any other flow:
npm run smokes:run -- smoke:views:crud
npm run smokes:run -- smoke:workspaces:list
```

Notes:
- This path uses whatever is in `MBAPP_TENANT_ID` and your current bearer.
- If your bearer decodes to a different tenant than `MBAPP_TENANT_ID`, you must explicitly opt in:
  - Set `MBAPP_SMOKE_ALLOW_TENANT_MISMATCH=1` to allow running with mismatched token/header.
- Prefer `smokes:run:ci` for strict `SmokeTenant` runs; it enforces tenant alignment and fails fast if a `SmokeTenant` JWT is not supplied.

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

**Close-the-loop flow:** SO shortage → BO open (with preferredVendorId derived from product) → suggest-po (returns drafts with vendorId) → save draft PO → receive → onhand increases → BO fulfilled → idempotency replay (no double-apply). Vendor party is seeded at flow start; product.preferredVendorId set so so:commit populates backorderRequest.preferredVendorId and suggest-po avoids MISSING_VENDOR errors.

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
| **smoke:objects:list-filter-soId** | 1. Create SO with 2 lines, shortage qty 2. Commit to trigger backorder requests 3. GET /objects/backorderRequest?filter.soId={soId}&limit=1 4. If next cursor, fetch page 2 with same filter | All returned items have soId matching filter; pagination respects filter on both pages | `/objects/backorderRequest?filter.soId=...` |
| **smoke:objects:list-filter-itemId** | *(Planned Sprint XXI)* 1. Create SO with backorders 2. GET /objects/backorderRequest?filter.itemId={itemId} | All returned items have itemId matching filter | `/objects/backorderRequest?filter.itemId=...` |
| **smoke:objects:list-filter-status** | *(Planned Sprint XXI)* 1. Create backorder requests with mixed status 2. GET /objects/backorderRequest?filter.status=open 3. GET /objects/backorderRequest?filter.status=ignored | Returned items match status filter | `/objects/backorderRequest?filter.status=...` |
| **smoke:objects:list-filter-soId+itemId** | *(Planned Sprint XXI)* 1. Create SO with 2 backorder lines 2. GET /objects/backorderRequest?filter.soId={soId}&filter.itemId={itemId1} | Only items matching both soId AND itemId returned (AND logic) | `/objects/backorderRequest?filter.soId=...&filter.itemId=...` |
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
| **Inventory** | onhand, guards, onhand-batch, list-movements, movements-by-location, inventory:crud | ✅ Complete | CRUD + guards + batch ops + item-based filter + location-based filter + Sprint XXVII CRUD smoke (in CI) |
| **Sales Orders** | sales:happy, sales:guards, salesOrders:commit-strict-shortage (CI), salesOrders:commit-nonstrict-backorder (CI) | ✅ Complete | Lifecycle + guardrails; strict shortage returns 409; non-strict shortage creates backorder (CI-covered) |
| **Purchase Orders** | purchasing:happy, purchasing:guards, po:save-from-suggest, po:quick-receive, po:receive-line*, po:receive-line-batch, po:receive-line-idem-* | ✅ Complete | Lifecycle, receipt variants, idempotency, vendor guard, events |
| **Parties** | parties:happy, parties:crud | ✅ Complete | CRUD lifecycle + search with idempotency + eventual consistency retry (in CI) |
| **Products** | products:crud | ✅ Complete (Sprint XXVII) | CRUD lifecycle + search with idempotency + eventual consistency retry (in CI) |
| **Pagination & Filtering** | objects:list-pagination, objects:list-filter-soId, objects:pageInfo-present, movements:filter-by-poLine | ✅ Complete | Cursor pagination, query param filters (filter.*) |
| **Feature Flags** | po:vendor-guard:on, po:vendor-guard:off, po:emit-events | ✅ Complete | Header overrides, simulation |
| **EPC** | epc:resolve | ✅ Complete | 404 case only |
| **Registrations** | registrations:crud, registrations:filters | ✅ Complete (Sprint IV) | CRUD lifecycle + filters (eventId, partyId, status); feature-flagged (default OFF) |
| **Views** | views:crud | ✅ Complete (Sprint XXVIII) | CRUD lifecycle + list pagination + q/entityType filters + eventual consistency retry (in CI) |
| **Workspaces** | workspaces:list | ✅ Complete (Sprint XXVIII) | List + q/entityType filters + pagination (read-only v1) |
| **Events** | events:enabled-noop | ✅ Complete (Sprint XXVIII) | Event dispatcher noop/simulate flag gating (in CI) |
| **Backorders** | objects:list-filter-soId, objects:list-filter-itemId (planned), objects:list-filter-status (planned), objects:list-filter-soId+itemId (planned) | ✅ Partial (Sprint XX); 🔄 Planned (Sprint XXI) | soId + pagination working (Sprint XX); itemId, status, combo filters planned (Sprint XXI) |
| **Routing** | ❌ None | ⚠️ Gap | Spec defines /routing/graph, /routing/plan (deprecated in Sprint III?) — not tested |
| **Scanner** | ❌ None | ⚠️ Gap | Spec defines sessions, actions, simulate — not tested |
| **Audit** | ❌ None | ⚠️ Gap | Spec defines /admin/audit — not tested |

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

## 5. 
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

---

## 8. References
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

---

## 8. References

- **Smoke Test File**: [ops/smoke/smoke.mjs](ops/smoke/smoke.mjs) (2508 lines, 25+ flows)
- **Smoke Seeds**: [ops/smoke/seed/](ops/smoke/seed/) (routing.ts, parties.ts, vendor seeding)
- **Feature Flags Docs**: [docs/flags-and-events.md](flags-and-events.md)
- **Spec**: [spec/MBapp-Modules.yaml](../spec/MBapp-Modules.yaml)
- **CORS/Feature Headers**: [apps/api/src/index.ts](../apps/api/src/index.ts) line ~103
- **CI Smokes Config**: [ops/ci-smokes.json](../ops/ci-smokes.json)
- **CI Runner**: [ops/tools/run-ci-smokes.mjs](../ops/tools/run-ci-smokes.mjs)

---

**Last Updated**: Dec 23, 2025 (Sprint XXVIII)  
**Status**: 25 test flows implemented (includes Views/Workspaces v1 + Events noop testing)
