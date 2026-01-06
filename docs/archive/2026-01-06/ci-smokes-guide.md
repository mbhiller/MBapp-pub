# CI Smokes Guide

## Overview

CI smokes are automated test flows that verify core business functionality across the MBapp system. They run on every PR/push (core tier) and nightly (all tiers) to catch regressions before they reach production.

**How they work:**
1. Runner (`ops/tools/run-ci-smokes.mjs`) reads the smoke registry and filters by tier
2. For each smoke, spawns child process running `ops/smoke/smoke.mjs smoke:<module>:<test>`
3. Waits for exit code 0 (pass) or non-zero (fail)
4. On failure: prints summary with rerun command + manifest location, then exits
5. On success: collects timing data and prints slowest smokes summary

## Tier System

MBapp smokes are organized in tiers by criticality and execution time:

| Tier | Flows | Runtime | When | Command |
|------|-------|---------|------|---------|
| **core** | 42 | ~2–3 min | Every PR/push (GH Actions) | `npm run smokes:run:core` |
| **extended** | 24 | ~2–3 min | Nightly schedule (2 AM UTC) | `npm run smokes:run:extended` |
| **all** | 66 | ~5–6 min | Nightly schedule (complete) | `npm run smokes:run:ci` |

### Core Flows (42)
Foundation + critical domain workflows:
- **Auth & Objects** (7 flows): Permission derivation, case normalization, alias handling, object CRUD
- **Wipe-tool** (1 flow): Safety guards (allowlist enforcement, dry-run validation)
- **Line ID** (1 flow): Canonical ID format enforcement
- **Sales Orders** (8 flows): Draft → submit → commit lifecycle with strict/non-strict shortage handling
- **Purchase Orders** (5 flows): Draft → create/edit/receive with location counters
- **Inventory** (5 flows): On-hand by location, adjustments, movements
- **Sales Fulfillment** (4 flows): Reserve → commit → fulfill with location tracking
- **Backorders** (3 flows): Partial fulfill, ignore logic
- **Suggestions & Filtering** (3 flows): PO suggestions, vendor filtering

### Extended Flows (24)
Advanced scenarios, permission tests, views, workspaces:
- Permission-scoped operations (inventory read, warehouse receive/deny)
- View management (create, filter, pagination, apply to lists)
- Workspace operations (deduplication, fallback, permissions)
- EPC resolution, scanner actions, event handling
- Fulfillment idempotency, suggest-po skip reasons

### All Flows (66)
Core (42) + Extended (24) combined for complete nightly validation.

## Running Smokes Locally

### Recommended: Run by Tier

```bash
# Core flows only (2–3 min, safe for frequent local testing)
npm run smokes:run:core

# Extended flows (additional 2–3 min)
npm run smokes:run:extended

# All flows (5–6 min, full nightly equivalent)
npm run smokes:run:ci
```

### Run a Single Smoke

```bash
# Run one specific smoke (e.g., party CRUD)
node ops/smoke/smoke.mjs smoke:parties:crud

# Run a nested smoke (e.g., type casing)
node ops/smoke/smoke.mjs smoke:objects:type-casing-and-alias

# Run a vendor filtering test
node ops/smoke/smoke.mjs smoke:vendor-filter-preferred
```

### Check Available Smokes

All registered smokes are listed in `ops/ci-smokes.json` under the `flows` array.

## Manifests: Debug Output

Every smoke run creates a **manifest JSON file** with detailed execution history:

**Location:** `ops/smoke/.manifests/{SMOKE_RUN_ID}.json`

- Unique `SMOKE_RUN_ID` generated per run: `smk-{timestamp}-{random}`
- Printed at **start of run**: `[ci-smokes] Manifest path: ops/smoke/.manifests/smk-XXXX.json`
- Contains:
  - Which data types (party, product, inventory, etc.) were created
  - Entry count for debugging cleanup
  - Final manifest summary

**Use case:** If a smoke fails with unexpected state, check the manifest to see what was created and needs cleanup.

## Debugging Failed Smokes

### 1. Identify the Failing Smoke
Check the CI logs or local run output. The runner prints:
```
[ci-smokes] → node ops/smoke/smoke.mjs smoke:workspaces:list
```

### 2. Read the Failure Summary
When a smoke fails, the runner prints:
```
[ci-smokes] ✘ SMOKE FAILED
  name: smoke:workspaces:list
  exit code: 1

  Rerun this smoke:
    node ops/smoke/smoke.mjs smoke:workspaces:list

  Manifest (debug details):
    ops/smoke/.manifests/smk-XXXX.json

  Rerun all core smokes:
    npm run smokes:run:core        (42 core foundational flows)
    npm run smokes:run:extended    (24 extended scenario flows)
    npm run smokes:run:ci          (all 66 flows)
```

