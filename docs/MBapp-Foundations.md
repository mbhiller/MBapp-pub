# MBapp Foundations Report

**Navigation:** [Roadmap](MBapp-Roadmap.md) · [Status/Working](MBapp-Status.md) · [Cadence](MBapp-Cadence.md) · [Verification](smoke-coverage.md)  
**Last Updated:** 2025-12-28

---

## Purpose

This document defines the **structural standards and invariants** for the MBapp codebase:
- Object model contracts (what fields/types every module uses)
- API patterns (idempotency, pagination, error handling, feature flags)
- Web and mobile UI conventions (routing, forms, guards, navigation)
- Smoke test conventions (naming, structure, cleanup rules)
- Spec-to-types generation workflow

**For roadmap planning:** See [MBapp-Roadmap.md](MBapp-Roadmap.md)  
**For current status & coverage:** See [MBapp-Status.md](MBapp-Status.md)

---

## 1. Config / Environment Entrypoints

### 1.1 Mobile (apps/mobile)

**Primary Config:** [apps/mobile/app.config.ts](../apps/mobile/app.config.ts#L34-L38)
```typescript
extra: {
  EXPO_PUBLIC_API_BASE: process.env.EXPO_PUBLIC_API_BASE ?? 
    "https://ki8kgivz1f.execute-api.us-east-1.amazonaws.com",
  EXPO_PUBLIC_TENANT_ID: process.env.EXPO_PUBLIC_TENANT_ID ?? "DemoTenant",
  EXPO_PUBLIC_ROLES: process.env.EXPO_PUBLIC_ROLES ?? "admin,objects.view,..."
}
```

**Runtime Access:** [apps/mobile/src/lib/config.ts](../apps/mobile/src/lib/config.ts#L17-L22)
```typescript
export function requireApiBase(): string {
  const { API_BASE } = getExtra();
  if (!API_BASE) {
    throw new Error('Missing API_BASE in Expo extra. Set it in app.config.ts');
  }
  return API_BASE;
}
```

**HTTP Client:** [apps/mobile/src/lib/http.ts](../apps/mobile/src/lib/http.ts#L10)
```typescript
baseURL: requireApiBase(),
```

**Status:** ✅ **No localhost fallback** — Mobile correctly defaults to AWS API Gateway  
**Auth:** Currently uses dev login flow; bearer token stored in DevAuthBootstrap provider

---

### 1.2 Web (apps/web)

**Primary Config:** [apps/web/src/lib/api.ts](../apps/web/src/lib/api.ts#L3-L4)
```typescript
const API_BASE = import.meta.env.VITE_API_BASE!;
const TENANT   = import.meta.env.VITE_TENANT ?? "DemoTenant";
```

**Environment File:** `apps/web/.env` (expected, not checked in)
```bash
VITE_API_BASE=https://ki8kgivz1f.execute-api.us-east-1.amazonaws.com
VITE_TENANT=DemoTenant
```

**Status:** ⚠️ **Missing .env handling** — Web requires manual .env setup; no sample file present  
**Auth:** No auth implementation detected in web client (uses plain fetch, no bearer token)

---

### 1.3 Smoke Tests (ops/smoke)

**Config:** [ops/smoke/smoke.mjs](../ops/smoke/smoke.mjs#L7-L8)
```javascript
const API = (process.env.MBAPP_API_BASE ?? "http://localhost:3000").replace(/\/+$/, "");
const TENANT = process.env.MBAPP_TENANT_ID ?? "DemoTenant";
```

**Status:** ✅ **AWS-only** — Requires `MBAPP_API_BASE` (no localhost fallback); exits(2) if unset  
**Auth:** Requires `MBAPP_BEARER` env var; smokes fail fast if missing (no dev-login fallback)

---

---

## 2. API Patterns

### 2.1 Idempotency & Error Handling
- All mutating endpoints (`POST /purchase-orders`, `POST /purchase-orders/{id}/submit`, etc.) accept optional `idempotencyKey` header
- Duplicate submissions within TTL window (24h default) return same response (200/201) with `X-Idempotency-Cached: true`
- Standard error contract: `{ code: string, message: string, details?: object }`
- Business rule violations return 409 Conflict with domain error codes (e.g., `PO_STATUS_NOT_RECEIVABLE`)

### 2.2 Pagination & Filtering
- List endpoints support `?limit=N` (default 25, max 100) and `?nextToken=XYZ`
- Filters use query params: `?status=draft`, `?vendorId=abc123`
- Response shape: `{ items: T[], nextToken?: string }`

### 2.3 Feature Flags
- Header override pattern: `X-Feature-{FlagName}: 1` (dev/staging only)
- Example: `X-Feature-Enforce-Vendor: 1` enables vendor guard in non-prod
- All flags default OFF; must be explicitly enabled per environment

### 2.4 Object Model Contracts

See [spec/MBapp-Modules.yaml](../spec/MBapp-Modules.yaml) for full OpenAPI definitions. Key patterns:

**Status Lifecycles:**
- Purchase Orders: `draft → submitted → approved → (partially-)received → fulfilled → closed` (also `cancelled`)
- Sales Orders: `draft → submitted → approved → (partially-)fulfilled → completed` (also `cancelled`)
- Inventory Movements: `pending → completed` (no cancellation)

**Hyphenation Convention:** Multi-word statuses use hyphens: `partially-received`, `partially-fulfilled`

**Timestamps:** All entities have `createdAt` (ISO 8601), mutating operations add `updatedAt`

**Reference IDs:** Cross-module references use consistent naming: `vendorId`, `productId`, `customerId`, `locationId`, `poId`, `soId`

---

## 3. Mobile UI Patterns (apps/mobile/src/screens)

| Module | List Screen | Detail Screen | Create/Edit | Search/Filter | Status |
|--------|------------|---------------|-------------|---------------|--------|
| **Parties** | ✅ PartyListScreen | ✅ PartyDetailScreen | ❌ Missing | ✅ Search by name, role filter UI present | **Partial** — No create/edit forms |
| **Products** | ✅ ProductsListScreen | ✅ ProductDetailScreen | ❌ Missing | ✅ Search by q param | **Partial** — No create/edit forms |
| **Inventory** | ✅ InventoryListScreen | ✅ InventoryDetailScreen | ❌ Missing | ✅ Search by q | **Partial** — No create/edit, no adjust UI |
| **Purchase Orders** | ✅ PurchaseOrdersListScreen | ✅ PurchaseOrderDetailScreen | ❌ Missing | ❌ No filter UI | **Partial** — Has receive line modal, no create/edit draft |
| **Sales Orders** | ✅ SalesOrdersListScreen | ✅ SalesOrderDetailScreen | ✅ Create draft button | ❌ No filter UI | **Near-complete** — Missing edit/line management |
| **Backorders** | ✅ BackordersListScreen | ❌ No detail screen | ❌ Missing | ✅ Filter by vendor, SO, item, status | **Partial** — List-only, no detail/edit |
| **Events** | ✅ EventsListScreen | ✅ EventDetailScreen | ❌ Missing (has seed button in dev) | ❌ No filter UI | **Read-only** — Feature-flagged registrations section |
| **Registrations** | ✅ RegistrationsListScreen | ✅ RegistrationDetailScreen | ❌ Missing | ❌ No filter UI | **Read-only** — Feature flag OFF by default |
| **Reservations** | ✅ ReservationsListScreen | ✅ ReservationDetailScreen | ✅ CreateReservationScreen | ❌ No filter UI | **Feature-flagged** — Create exists, edit missing |
| **Resources** | ✅ ResourcesListScreen | ✅ ResourceDetailScreen | ❌ Missing | ❌ No filter UI | **Read-only** |
| **Route Plans** | ✅ RoutePlanListScreen | ✅ RoutePlanDetailScreen | ✅ Create plan button | ❌ No filter UI | **Partial** — Create exists, no edit |
| **Views** | ❌ Missing | ❌ Missing | ❌ Missing | ❌ N/A | **Not implemented** |
| **Workspaces** | ✅ WorkspaceHubScreen (hub only) | ❌ Missing | ❌ Missing | ✅ Search/filter in hub | **List-only** — No apply/detail/edit |

### Mobile API Integration Summary

**Features API modules exist for:**
- ✅ parties, products, inventory, purchaseOrders, salesOrders, backorders
- ✅ events, registrations, reservations, resources, routing, workspaces, views
- ✅ _shared utilities (http, config, fields, AutoCompleteField, Toast)

**Missing UI patterns:**
- **Create/Edit forms** for Parties, Products, Inventory, Purchase Orders
- **Line item editors** for SO/PO (add/remove/edit lines)
- **Filter UI** for most list screens (only Backorders has rich filters)
- **Bulk actions** (select multiple items, batch operations)
- **Validation feedback** (real-time field errors, required field indicators)

---

## 4. Web UI Patterns (apps/web/src)

NOTE: The block below reflected Sprint XXVI–XXVII state. As of 2025-12-25 web has real pages.

**Current Pages (as of 2025-12-25)**

| Page | Route |
|------|-------|
| Parties list/detail | /parties, /parties/:id |
| Products (forms) | /products/new, /products/:id/edit |
| Inventory list/detail | /inventory, /inventory/:id |
| Backorders list | /backorders |
| Purchase orders list/detail | /purchase-orders, /purchase-orders/:id |
| Locations list | /locations |

**Current Structure:**
```
apps/web/src/
  App.tsx          # Single test page with hardcoded CRUD operations
  main.tsx         # Entrypoint
  lib/
    api.ts         # Canonical API client (Objects CRUD only)
```

**UI Coverage:**

| Module | Status |
|--------|--------|
| **All Tier 1–4 modules** | ❌ **No screens exist** — Web has single test page only |

**App.tsx Functions:**
- `tenants()` — GET /tenants (test only)
- `create()` — POST /objects/{type}
- `getByQuery()`, `getByPath()` — GET /objects/{type}?id= or GET /objects/{type}/{id}
- `update()` — PUT /objects/{type}/{id}
- `del()` — DELETE /objects/{type}/{id}
- `doList()` — GET /objects/{type} with pagination
- `doSearch()` — POST /objects/{type}/search with body
- Manual input fields for type, name, tag, id

**Status:** ⚠️ **Web is stub-only** — No production screens, no routing, no layouts, no auth

---

## 5. Smoke Test Conventions

**File:** [ops/smoke/smoke.mjs](../ops/smoke/smoke.mjs)  
**Naming:** `smoke:{module}:{flow}` (e.g., `smoke:po:submit-approve-receive`)  
**Cleanup Rules:**
- Draft objects created during tests are automatically deleted by cleanup hooks
- Approved/submitted objects are left in place (require manual cleanup or separate archival script)
- Test isolation: Each smoke creates unique objects with timestamp-based names

**Structure Pattern:**
```javascript
export async function smoke_module_flow(API_BASE, authToken) {
  const ctx = { createdIds: [] };
  try {
    // 1. Setup
    const obj = await createDraft(...);
    ctx.createdIds.push(obj.id);
    
    // 2. Action sequence
    await submitDraft(obj.id);
    await performAction(obj.id);
    
    // 3. Assertions
    assert.strictEqual(obj.status, 'expected-status');
    
    return { pass: true };
  } catch (err) {
    return { pass: false, error: err.message };
  } finally {
    await cleanup(ctx.createdIds);
  }
}
```

**Opt-In Proofs:** Tests that verify specific guards/flags use descriptive names: `smoke:vendor-guard-enforced`, `smoke:po-receive-after-close-guard`

---

## 6. Spec & Types Generation Workflow

**Source of Truth:** [spec/MBapp-Modules.yaml](../spec/MBapp-Modules.yaml) (OpenAPI 3.0)  
**Type Generation:**
1. Edit `spec/MBapp-Modules.yaml` when adding/changing API contracts
2. Run `npm run generate-types` (in workspace root or `apps/api/`)
3. Generated types appear in `apps/api/src/generated/openapi-types.ts`
4. Import types in handlers: `import { PurchaseOrder, CreatePurchaseOrderRequest } from './generated/openapi-types';`

**Contract-First Workflow:**
- Spec changes happen BEFORE code changes (prevents drift)
- Breaking changes require version bumps (e.g., `/v2/purchase-orders`)
- Additive changes (new optional fields) are safe and preferred

**Validation:** All API handlers should validate request bodies against spec schemas using generated types

---

## 7. Archive: Sprint XXVI+ Report Notes (Historical)

<details>
<summary>Original Sprint XXVI-XXVII Foundations Report + Subsequent Addenda</summary>

### Sprint XLI: Inventory Putaway + Cycle Count Operations (2025-12-26) (Tier 1–4 MVP)

### 4.1 Objects CRUD (Foundation)

| Endpoint | Method | Status | Mobile | Web |
|----------|--------|--------|--------|-----|
| `/objects/{type}` | GET | ✅ Implemented | ✅ Used | ✅ Used |
| `/objects/{type}` | POST | ✅ Implemented | ✅ Used | ✅ Used |
| `/objects/{type}/{id}` | GET | ✅ Implemented | ✅ Used | ✅ Used |
| `/objects/{type}/{id}` | PUT | ✅ Implemented | ✅ Used | ✅ Used |
| `/objects/{type}/{id}` | DELETE | ✅ Implemented | ⚠️ Partial | ✅ Used |
| `/objects/{type}/search` | POST | ✅ Implemented | ✅ Used (parties) | ✅ Used |

**Notes:**
- Mobile uses search for `party` type with role filtering
- Filter params (`filter.soId`, `filter.itemId`, etc.) work via query params on GET /objects/{type}

---

### 4.2 Parties

| Endpoint | Method | Status | Mobile | Web | MVP Need |
|----------|--------|--------|--------|-----|----------|
| `/objects/party` | GET | ✅ | ✅ List | ❌ | **Required** |
| `/objects/party` | POST | ✅ | ❌ No form | ❌ | **Required** |
| `/objects/party/{id}` | GET | ✅ | ✅ Detail | ❌ | **Required** |
| `/objects/party/{id}` | PUT | ✅ | ❌ No form | ❌ | **Required** |
| `/objects/party/search` | POST | ✅ | ✅ Used | ❌ | **Required** |

**Mobile gaps:** Create/Edit party forms  
**Web gaps:** All screens  
**API complete:** ✅

---

### 4.3 Products

| Endpoint | Method | Status | Mobile | Web | MVP Need |
|----------|--------|--------|--------|-----|----------|
| `/objects/product` | GET | ✅ | ✅ List | ❌ | **Required** |
| `/objects/product` | POST | ✅ | ❌ No form | ❌ | **Required** |
| `/objects/product/{id}` | GET | ✅ | ✅ Detail | ❌ | **Required** |
| `/objects/product/{id}` | PUT | ✅ | ❌ No form | ❌ | **Required** |
| `/objects/product/search` | POST | ✅ | ❌ | ❌ | Optional |

**Mobile gaps:** Create/Edit product forms  
**Web gaps:** All screens  
**API complete:** ✅

---

### 4.4 Inventory

| Endpoint | Method | Status | Mobile | Web | MVP Need |
|----------|--------|--------|--------|-----|----------|
| `/objects/inventoryItem` | GET | ✅ | ✅ List | ❌ | **Required** |
| `/objects/inventoryItem` | POST | ✅ | ❌ No form | ❌ | **Required** |
| `/objects/inventoryItem/{id}` | GET | ✅ | ✅ Detail | ❌ | **Required** |
| `/inventory/{id}/onhand` | GET | ✅ | ✅ Used | ❌ | **Required** |
| `/inventory/{id}/movements` | GET | ✅ | ✅ Used | ❌ | **Required** |
| `/inventory/onhand:batch` | POST | ✅ | ❌ | ❌ | Optional |
| `/inventory/{id}/adjust` | POST | ✅ | ❌ No UI | ❌ | **Required for MVP** |
| `/inventory/search` | POST | ✅ | ❌ | ❌ | Optional |

**Mobile gaps:** Adjust inventory UI, create inventory item form  
**Web gaps:** All screens  
**API complete:** ✅

#### 4.4.1 Inventory Movement Indexing

**Canonical & Timeline Index (Dual-Write):**
- Each movement write creates two DynamoDB items:
  - **Canonical:** `pk=tenantId, sk=inventoryMovement#{movementId}` — source of truth by id
  - **Timeline:** `pk=tenantId, sk=inventoryMovementAt#{atIso}#{movementId}` — time-ordered retrieval
- Both items contain identical movement data (id, itemId, action, qty, locationId, lot, etc.)

**Why:** 
- List endpoints (`GET /inventory/movements?locationId=...`, `GET /inventory/{itemId}/movements`) query the timeline index for correct pagination semantics: movements are retrieved in chronological order, so filtering by locationId/itemId is O(limit) instead of O(sparse).
- Consistent reads on both queries ensure read-after-write correctness for newly created movements, eliminating transient gaps.

**Implementation:** [apps/api/src/inventory/movements.ts](../../apps/api/src/inventory/movements.ts#L359-L428) — `createMovement()` performs atomic `BatchWriteCommand` with both items; graceful error logging if timeline write fails (canonical item preserved for fallback scans).

#### 4.4.2 InventoryMovement Write Invariants

**Requirement:** All movement writes MUST use the shared helper `createMovement()` ([apps/api/src/inventory/movements.ts](../../apps/api/src/inventory/movements.ts#L359)).

**Why:**
- Direct `PutCommand` writes bypass dual-write logic, leaving movements invisible to timeline queries.
- This breaks `GET /inventory/{itemId}/onhand` (reads timeline index) and causes onhand checks to fail.
- Example: PO receive that writes only canonical item → onhand endpoint sees zero new qty → smoke:close-the-loop fails.

**Writers Using `createMovement()`:**
- `POST /inventory/{id}:putaway` — calls `createMovement()` with action "putaway"
- `POST /inventory/{id}/adjust` — calls `createMovement()` with action "adjust"
- `POST /inventory/{id}:cycle-count` — calls `createMovement()` with action "cycle_count"
- `POST /purchasing/po/{id}:receive` — calls `createMovement()` with action "receive"
- `POST /sales/so/{id}:reserve` — calls `createMovement()` with action "reserve"
- `POST /sales/so/{id}:release` — calls `createMovement()` with action "release"
- `POST /sales/so/{id}:fulfill` — calls `createMovement()` with action "fulfill"

**Validation:** `createMovement()` enforces `tenantId`, `itemId`, `qty`, and `action` at entry point (throws error if missing).

#### 4.4.3 Inventory Movement Read Fallback

**Defensive Pattern:**
- Readers (`listMovementsByItem()` and `listMovementsByLocation()`) query the **timeline index** first (`inventoryMovementAt#...`).
- If timeline returns **zero results and no pagination cursor**, the reader runs a **fallback query** against the **canonical index** (`inventoryMovement#...`).
- Fallback results are sorted, filtered, and returned with the same schema as timeline results.

**Why:**
- This guards against accidental bugs where a movement writer skips dual-write and writes only the canonical record.
- Without the fallback, such movements would be permanently invisible to clients until the bug is fixed and data is replayed.
- With the fallback, clients still receive correct data; the bug is surfaced via warning logs so it can be detected early.

**Logging:**
- When fallback is triggered, a warning is logged with:
  - `movementTimelineMissing=true`
  - `tenantId`, `itemId`, count of results recovered from canonical index
  - A note describing the probable cause
- Example: "Movements found in canonical index but missing from timeline index. A movement writer may have skipped dual-write."

**Non-Goal:**
- The fallback is **NOT a substitute for dual-write**. The contract remains: all writers MUST use `createMovement()`.
- The fallback is a **safety net** for operational resilience during troubleshooting and incident response.

---

### 4.5 Purchase Orders

| Endpoint | Method | Status | Mobile | Web | MVP Need |
|----------|--------|--------|--------|-----|----------|
| `/objects/purchaseOrder` | GET | ✅ | ✅ List | ❌ | **Required** |
| `/objects/purchaseOrder` | POST | ✅ | ❌ No form | ❌ | **Required** |
| `/objects/purchaseOrder/{id}` | GET | ✅ | ✅ Detail | ❌ | **Required** |
| `/objects/purchaseOrder/{id}` | PUT | ✅ | ❌ No form | ❌ | **Required** |
| `/purchasing/po/{id}:submit` | POST | ✅ | ✅ Used | ❌ | **Required** |
| `/purchasing/po/{id}:approve` | POST | ✅ | ✅ Used | ❌ | **Required** |
| `/purchasing/po/{id}:receive` | POST | ✅ | ✅ Modal | ❌ | **Required** |
| `/purchasing/po/{id}:cancel` | POST | ✅ | ❌ | ❌ | Optional |
| `/purchasing/po/{id}:close` | POST | ✅ | ✅ Used | ❌ | **Required** |
| `/purchasing/suggest-po` | POST | ✅ | ✅ Used | ❌ | **Required for backorders** |
| `/purchasing/po:create-from-suggestion` | POST | ✅ | ✅ Used | ❌ | **Required for backorders** |

**Mobile gaps:** Create/Edit PO draft forms, line item editor  
**Web gaps:** All screens  
**API complete:** ✅

---

### 4.6 Sales Orders

| Endpoint | Method | Status | Mobile | Web | MVP Need |
|----------|--------|--------|--------|-----|----------|
| `/objects/salesOrder` | GET | ✅ | ✅ List | ❌ | **Required** |
| `/objects/salesOrder` | POST | ✅ | ✅ Create draft | ❌ | **Required** |
| `/objects/salesOrder/{id}` | GET | ✅ | ✅ Detail | ❌ | **Required** |
| `/objects/salesOrder/{id}` | PUT | ✅ | ❌ No form | ❌ | **Required** |
| `/sales/so/{id}:submit` | POST | ✅ | ✅ Used | ❌ | **Required** |
| `/sales/so/{id}:commit` | POST | ✅ | ✅ Used | ❌ | **Required** |
| `/sales/so/{id}:reserve` | POST | ✅ | ✅ Used | ❌ | **Required** |
| `/sales/so/{id}:fulfill` | POST | ✅ | ✅ Used | ❌ | **Required** |
| `/sales/so/{id}:release` | POST | ✅ | ✅ Used | ❌ | Optional |
| `/sales/so/{id}:cancel` | POST | ✅ | ❌ | ❌ | Optional |
| `/sales/so/{id}:close` | POST | ✅ | ✅ Used | ❌ | **Required** |

**Mobile gaps:** Edit SO/lines UI (currently create-only)  

---

### Shared Line Editing Contract (patch-lines)

**Why:** Stable line identity with minimal diffs and a reusable editor model across web/mobile. Avoids full-array replacements, reduces payload size, and standardizes line edits.

**Contract:**
- **Server-authoritative `line.id`:** Stable `L{n}` format (L1, L2, L3...) assigned by `ensureLineIds()`. Server preserves existing IDs on updates and assigns new IDs starting from max+1.
- **Client `cid` key:** Optional temporary key for new lines before persistence; best-effort matching only when `id` is absent.
- **Normalize → patch → re-normalize:** Clients compute minimal ops, server applies `applyPatchLines()` without reordering, then runs `ensureLineIds()` to assign any missing IDs.
- **Reserved IDs guarantee:** Removed line IDs are reserved and **never reused** by `ensureLineIds()` to prevent identity churn. New lines always get fresh IDs beyond the max.
- **Sequencing (SO + PO):** Both endpoints use identical flow: `applyPatchLines()` → reserve removed IDs → `ensureLineIds(startAt: maxExisting+1)`.
- **Status guards:** Sales Orders allow patching in `draft|submitted|approved`; Purchase Orders are **draft-only**.
- **Error contract:** Non-editable states return `409 Conflict` with structured details: `{ code: "SO_NOT_EDITABLE" | "PO_NOT_EDITABLE", status: string }`.

**Where:**
- Shared utility: [apps/api/src/shared/patchLines.ts](../apps/api/src/shared/patchLines.ts)
- ID assignment: [apps/api/src/shared/ensureLineIds.ts](../apps/api/src/shared/ensureLineIds.ts)
- Sales endpoint: [apps/api/src/sales/so-patch-lines.ts](../apps/api/src/sales/so-patch-lines.ts)
- Purchasing endpoint: [apps/api/src/purchasing/po-patch-lines.ts](../apps/api/src/purchasing/po-patch-lines.ts)
- Spec: [spec/MBapp-Modules.yaml](../spec/MBapp-Modules.yaml)

**How to verify:**
- `smoke:salesOrders:patch-lines` — Validates update + add, ensures new lines receive server-assigned IDs.
- `smoke:purchaseOrders:patch-lines` — Mirrors SO behavior; CI-covered.

**Parity status:** ✅ **Complete (Sprint G)** — Both SO and PO handlers aligned with identical sequencing and error shapes.
**Web status:** SalesOrder and PurchaseOrder edit pages use patch-lines via shared helper; broader module screens remain pending.
**API complete:** ✅

---

### 4.7 Backorder Fulfillment & Visibility

**What triggers a BackorderRequest:**
- SO commit with `strict: false` and insufficient inventory creates BackorderRequest for each shortage line (status: `open`).
- BackorderRequest has fields: `{ id, soId, soLineId, itemId, qty, createdAt, status, preferredVendorId, fulfilledQty?, remainingQty? }`.
  - `fulfilledQty` and `remainingQty`: nullable, server-maintained during PO receive (not client-writable).
  - **No reverse index:** PO lines store `backorderRequestIds[]`; backorders do NOT store PO IDs (navigate via PO detail).
- Status lifecycle: `open` → (converted by suggest-po) → `converted` OR (user ignores) → `ignored` OR (PO partial receive) → `open/converted` OR (PO full receive) → `fulfilled`.

**suggest-po MOQ behavior (Sprint I):**
- `/purchasing/suggest-po` groups backorder requests by vendor and generates draft PO lines.
- **MOQ is applied regardless of vendor source:** `suggest-po` now loads `product.minOrderQty` after determining `vendorId` (whether from explicit override, backorder preference, or product derivation).
- When drafting a line from a backorder request qty < MOQ, the draft line qty is bumped to the MOQ with `adjustedFrom` tracking the original qty (for transparency).
- **Example:** Backorder qty=10, product minOrderQty=50 → draft line qty=50, adjustedFrom=10.
- Validation in smoke test: `smoke:suggest-po:moq` creates backorder qty=10 with minOrderQty=50 product, suggests PO, asserts draftQty=50.

**Partial PO receive behavior (Sprint I):**
- `/purchasing/po/{id}:receive` updates line-level `receivedQty` and decrements `backorderRequest.remainingQty`.
- Backorder status does NOT change to `fulfilled` until `remainingQty === 0`.
- If received qty < remaining qty, backorder stays `open` or `converted`; if received qty = remaining qty, status → `fulfilled`.
- **Example:** Backorder remainingQty=10, receive deltaQty=5 → remainingQty=5, status stays `open/converted`.
- Validation in smoke test: `smoke:backorders:partial-fulfill` creates backorder qty=10, receives qty=5, asserts status=`converted`, remainingQty=5, fulfilledQty=5.

**Visibility (Web + Mobile):**
- **Web backorder detail:** `/backorders/:id` shows full context (SO link, item link, vendor link), fulfillment progress bar (when fulfilledQty present), and ignore action button.
- **Mobile backorder detail:** `BackorderDetail` screen shows full context with navigate buttons, fulfillment progress, and ignore action with confirmation alert.
- **Web PO detail:** Shows linked backorder IDs per line; chips now link directly to `/backorders/:id` detail page.
- **Web SO detail:** Breakdown badges (open/converted/fulfilled/ignored) are clickable, linking to filtered backorders list by status.
- **Mobile SO detail:** Fetches all backorder statuses via `apiClient.post('/objects/backorderRequest/search', { filter: { soId } })` with status param loop; displays BackorderHeaderBadge with optional breakdown (open/converted/fulfilled/ignored with unit counts).
- **Mobile backorders list:** Tap row → detail; long-press → multi-select for bulk ignore/convert actions.
- **Web backorders list:** Row click → detail (stopPropagation on checkbox/actions to preserve multi-select).

**API complete:** ✅  
**Smoke coverage:** `smoke:backorders:partial-fulfill`, `smoke:suggest-po:moq`  
**Polish complete (Sprint I):** ✅

---

### 4.7 Views & Workspaces (Sprint III)

| Endpoint | Method | Status | Mobile | Web | MVP Need |
|----------|--------|--------|--------|-----|----------|
| `/views` | GET | ✅ | ❌ | ✅ | **Required for saved filters** |
| `/views` | POST | ✅ | ❌ | ✅ | **Required** |
| `/views/{id}` | GET | ✅ | ❌ | ✅ | **Required** |
| `/views/{id}` | PUT | ✅ | ❌ | ✅ | **Required** |
| `/views/{id}` | DELETE | ✅ | ❌ | ✅ | Optional |
| `/workspaces` | GET | ✅ (aliases views) | 🟨 (hub list only) | 🟨 (list/detail) | Optional (nice-to-have) |
| `/workspaces` | POST | ✅ (aliases views) | 🟨 (hub list only) | 🟨 (list/detail) | Optional |
| `/workspaces/{id}` | GET | ✅ (aliases views) | 🟨 (hub list only) | 🟨 (list/detail) | Optional |

- **Web Views:** Pages exist for list/new/detail/edit at `/views`, `/views/new`, `/views/:id`, `/views/:id/edit`.
- **Web Workspaces:** Pages exist for list/detail at `/workspaces`, `/workspaces/:id`; no create/edit UI.
- **Workspaces v1 model:** `/workspaces` endpoints currently read/write `type="view"` items (a “views hub” wrapper in v1); no distinct workspace storage yet.
- **Feature flags:** `FEATURE_VIEWS_ENABLED` / `X-Feature-Views-Enabled` are historical/client gating. Handlers use RBAC; no server-side flag guard today.

- **List pages:** Sales Orders, Purchase Orders, Inventory, Parties, and Products can apply `?viewId` and save current filters as a View (optional shared flag) directly from the list UI.

**Mobile gaps:** Views UI absent; Workspaces hub lists items but cannot apply/open views.  
**Web gaps:** Workspaces create/edit missing; view apply/save present for SO/PO/Inventory/Parties/Products, other modules pending.  
**API complete:** ✅ (v1 aliasing behavior as above)

---

## 5. Proposed Sprint XXVI Scope

### A. Config Unification (1–2 days)

**Goals:**
- Remove localhost fallback from smoke tests
- Create `.env.sample` files for web with AWS defaults
- Document environment setup in README

**Files to change:**
- [ops/smoke/smoke.mjs](../ops/smoke/smoke.mjs#L7) — Remove `?? "http://localhost:3000"` fallback
- `apps/web/.env.sample` — Create with `VITE_API_BASE` and `VITE_TENANT` examples
- `apps/web/README.md` — Add setup instructions

**Acceptance:**
- ✅ Smoke tests fail fast if `MBAPP_API_BASE` unset (no silent localhost)
- ✅ Web has documented .env setup matching mobile defaults

---

### B. Shared Patterns (2–3 days)

**Goals:**
- Create reusable fetch/error/pagination helpers for web
- Establish routing architecture (React Router or similar)
- Add auth context provider for web (bearer token management)
- Create base layout components (header, nav, content)

**Files to create:**
- `apps/web/src/lib/http.ts` — Axios or fetch wrapper with auth headers
- `apps/web/src/providers/AuthProvider.tsx` — Bearer token context
- `apps/web/src/components/Layout.tsx` — Base layout with nav
- `apps/web/src/components/ErrorBoundary.tsx` — Global error handling

**Acceptance:**
- ✅ Web can call authenticated API endpoints with bearer token
- ✅ Base layout with navigation menu renders
- ✅ Error states display user-friendly messages

---

### C. Vertical Slice Delivery (3–4 days)

**Recommended 2–3 vertical slices based on least missing pieces:**

#### Option 1: **Parties Module (Recommended)**
- **Why:** API complete, mobile has list/detail, no actions needed (pure CRUD)
- **Web deliverables:**
  - Parties list page with search/pagination
  - Party detail page (read-only)
  - Create party form (kind: person/organization, name, roles)
  - Edit party form
- **Mobile deliverables:**
  - Create party form screen
  - Edit party form screen
- **Acceptance:** CRUD party from both clients, smoke test coverage

#### Option 2: **Products Module**
- **Why:** API complete, mobile has list/detail, no complex actions
- **Web deliverables:**
  - Products list with search
  - Product detail page
  - Create/Edit product forms (name, sku, preferredVendorId, etc.)
- **Mobile deliverables:**
  - Create product form
  - Edit product form
- **Acceptance:** CRUD product from both clients

#### Option 3: **Inventory Items (Read-Only MVP)**
- **Why:** API complete for read operations
- **Web deliverables:**
  - Inventory list with search
  - Inventory detail with onHand/movements display
- **Mobile deliverables:**
  - No changes (list/detail already exist)
- **Acceptance:** View inventory onhand/movements from both clients

---

### D. Sprint XXVI Checklist

#### Config & Foundation
- [ ] Remove localhost fallback from [ops/smoke/smoke.mjs](../ops/smoke/smoke.mjs#L7)
- [ ] Create `apps/web/.env.sample` with AWS defaults
- [ ] Create `apps/web/src/lib/http.ts` (auth-aware fetch wrapper)
- [ ] Create `apps/web/src/providers/AuthProvider.tsx`
- [ ] Create `apps/web/src/components/Layout.tsx`
- [ ] Add React Router to `apps/web/package.json`

#### Parties Vertical Slice (Web)
- [ ] Create `apps/web/src/pages/PartiesListPage.tsx`
- [ ] Create `apps/web/src/pages/PartyDetailPage.tsx`
- [ ] Create `apps/web/src/pages/CreatePartyPage.tsx`
- [ ] Create `apps/web/src/pages/EditPartyPage.tsx`
- [ ] Create `apps/web/src/components/PartyForm.tsx` (shared form component)
- [ ] Wire routes in `apps/web/src/App.tsx`

#### Parties Vertical Slice (Mobile)
- [ ] Create `apps/mobile/src/screens/CreatePartyScreen.tsx`
- [ ] Create `apps/mobile/src/screens/EditPartyScreen.tsx`
- [ ] Add routes to [apps/mobile/src/navigation/RootStack.tsx](../apps/mobile/src/navigation/RootStack.tsx)
- [ ] Update [apps/mobile/src/screens/PartyListScreen.tsx](../apps/mobile/src/screens/PartyListScreen.tsx) with "Create Party" button
- [ ] Update [apps/mobile/src/screens/PartyDetailScreen.tsx](../apps/mobile/src/screens/PartyDetailScreen.tsx) with "Edit" button

#### Testing & Documentation
- [ ] Add `smoke:parties:create-edit` test to [ops/smoke/smoke.mjs](../ops/smoke/smoke.mjs)
- [ ] Update [docs/MBapp-Status.md](../docs/MBapp-Status.md) with Sprint XXVI summary
- [ ] Update [docs/smoke-coverage.md](../docs/smoke-coverage.md) with new test
- [ ] Verify web typecheck passes: `cd apps/web && npm run typecheck`
- [ ] Verify mobile typecheck passes: `cd apps/mobile && npm run typecheck`

---

## 6. Summary & Recommendations

### Current State
- **Mobile:** Rich screen coverage (20+ screens), missing create/edit forms for core modules
- **Web:** Stub-only (single test page), no production UI
- **API:** Tier 1–4 endpoints 95% complete, well-tested via 38/38 passing smoke tests

### Critical Gaps
1. **Web client:** No routing, no auth, no screens (100% gap)
2. **Mobile forms:** Missing create/edit for Parties, Products, Inventory, PO drafts
3. **Config inconsistency:** Smoke tests fallback to localhost (should fail fast)

### Sprint XXVI Strategy
**Focus:** Establish web foundation + deliver 1 complete vertical slice on both clients

**Rationale:**
- **Parties module** has fewest dependencies (no actions, pure CRUD)
- Establishes patterns for all other modules (routing, forms, auth, error handling)
- Mobile gets create/edit patterns reusable for Products, Inventory
- Web gets foundation reusable for all future modules

**Post-Sprint XXVI:**
- Sprint XXVII: Products + Inventory vertical slices
- Sprint XXVIII: Sales Orders (already has mobile create, add web + edit)
- Sprint XXIX: Purchase Orders + Backorders integration
- Sprint XXX: Views/Workspaces (saved filters, role-aware dashboards)

---

## Addendum — Purchasing & Receiving Foundations (Sprints XXXV–XXXIX, 2025-12-25)

- **Web purchasing vertical slice shipped:** Backorders workbench (list/filter/select/bulk ignore), suggest-PO, multi-vendor draft chooser, create-from-suggestion, and navigation into PO detail; Purchase Orders list/detail with submit/approve/receive/cancel/close gating; PO Activity feed sourced from inventory movements (per-line fetch + aggregation).
- **Status + guard correctness:** Partial receive transitions to `partially-received` (API hyphenated); Close requires `fulfilled` (API 409 otherwise); Cancel only for `draft|submitted`; Receive blocked after `closed|cancelled` with 409 `PO_STATUS_NOT_RECEIVABLE`; Vendor guard supported (FEATURE_ENFORCE_VENDOR_ROLE, non-prod override header X-Feature-Enforce-Vendor: 1) and validated via smoke.
- **Receiving fidelity:** Per-line receive payload supports `{ lineId, deltaQty, lot?, locationId? }`; lots/locations persist into inventory movements and can be queried with `GET /inventory/{itemId}/movements?refId={poId}&poLineId={lineId}`.
- **Smokes (opt-in proofs):** `smoke:close-the-loop`, `smoke:close-the-loop-multi-vendor`, `smoke:close-the-loop-partial-receive`, `smoke:vendor-guard-enforced`, `smoke:po-receive-after-close-guard`, `smoke:po-receive-after-cancel-guard`, `smoke:po-receive-lot-location-assertions`.

**End of Report**

</details>
