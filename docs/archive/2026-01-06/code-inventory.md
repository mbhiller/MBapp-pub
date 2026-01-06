# MBapp Code Inventory (Dec 2025)

READ-ONLY repository scan for architecture, routes, entities, flags, smokes, and build tooling.

---

## 1. Repository Structure

| Folder | Purpose |
|:-------|:--------|
| **apps/** | Monorepo workspaces: API (Lambda Node.js), Mobile (Expo React Native), Web (Vite React) |
| **spec/** | OpenAPI contract (MBapp-Modules.yaml) + generated types |
| **ops/** | Operations: smoke tests, deploy scripts (PowerShell), seed data |
| **infra/** | Terraform configs (Lambda, DynamoDB, EventBridge); build scripts |
| **docs/** | Markdown: roadmap, principles, working notes, sprint plans, architecture |
| **tools/** | Dev utilities: GC scripts, roadmap builder |
| **node_modules/** | Dependencies (pnpm workspaces) |

---

## 2. API Route Matrix

**Base:** `apps/api/src/` | **Handler Pattern:** `async (event: APIGatewayProxyEventV2)`

### Auth & Health
| Path | Method | Handler | Permission |
|:-----|:-------|:--------|:-----------|
| `/` or `/health` | GET | inline | none (public) |
| `/auth/dev-login` | POST | [auth/dev-login.ts](../apps/api/src/auth/dev-login.ts) | none (gated by DEV_LOGIN_ENABLED) |
| `/auth/policy` | GET | inline | authenticated |

### Views & Workspaces
| Path | Method | Handler | Permission |
|:-----|:-------|:--------|:-----------|
| `/views` | GET | [views/list.ts](../apps/api/src/views/list.ts) | view:read |
| `/workspaces` | GET | [workspaces/list.ts](../apps/api/src/workspaces/list.ts) | workspace:read |

### Objects (Generic CRUD)
| Path | Method | Handler | Permission |
|:-----|:-------|:--------|:-----------|
| `/objects/:type` | GET | [objects/list.ts](../apps/api/src/objects/list.ts) | `{type}:read` |
| `/objects/:type` | POST | [objects/create.ts](../apps/api/src/objects/create.ts) | `{type}:write` |
| `/objects/:type/:id` | GET | [objects/get.ts](../apps/api/src/objects/get.ts) | `{type}:read` |
| `/objects/:type/:id` | PUT | [objects/update.ts](../apps/api/src/objects/update.ts) | `{type}:write` |
| `/objects/:type/:id` | DELETE | [objects/delete.ts](../apps/api/src/objects/delete.ts) | `{type}:write` |
| `/objects/:type/search` | POST | [objects/search.ts](../apps/api/src/objects/search.ts) | `{type}:read` |

### Inventory (Computed)
| Path | Method | Handler | Permission |
|:-----|:-------|:--------|:-----------|
| `/inventory/:id/onhand` | GET | [inventory/onhand-get.ts](../apps/api/src/inventory/onhand-get.ts) | inventory:read |
| `/inventory/onhand:batch` | POST | [inventory/onhand-batch.ts](../apps/api/src/inventory/onhand-batch.ts) | inventory:read |
| `/inventory/:id/movements` | GET | [inventory/movements.ts](../apps/api/src/inventory/movements.ts) | inventory:read |
| `/inventory/search` | POST | [inventory/search.ts](../apps/api/src/inventory/search.ts) | inventory:read |

### Sales Orders (Actions)
| Path | Method | Handler | Permission |
|:-----|:-------|:--------|:-----------|
| `/sales/so/:id:submit` | POST | [sales/so-submit.ts](../apps/api/src/sales/so-submit.ts) | sales:write |
| `/sales/so/:id:commit` | POST | [sales/so-commit.ts](../apps/api/src/sales/so-commit.ts) | sales:commit |
| `/sales/so/:id:reserve` | POST | [sales/so-reserve.ts](../apps/api/src/sales/so-reserve.ts) | sales:reserve |
| `/sales/so/:id:release` | POST | [sales/so-release.ts](../apps/api/src/sales/so-release.ts) | sales:reserve |
| `/sales/so/:id:fulfill` | POST | [sales/so-fulfill.ts](../apps/api/src/sales/so-fulfill.ts) | sales:fulfill |
| `/sales/so/:id:cancel` | POST | [sales/so-cancel.ts](../apps/api/src/sales/so-cancel.ts) | sales:cancel |
| `/sales/so/:id:close` | POST | [sales/so-close.ts](../apps/api/src/sales/so-close.ts) | sales:close |

### Purchase Orders (Actions)
| Path | Method | Handler | Permission |
|:-----|:-------|:--------|:-----------|
| `/purchasing/po/:id:submit` | POST | [purchasing/po-submit.ts](../apps/api/src/purchasing/po-submit.ts) | purchase:write |
| `/purchasing/po/:id:approve` | POST | [purchasing/po-approve.ts](../apps/api/src/purchasing/po-approve.ts) | purchase:approve |
| `/purchasing/po/:id:receive` | POST | [purchasing/po-receive.ts](../apps/api/src/purchasing/po-receive.ts) | purchase:receive |
| `/purchasing/po/:id:cancel` | POST | [purchasing/po-cancel.ts](../apps/api/src/purchasing/po-cancel.ts) | purchase:cancel |
| `/purchasing/po/:id:close` | POST | [purchasing/po-close.ts](../apps/api/src/purchasing/po-close.ts) | purchase:close |
| `/purchasing/suggest-po` | POST | [purchasing/suggest-po.ts](../apps/api/src/purchasing/suggest-po.ts) | purchase:write |
| `/purchasing/po:create-from-suggestion` | POST | [purchasing/po-create-from-suggestion.ts](../apps/api/src/purchasing/po-create-from-suggestion.ts) | purchase:write |

### Backorders (Actions)
| Path | Method | Handler | Permission |
|:-----|:-------|:--------|:-----------|
| `/objects/backorderRequest/:id:ignore` | POST | [backorders/request-ignore.ts](../apps/api/src/backorders/request-ignore.ts) | objects:write |
| `/objects/backorderRequest/:id:convert` | POST | [backorders/request-convert.ts](../apps/api/src/backorders/request-convert.ts) | objects:write |

### Routing & Delivery
| Path | Method | Handler | Permission |
|:-----|:-------|:--------|:-----------|
| `/routing/graph` | POST | [routing/graph-upsert.ts](../apps/api/src/routing/graph-upsert.ts) | routing:write |
| `/routing/plan` | POST | [routing/plan-create.ts](../apps/api/src/routing/plan-create.ts) | routing:write |
| `/routing/plan/:id` | GET | [routing/plan-get.ts](../apps/api/src/routing/plan-get.ts) | routing:read |

### Scanner & EPC
| Path | Method | Handler | Permission |
|:-----|:-------|:--------|:-----------|
| `/scanner/sessions` | POST | [scanner/sessions.ts](../apps/api/src/scanner/sessions.ts) | scanner:use |
| `/scanner/actions` | POST | [scanner/actions.ts](../apps/api/src/scanner/actions.ts) | scanner:use |
| `/scanner/simulate` | POST | [scanner/simulate.ts](../apps/api/src/scanner/simulate.ts) | admin:seed |
| `/epc/resolve` | GET | [epc/resolve.ts](../apps/api/src/epc/resolve.ts) | inventory:read |

### Admin Tools (GC / Reset)
| Path | Method | Handler | Permission |
|:-----|:-------|:--------|:-----------|
| `/tools/gc/:type` | GET | [tools/gc-list-type.ts](../apps/api/src/tools/gc-list-type.ts) | admin:reset |
| `/tools/gc/:type` | DELETE | [tools/gc-delete-type.ts](../apps/api/src/tools/gc-delete-type.ts) | admin:reset |
| `/tools/gc/list-all` | GET | [tools/gc-list-all.ts](../apps/api/src/tools/gc-list-all.ts) | admin:reset |
| `/tools/gc/delete-keys` | POST | [tools/gc-delete-keys.ts](../apps/api/src/tools/gc-delete-keys.ts) | admin:reset |

---

## 3. Data Entities & Models

### Core Business Objects (Generic type="...")
Stored in DynamoDB `tableObjects`; schema in [spec/MBapp-Modules.yaml](../spec/MBapp-Modules.yaml).

| Type | Location | Fields Summary |
|:-----|:---------|:----------------|
| `party` | [parties/](../apps/api/src/parties/) | id, kind (person\|organization\|animal), name, roles[], email, phones, addresses |
| `product` | [products/](../apps/api/src/products/) | id, kind, name, sku, productId, reorderEnabled, preferredVendorId, minOrderQty, leadTimeDays |
| `inventory` | [inventory/](../apps/api/src/inventory/) | id, productId, name, uom (ea/lb/gal/etc), warehouseLocation |
| `salesOrder` | [sales/](../apps/api/src/sales/) | id, status, orderNumber, customerId, lines[], date |
| `purchaseOrder` | [purchasing/](../apps/api/src/purchasing/) | id, status, orderNumber, vendorId, lines[], date |
| `backorderRequest` | [backorders/](../apps/api/src/backorders/) | id, soId, soLineId, itemId, qty, status (open\|ignored\|converted) |
| `view` | [views/](../apps/api/src/views/) | id, type (name="view"), module, filters[], sort, columns[] |
| `workspace` | [workspaces/](../apps/api/src/workspaces/) | id, type (name="workspace"), tiles[] (viewId refs) |
| `inventoryMovement` | [inventory/](../apps/api/src/inventory/) | id, type (name="inventoryMovement"), itemId, refId (PO/SO), poLineId?, action (receive\|reserve\|...), qty, lot?, locationId? |

### Computed / In-Memory Models
| Name | File | Fields |
|:-----|:-----|:-------|
| `OrderLine` | [shared/db.ts](../apps/api/src/shared/db.ts) | id, itemId, productId?, qty, qtyReserved?, qtyCommitted?, qtyFulfilled?, qtyReceived?, uom, unitPrice |
| `InvCounter` | [shared/db.ts](../apps/api/src/shared/db.ts) | pk, sk, tenantId, type="inventoryCounter", itemId, onHand, reserved, available |
| `Ctx` | [shared/ctx.ts](../apps/api/src/shared/ctx.ts) | userId, tenantId, roles[], policy, idempotencyKey, requestId |

---

## 4. Feature Flags & Environment Variables

**File:** [apps/api/src/flags.ts](../apps/api/src/flags.ts)

All flags use `withFlag(envName, headerName, default)` pattern:
- **PROD:** env-only (ignore headers)
- **DEV/CI:** header overrides env

| Flag Name | Env Var | Header | Default | Purpose |
|:-----------|:--------|:-------|:--------|:--------|
| `featureVendorGuardEnabled` | `FEATURE_ENFORCE_VENDOR_ROLE` | `X-Feature-Enforce-Vendor` | `true` | Vendor role validation on PO submit/approve |
| `featureEventsEnabled` | `FEATURE_EVENT_DISPATCH_ENABLED` | `X-Feature-Events-Enabled` | `false` | Enable event dispatcher (PO receive, etc.) |
| `featureEventsSimulate` | `FEATURE_EVENT_DISPATCH_SIMULATE` | `X-Feature-Events-Simulate` | `false` | Simulate/log events locally (vs. publish) |

### Other Environment Variables
| Name | Read In | Default | Purpose |
|:-----|:---------|:--------|:--------|
| `APP_ENV` / `NODE_ENV` | [flags.ts](../apps/api/src/flags.ts) | "dev" | Determines IS_PROD; controls flag behavior |
| `MBAPP_TABLE_PK` | [shared/db.ts](../apps/api/src/shared/db.ts) | "pk" | DynamoDB partition key name |
| `MBAPP_TABLE_SK` | [shared/db.ts](../apps/api/src/shared/db.ts) | "sk" | DynamoDB sort key name |
| `MBAPP_DEBUG` | [sales/so-reserve.ts](../apps/api/src/sales/so-reserve.ts), [so-commit.ts](../apps/api/src/sales/so-commit.ts), [so-fulfill.ts](../apps/api/src/sales/so-fulfill.ts) | (unset) | Enable debug logging (set to "1") |
| `DEV_LOGIN_ENABLED` | [index.ts](../apps/api/src/index.ts) line ~199 | (checked at route) | Gated endpoint /auth/dev-login |

---

## 5. Smokes (Test Flows)

**Runner:** `node ops/smoke/smoke.mjs <flow-name>`  
**File:** [ops/smoke/smoke.mjs](../ops/smoke/smoke.mjs)

### Foundational
- **`smoke:ping`** — GET /health; expect 200.
- **`smoke:parties:happy`** — POST party, search by name, update notes.

### Inventory
- **`smoke:inventory:onhand`** — POST movement (receive), GET /inventory/{id}/onhand; verify qty.
- **`smoke:inventory:guards`** — Verify reserve fails if qty > onHand.
- **`smoke:inventory:onhand-batch`** — POST /inventory/onhand:batch with multiple itemIds.
- **`smoke:inventory:list-movements`** — POST movements (receive/reserve), GET /inventory/{id}/movements; verify list.

### Sales Orders
- **`smoke:sales:happy`** — Create SO → submit → commit → reserve → fulfill → close.
- **`smoke:sales:guards`** — Try cancel with reserved qty; expect guard error.

### Purchase Orders
- **`smoke:purchasing:happy`** — Create PO → submit → approve → receive → close.
- **`smoke:purchasing:guards`** — Vendor missing/wrong role; expect 400 (if guard ON).
- **`smoke:po:suggest-draft`** — POST /purchasing/suggest-po from backorder; receive draft.
- **`smoke:po:suggest-multivendor`** — Multiple vendors; receive drafts[] array.
- **`smoke:po:save-from-suggest`** — Save draft → persist via /purchasing/po:create-from-suggestion.
- **`smoke:po:quick-receive`** — Receive all lines (feature-flagged).
- **`smoke:po:receive-line`** — Receive per-line via deltaQty.
- **`smoke:po:receive-line-batch`** — Multiple per-line receives in one call.
- **`smoke:po:receive-line-idem-different-key`** — Same payload, different Idempotency-Key → verify same PO returned.

### Backorders
- **`smoke:product:flags`** — Product reorderEnabled, preferredVendorId, minOrderQty, leadTimeDays.
- **`smoke:backorders:worklist`** — Create SO with shortage → backorderRequest created.
- **`smoke:backorders:ignore-convert`** — Ignore / convert backorder requests.
- **`smoke:backorders:bulk`** — Bulk ignore/convert with vendor filter.

### Pagination & Filtering
- **`smoke:objects:list-pagination`** — GET with limit; verify pageInfo (cursor, hasNext).
- **`smoke:movements:filter-by-poLine`** — GET /inventory/{id}/movements?refId=..&poLineId=..
- **`smoke:objects:pageInfo-present`** — List endpoint returns pageInfo or legacy next.

### Vendor & Events
- **`smoke:po:vendor-guard:on`** — FEATURE_ENFORCE_VENDOR=true; PO submit fails without vendor role.
- **`smoke:po:vendor-guard:off`** — FEATURE_ENFORCE_VENDOR=false; PO submit succeeds (no vendor).
- **`smoke:po:emit-events`** — FEATURE_EVENT_DISPATCH_SIMULATE=true; receive → _dev.emitted=true.

### Other
- **`smoke:epc:resolve`** — GET /epc/resolve?epc=EPC_NOT_FOUND; expect 404.

**Invoke via npm:**
```bash
npm run smoke:list                          # List all flows
npm run smoke:inventory:onhand              # Run single flow
npm run smoke:po:receive-line               # Run another
```

---

## 6. Build & Deploy Scripts

### Package Scripts (Root)
**File:** [package.json](../package.json)

| Script | Command | Purpose |
|:-------|:--------|:--------|
| `build` | npm run build -ws | Build all workspaces |
| `lint` | npm run lint -ws --if-present | Lint all (ESLint) |
| `lint:ci` | eslint . --ext .ts,.tsx --max-warnings=0 | CI linting (strict) |
| `typecheck` | tsc --noEmit -p tsconfig.json | TypeScript check |
| `spec:bundle` | redocly bundle spec/MBapp-Modules.yaml -o spec/openapi.yaml | Merge OpenAPI fragments |
| `spec:types:api` | openapi-typescript spec/openapi.yaml -o apps/api/src/generated/openapi-types.ts | Generate API types |
| `spec:types:mobile` | openapi-typescript spec/openapi.yaml -o apps/mobile/src/api/generated-types.ts | Generate mobile types |
| `api:build` | esbuild apps/api/src/index.ts --bundle --platform=node --target=node20 --outfile=apps/api/dist/bootstrap.js | Esbuild Lambda handler |
| `api:deploy` | powershell -ExecutionPolicy Bypass -File ops/Publish-ObjectsLambda-Daily.ps1 | Deploy Lambda (PowerShell) |

### Deploy Scripts
- **[ops/Publish-ObjectsLambda-Daily.ps1](../ops/Publish-ObjectsLambda-Daily.ps1)** — PowerShell script to zip & upload Lambda.
- **[ops/Set-MBEnv.ps1](../ops/Set-MBEnv.ps1)** — Set AWS environment variables.

### Infra (Terraform)
- **[infra/terraform/](../infra/terraform/)** — AWS infrastructure as code (Lambda, DynamoDB, EventBridge).
- **[infra/lambda/index.ts](../infra/lambda/index.ts)** — Lambda wrapper or build prep.
- **[infra/scripts/build-objects.mjs](../infra/scripts/build-objects.mjs)** — Object schema builder.

---

## 7. CI/CD & Workflows

**File:** [.github/workflows/ci.yaml](../.github/workflows/ci.yaml) (referenced in repo structure)

Typical steps:
1. Spec bundle & lint
2. Generate types (OpenAPI → TypeScript)
3. API build (esbuild)
4. Mobile typecheck
5. Run smoke tests (select flows in matrix)

---

## 8. Open Questions & TODOs

### Known TODOs in Code
1. **[apps/api/src/auth/policy.ts](../apps/api/src/auth/policy.ts:9)**  
   ```
   const roles = ["admin"];  // TODO: parse from JWT
   ```
   **Issue:** Roles are hardcoded; should extract from token claims.

### Architectural Questions
1. **Views & Workspaces Sprint III**  
   - Are Views schema-bound (per module) or generic key/value filters?
   - Workspace tile composition: how deep (ref to view vs. embed)?
   - Role-aware filtering: check allowedViews in PartyRole, or separate ACL table?

2. **Event Dispatcher**  
   - EventBridge / SNS target configuration: where stored? Feature-gated in code?
   - Retry logic / DLQ: planned for Sprint III or later?
   - Multi-tenant event routing: how to avoid cross-tenant leaks?

3. **Data Migrations**  
   - No GSI migrations planned (Sprint III scope).
   - If GSI1 needed for views/workspace queries, when introduced?

4. **Idempotency**  
   - Currently: Idempotency-Key header + payload signature (PO receive).
   - DynamoDB idempotency store: schema/TTL strategy?

5. **Pagination**  
   - Cursor format: opaque string or encoded offset?
   - Legacy `next` vs. new `pageInfo.nextCursor`: when deprecate legacy?

6. **Vendor Guard**  
   - Currently enforced on PO submit/approve if `featureVendorGuardEnabled=true`.
   - Should also gate PO create if vendorId not provided (or allow draft without)?

7. **Movement History Perf**  
   - `/inventory/:id/movements` with filters (refId, poLineId): in-memory or indexed?
   - If heavy, need GSI on `itemId + at` + optional `refId`?

---

## 9. Mobile & Web Apps (Brief)

### Mobile (Expo React Native)
- **Location:** [apps/mobile/src/](../apps/mobile/src/)
- **API Client:** [apps/mobile/src/api/client.ts](../apps/mobile/src/api/client.ts) — Bearer auth, dual tenant headers, dev auto-login.
- **Hooks:** `useObjects()` — list/single mode; surfaces pageInfo.
- **Screens:** features/salesOrders/, features/purchasing/, features/inventory/, etc.

### Web (Vite React)
- **Location:** [apps/web/](../apps/web/) — secondary; most work in mobile.

---

## 10. Notable Patterns

### Back-Compat Adapters
- [index.ts](../apps/api/src/index.ts) — `withTypeId()` ensures handlers see type/id in both query & path params.

### CORS Handling
- [cors.ts](../apps/api/src/cors.ts) — Preflight responses; includes feature flag headers.

### Shared Utilities
- [shared/idempotency.ts](../apps/api/src/shared/idempotency.ts) — Idempotency-Key parsing.
- [shared/statusGuards.ts](../apps/api/src/shared/statusGuards.ts) — Order status transition validation.
- [common/responses.ts](../apps/api/src/common/responses.ts) — Standardized JSON responses.

---

## File Reference Summary

| File/Folder | Lines | Purpose |
|:------------|:------|:--------|
| [index.ts](../apps/api/src/index.ts) | 379 | Main Lambda handler; route dispatch |
| [flags.ts](../apps/api/src/flags.ts) | 38 | Feature flag definitions |
| [shared/db.ts](../apps/api/src/shared/db.ts) | 153 | DynamoDB helpers (Orders, Inventory) |
| [objects/repo.ts](../apps/api/src/objects/repo.ts) | (varies) | Generic object CRUD repo |
| [smoke.mjs](../ops/smoke/smoke.mjs) | 724 | All smoke test flows |
| [package.json](../package.json) | 81 | NPM scripts; workspace config |
| [MBapp-Modules.yaml](../spec/MBapp-Modules.yaml) | 3506 | OpenAPI spec (source of truth) |

---

**Last Updated:** December 20, 2025  
**Snapshot:** End of Sprint II / Start of Sprint III