### 3. Rerun the Specific Smoke
```bash
node ops/smoke/smoke.mjs smoke:workspaces:list
```

- Run locally with your bearer token env var: `MBAPP_BEARER`
- Will create its own manifest in `ops/smoke/.manifests/`
- Check stdout for assertion failures or API errors
- Manifest shows what state was created for manual cleanup if needed

### 4. Use the Manifest for Cleanup
If a smoke fails mid-execution and leaves dirty state:
1. Find the manifest file path printed at run start or in failure block
2. Open `ops/smoke/.manifests/smk-XXXX.json`
3. See what was created: `"types": ["party", "product", "inventoryItem", ...]`
4. Clean up manually via API or direct DB access as needed

### 5. Rerun the Tier (Optional)
If the single smoke passes but you suspect tier-level interference:
```bash
npm run smokes:run:core        # Core flows
npm run smokes:run:extended    # Extended flows
npm run smokes:run:ci          # All 66 flows
```

## Observability: Timing & Performance

As of Sprint AR, the runner collects **per-smoke wall-clock timing** and reports slowest smokes:

### Output on Success
At the end of a successful run, JSON summary prints:
```json
{
  "summary": {
    "totalFlows": 42,
    "totalElapsedMs": 79315,
    "totalElapsedSec": "79.31",
    "tier": "core"
  },
  "slowest": [
    {"rank": 1, "name": "smoke:close-the-loop", "tier": "core", "elapsedMs": 4261, "elapsedSec": "4.26"},
    {"rank": 2, "name": "smoke:objects:type-casing-and-alias", "tier": "core", "elapsedMs": 3285, "elapsedSec": "3.29"},
    ...top 10...
  ]
}
```

**What this tells you:**
- Total runtime for the tier
- Which smokes are slowest (may need optimization or API calls)
- Individual smoke elapsed time in milliseconds and seconds

### Interpreting Performance
- **Slowest smokes** (>3 sec) often involve multi-step workflows (reserve → fulfill) or high cardinality tests
- **Fast smokes** (<1 sec) typically test single endpoints or simple state transitions
- If slowest list changes significantly, may indicate API degradation or new test data setup

### Output on Failure
Failure block prints **before exit**, so you get the rerun command without scrolling through successful outputs:
```
[ci-smokes] ✘ SMOKE FAILED
  name: smoke:workspaces:list
  exit code: 1
  
  Rerun this smoke:
    node ops/smoke/smoke.mjs smoke:workspaces:list
  ...
```

## Common Issues & Solutions

| Issue | Check | Fix |
|-------|-------|-----|
| `smoke:workspaces:*` fails in CI | Workspace creation may be flaky | Run locally; check API state |
| `Auth` smoke fails | Bearer token expired or wrong tenant | Verify `MBAPP_BEARER` env var |
| Manifest not found | Runner exited before printing path | Check logs for pre-flight errors |
| Smoke passes locally, fails in CI | Timing/concurrency issue | Check if other tenants interfering |
| All smokes pass, one fails on second run | State pollution from first run | Manifests should auto-cleanup; verify |

## Environment Variables

Key variables used by the runner and smokes:

- `SMOKE_TIER`: `core`, `extended`, or `all` (set by npm scripts)
- `SMOKE_RUN_ID`: Unique run identifier (auto-generated, can override)
- `MBAPP_TENANT_ID`: Smoke tenant (defaults to `SmokeTenant`)
- `MBAPP_BEARER` or `MBAPP_BEARER_SMOKE`: Auth token
- `MBAPP_API_BASE`: API endpoint (defaults to AWS API Gateway URL)
- `DEV_API_TOKEN`: Fallback token for smoke acquisition

## Files & Paths

| File | Purpose |
|------|---------|
| `ops/tools/run-ci-smokes.mjs` | Runner: orchestrates smoke execution by tier |
| `ops/smoke/smoke.mjs` | Smoke executor: runs individual test flows |
| `ops/ci-smokes.json` | Registry: lists all 66 flows with tier metadata |
| `ops/smoke/.manifests/{SMOKE_RUN_ID}.json` | Debug output: created types, entry count |
| `.github/workflows/ci.yaml` | CI definition: when smokes run (PR/push/nightly) |

## References

- **Smoke Coverage:** [docs/smoke-coverage.md](smoke-coverage.md) – per-smoke descriptions and CI behavior notes
- **Status:** [docs/MBapp-Status.md](MBapp-Status.md) – sprint tracking and recent changes
- **CI Workflow:** `.github/workflows/ci.yaml` – GitHub Actions job definitions
