# MBapp Foundations Report

**Navigation:** [Roadmap](MBapp-Roadmap.md) · [Status/Working](MBapp-Status.md) · [Cadence](MBapp-Cadence.md) · [Verification](smoke-coverage.md)  
**Last Updated:** 2025-12-30

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

**Workspaces / Views (alias model):**
- `/workspaces` is an alias over the same storage as `/views` (type="view"). The backend stores workspaces as objects with `type="view"` and honors the same CRUD semantics.
- Workspace membership is tracked via `views: string[]` (list of view IDs). Mobile WorkspaceDetail uses this to open member views into entity list screens via `viewId`.
- Known contract gap: the OpenAPI spec allows `name` up to 200 chars, but the current backend validation for workspaces (and views) enforces 1–120 chars; this should be aligned in a future sprint.

**Status Lifecycles:**
- Purchase Orders: `draft → submitted → approved → (partially-)received → fulfilled → closed` (also `cancelled`)
- Sales Orders: `draft → submitted → approved → (partially-)fulfilled → completed` (also `cancelled`)
- Inventory Movements: `pending → completed` (no cancellation)

**Hyphenation Convention:** Multi-word statuses use hyphens: `partially-received`, `partially-fulfilled`

**Timestamps:** All entities have `createdAt` (ISO 8601), mutating operations add `updatedAt`

**Reference IDs:** Cross-module references use consistent naming: `vendorId`, `productId`, `customerId`, `locationId`, `poId`, `soId`

### 2.5 Shared Line Editor Contract

**Purpose:** Ensure consistent line item identity and patch-lines behavior across SO/PO, web/mobile, create/edit flows.

**ID Fields:**
- `id` (string): Server-assigned persistent identity — MUST be stable `L{n}` pattern (e.g., `L1`, `L2`, `L3`, ...)
  - Present ONLY for lines already persisted by server
  - Never send client-generated temporary IDs (e.g., `tmp-*`) in the `id` field
- `cid` (string): Client-only temporary identity — MUST use `tmp-{uuid}` pattern
  - Present ONLY for new lines not yet saved to server
  - Used by patch-lines ops to identify which line to create
  - Never persisted; server replaces with stable `id` upon creation
- `_key` (string): UI-only React key — managed by LineArrayEditor component
  - Never sent to API
  - Ensures stable rendering during edits

**Patch-Lines Flow (Web + Mobile):**
```
Web Edit Page:
  1. Load server lines (have id: L1, L2, ...)
  2. User edits in LineArrayEditor (new lines get cid: tmp-*, existing keep id)
  3. Form submission → computePatchLinesDiff(serverLines, editedLines)
  4. Diff helper generates ops:
     - Remove: { op: "remove", id: "L1" }  (for server lines)
     - Remove: { op: "remove", cid: "tmp-xyz" }  (for client lines)
     - Upsert: { op: "upsert", id: "L1", patch: {...} }  (update existing)
     - Upsert: { op: "upsert", cid: "tmp-xyz", patch: {...} }  (create new)
  5. API receives ops → applyPatchLines() processes
  6. Server calls ensureLineIds() → assigns stable L{n} IDs to new lines
  7. Persist with guaranteed stable IDs
```

**Critical Rules (DO NOT VIOLATE):**
- ❌ NEVER generate fallback IDs (e.g., `L${idx}`) for lines without server id
- ❌ NEVER send `tmp-*` values in the `id` field (always use `cid`)
- ❌ NEVER send full line arrays as PUT payload (always use `computePatchLinesDiff` + PATCH ops)
- ✅ ALWAYS preserve server `id` exactly as provided
- ✅ ALWAYS use `cid` for client-only lines (generate via `tmp-${uuid}`)
- ✅ ALWAYS let server assign stable IDs via `ensureLineIds()`
- ✅ Canonical line identity is `id`; `lineId` is a deprecated compatibility alias during transition (accept on input only).

**Implementation Status (Sprint M → Sprint U):**
- ✅ API: `ensureLineIds()` helper ensures stable `L{n}` IDs (apps/api/src/shared/ensureLineIds.ts)
- ✅ API: `po-create-from-suggestion` uses `ensureLineIds()` (no more ad-hoc `ln_*` IDs)
- ✅ API: Action handlers (po-receive, so-reserve, so-release, so-fulfill) accept both `id` (canonical) and `lineId` (deprecated) on input, normalize internally to `id`, log legacy usage, always emit `id` in responses (Sprint E2)
- ✅ Web: `computePatchLinesDiff()` sends `cid` for new lines, `id` for updates (apps/web/src/lib/patchLinesDiff.ts)
- ✅ Web: Edit pages preserve server IDs, no fallback generation (EditSalesOrderPage, EditPurchaseOrderPage)
- ✅ Web: Forms have JSDoc pattern documentation to prevent regressions (SalesOrderForm, PurchaseOrderForm)
- ✅ Web: LineArrayEditor auto-generates `cid` for new lines, preserves `id` for existing
- ✅ Smoke tests: `smoke:po:create-from-suggestion:line-ids` validates `L{n}` pattern
- ✅ Smoke tests: `smoke:so:patch-lines:cid` validates cid → server id flow
- ✅ Mobile: Shared `computePatchLinesDiff` helper matches web semantics (apps/mobile/src/lib/patchLinesDiff.ts); shared RN `LineEditor` component used by SO/PO edit screens with cid tmp-* generation; broader RN line editor UX roll-out ongoing; PO/SO edit screens now share normalization helpers + PATCHABLE fields constant (itemId/qty/uom) and respect tmp-* cid rules (Sprint U)

**Files:**
- Spec: [spec/MBapp-Modules.yaml](../spec/MBapp-Modules.yaml) — PatchLinesOp schema defines `id` + `cid` fields
- API: [apps/api/src/shared/ensureLineIds.ts](../apps/api/src/shared/ensureLineIds.ts) — ID normalization
- API: [apps/api/src/shared/applyPatchLines.ts](../apps/api/src/shared/applyPatchLines.ts) — Patch ops processor
- Web: [apps/web/src/lib/patchLinesDiff.ts](../apps/web/src/lib/patchLinesDiff.ts) — Diff + ops generator
- Web: [apps/web/src/components/LineArrayEditor.tsx](../apps/web/src/components/LineArrayEditor.tsx) — Shared editor component
- Smokes: [ops/smoke/smoke.mjs](../ops/smoke/smoke.mjs) — Regression tests (lines 6672-6876)

**Status Guards (mobile PO vs SO patch-lines):**
- Sales Orders: patch-lines allowed in `draft|submitted|approved` (UI allows edit in those statuses; 409 `SO_NOT_EDITABLE` otherwise)
- Purchase Orders: patch-lines **draft-only**; UI gates the Edit CTA to draft and surfaces 409 `PO_NOT_EDITABLE` as “PO is not editable unless Draft.”

### 2.6 Line Identity Contract (Canonical `id` vs. Deprecated `lineId`)

**Context:** Through Sprint M, the codebase used `lineId` to reference line items. Starting in Sprint O (E1-E5), the canonical identifier is now `id` (matching patch-lines semantics). This section documents the transition plan and guarantees.

**Canonical Rule:**
- **`id`** (string): Canonical line identity, always used in responses and client payloads
  - Assigned by server as stable `L{n}` pattern (e.g., `L1`, `L2`, `L3`)
  - Persisted and immutable once created
  - Must be sent by clients in all action requests (receive/reserve/release/fulfill)

**Deprecated Alias:**
- **`lineId`** (string): Legacy field, accepted on input during 1-sprint compatibility window (Sprint O)
  - Will be removed from API input schemas in Sprint P
  - **Never** included in API responses (responses always use `id` only)
  - Clients must migrate to use `id` within this sprint

**Affected Endpoints:**
- `POST /purchasing/po/{id}:receive` — Expects `{ lines: [{ id, deltaQty, ... }] }` (was `lineId`)
- `POST /sales/so/{id}:reserve` — Expects `{ lines: [{ id, deltaQty, ... }] }` (was `lineId`)
- `POST /sales/so/{id}:release` — Expects `{ lines: [{ id, deltaQty, reason? }] }` (was `lineId`)
- `POST /sales/so/{id}:fulfill` — Expects `{ lines: [{ id, deltaQty, ... }] }` (was `lineId`)
- All `{object}:patch-lines` endpoints — Already require `id` (or `cid` for new lines); never used `lineId`

**Transition Timeline:**
| Phase | When | Behavior |
|-------|------|----------|
| **Input Compat** | Sprint O (now) | API accepts both `id` and `lineId` on input; normalizes to `id`; logs legacy usage metrics |
| **Removal** | Sprint P | `lineId` removed from input schemas; clients must use `id` |
| **Cleanup** | Post-Sprint P | Telemetry queries show legacy usage rate; remove if ~0% |

**Implementation (Sprint O E1–E5):**
- ✅ **E1 (Spec):** spec/MBapp-Modules.yaml updated to canonicalize `id` in action payloads
- ✅ **E2 (API):** Action handlers normalize `lineId` → `id` on input; emit structured logs (`so-reserve.legacy_lineId`, `po-receive.legacy_lineId`, etc.); always respond with `id`
- ✅ **E3 (Smoke):** New test `smoke:line-identity:id-canonical` validates all action endpoints accept/emit `id`; existing action smokes updated to use `id` payloads
- ✅ **E4 (Web):** Web app payloads updated to send `id` (all action handlers)
- ✅ **E5 (Mobile):** Mobile app payloads updated to send `id` (all action handlers, type definitions)
- ✅ **E6 (Docs):** This section + Status/smoke-coverage updated

**Selection/Reading Helpers (Read-Side Fallback):**
During transition, helpers like `getPoLineId()` (web) and `pickBestMatchingLineId()` (mobile) retain fallback logic:
```typescript
// Web example
const lineId = String(line?.id ?? line?.lineId ?? "");  // prefer id, fallback lineId

// Mobile example  
getLineId: (line: any) => String(line?.id ?? line?.lineId ?? ""),  // prefer id, fallback lineId
```
This allows responses from legacy systems or test fixtures to still work. **Client payloads, however, always send `id`.**

**Files Modified (E1-E5):**
- Spec: [spec/MBapp-Modules.yaml](../spec/MBapp-Modules.yaml)
- API: [apps/api/src/purchasing/so-reserve.ts](../apps/api/src/purchasing/so-reserve.ts), [so-release.ts](../apps/api/src/sales/so-release.ts), [so-fulfill.ts](../apps/api/src/sales/so-fulfill.ts), [po-receive.ts](../apps/api/src/purchasing/po-receive.ts)
- Web: [apps/web/src/pages/PurchaseOrderDetailPage.tsx](../apps/web/src/pages/PurchaseOrderDetailPage.tsx), [SalesOrderDetailPage.tsx](../apps/web/src/pages/SalesOrderDetailPage.tsx)
- Mobile: [apps/mobile/src/screens/PurchaseOrderDetailScreen.tsx](../apps/mobile/src/screens/PurchaseOrderDetailScreen.tsx), [SalesOrderDetailScreen.tsx](../apps/mobile/src/screens/SalesOrderDetailScreen.tsx), [DevToolsScreen.tsx](../apps/mobile/src/screens/DevToolsScreen.tsx)
- Mobile Types: [apps/mobile/src/features/purchaseOrders/api.ts](../apps/mobile/src/features/purchaseOrders/api.ts), [salesOrders/api.ts](../apps/mobile/src/features/salesOrders/api.ts), [sales/api.ts](../apps/mobile/src/features/sales/api.ts), [purchasing/poActions.ts](../apps/mobile/src/features/purchasing/poActions.ts)

---



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

### 4.7 Views & Workspaces (Sprint III + Sprint Q Hardening)

| Endpoint | Method | Status | Mobile | Web | MVP Need |
|----------|--------|--------|--------|-----|----------|
| `/views` | GET | ✅ | ✅ (v1: PO/SO) | ✅ | **Required for saved filters** |
| `/views` | POST | ✅ | ✅ (v1: PO/SO) | ✅ | **Required** |
| `/views/{id}` | GET | ✅ | ✅ (v1: PO/SO) | ✅ | **Required** |
| `/views/{id}` | PATCH | ✅ | ✅ (v1: PO/SO) | ✅ | **Required** (Sprint Q: used for Update View; Sprint R mobile) |
| `/views/{id}` | DELETE | ✅ | ✅ (v1: manage) | ✅ | Optional |
| `/workspaces` | GET | ✅ (aliases views) | 🟨 (hub list only) | 🟨 (list/detail) | Optional (nice-to-have) |
| `/workspaces` | POST | ✅ (aliases views) | 🟨 (hub list only) | 🟨 (list/detail) | Optional |
| `/workspaces/{id}` | GET | ✅ (aliases views) | 🟨 (hub list only) | 🟨 (list/detail) | Optional |

- **Web Views:** Pages exist for list/new/detail/edit at `/views`, `/views/new`, `/views/:id`, `/views/:id/edit`.
- **Web Workspaces:** Pages exist for list/detail at `/workspaces`, `/workspaces/:id`; no create/edit UI.
- **Workspaces v1 model:** `/workspaces` endpoints currently read/write `type="view"` items (a “views hub” wrapper in v1); no distinct workspace storage yet.
- **Feature flags:** `FEATURE_VIEWS_ENABLED` / `X-Feature-Views-Enabled` are historical/client gating. Handlers use RBAC; no server-side flag guard today.

- **List pages:** Sales Orders, Purchase Orders, Inventory, Parties, and Products can apply `?viewId` and save current filters as a View (optional shared flag) directly from the list UI.

**Sprint Q Hardening (2025-12-30):**
- ✅ **Server-side filter validation:** `/views` POST and PATCH endpoints validate filter shape (field: non-empty string, op: enum, value: type-appropriate). Returns 400 with clear message for invalid filters. No deep field-existence validation (deferred).
- ✅ **Web "Update View" affordance:** When a view is applied via `?viewId`, SaveViewButton shows "Update View" (primary) + "Save as New" (secondary) options. Uses PATCH `/views/{id}` to persist changes without creating duplicates (reduces view sprawl).
- ✅ **Columns stored but not rendered:** View `columns` array is persisted in API/DB but currently not used by web table rendering (UI ignores columns field; tables show default column set). Sort field is stored; whether applied depends on list page implementation.
- ✅ **Smoke coverage:** `smoke:views:apply-to-po-list` validates filter application constrains list results; `smoke:views:validate-filters` validates server-side filter rejection.

**Sprint R Mobile Save View v1 (2025-12-30):**
- ✅ **Mobile API support:** `useViewsApi()` hook extended with `create(payload)` and `patch(id, payload)` methods; auth token wired to AsyncStorage
- ✅ **PO/SO list UI:** SaveViewModal component added for save/update workflows; integrated into PurchaseOrdersListScreen and SalesOrdersListScreen with primary "Save"/"Update" button affordance
- ✅ **State mapping:** Bidirectional (applyView ↔ buildViewFromState) with round-trip guarantee; mapViewToMobileState applies filters, buildViewFromState reverses mapping for save
- ✅ **Supported fields (v1):**
  - **PO:** q (contains), status (eq), vendorId (eq), sort (createdAt/updatedAt only)
  - **SO:** q (contains), status (eq), sort (createdAt/updatedAt only)
  - **Sort:** Limited to `createdAt` or `updatedAt` fields with `asc`/`desc` direction (other fields dropped)
  - **Shared flag:** Defaults to false (if omitted from payload); not exposed in UI for v1
- ✅ **Implementation pattern:** Inverse mapper normalizes state → View.filters by dropping empty values, validating operators, and entity-specific field mappings
- ✅ **Limitations:** Inventory/Parties/Products list save not yet implemented; workspaces hub UI absent; columns array not applied to mobile lists

**Sprint S Mobile Views Management (2025-12-30):**
- ✅ **ViewsManageScreen:** Mobile screen to list/search/filter views (entityType chips + q) with pagination and rename/delete actions.
- ✅ **Lifecycle coverage:** Save/Update from list screens (Sprint R) plus rename/delete from management screen (Sprint S); mobile now supports full view lifecycle.
- ✅ **Safety:** Delete guarded by confirm dialog; rename requires non-empty name; pagination via load-more button.
- ✅ **Entry point:** WorkspaceHub exposes “Manage Views” button (passes entityType filter when selected).

**Mobile gaps (post-v1):** Inventory/Parties/Products list save; workspaces hub apply/open views.  
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

## 7. UI System & Design Direction

### 7.1 UI Technology Stack (Locked)

**Web UI Foundation:**
- **Framework:** React 18+ with TypeScript
- **Styling:** TailwindCSS (utility-first CSS framework)
- **Component Library:** shadcn/ui (copy-paste components built on Radix UI primitives)
- **Routing:** React Router v6
- **State Management:** React hooks + Context API (no global state library by default)

**Mobile UI Foundation:**
- **Framework:** React Native (Expo managed workflow)
- **Styling:** React Native StyleSheet API + useColors hook (custom theming)
- **Navigation:** React Navigation v6 (native stack navigator)
- **State Management:** React hooks + Context API

**Rationale:**
- **TailwindCSS:** Utility-first enables rapid prototyping without CSS file proliferation; tree-shaking ensures minimal bundle size.
- **shadcn/ui:** Copy-paste model means full control over components (no hidden dependencies); built on accessible Radix primitives.
- **No Material-UI/Ant Design:** Avoid opinionated design systems that constrain customization and bloat bundle size.

**Future Design Contract (Post-MVP):**
- Establish design tokens (colors, spacing, typography) shared between web and mobile.
- Formalize component API contracts (props, states, events) for cross-platform consistency where applicable.
- Mobile may adopt React Native Paper or similar if native component patterns diverge significantly from web.

**Status:** ✅ **Locked** — All new web UI must use TailwindCSS + shadcn/ui; no alternative styling approaches without architectural review.

---

### 7.2 Multi-UX Discipline (User Personas)

MBapp serves **three primary UX disciplines** with distinct interaction patterns:

#### A) Operator UX (Primary Focus)
**Target Users:** Warehouse operators, receiving clerks, inventory managers, fulfillment staff  
**Interaction Patterns:**
- High-frequency repetitive tasks (scan → verify → confirm)
- Touch-first mobile UI (large buttons, minimal text input)
- Bulk actions (select multiple → apply action)
- Defaults and auto-fill to minimize data entry
- Immediate feedback (success toasts, error alerts)
- Offline-capable where feasible (future: local queue + sync)

**Key Screens:**
- BackordersListScreen → bulk ignore/convert
- PurchaseOrderDetailScreen → quick receive with defaults
- InventoryListScreen → filters + quick navigation
- SalesOrderDetailScreen → backorder visibility + actions

**Design Principles:**
- **Speed over completeness:** Operators need fast, predictable flows (not comprehensive dashboards).
- **Error recovery:** Clear actionable messages; allow retry without losing context.
- **Keyboard/scan support:** Enter key submits forms; barcode scans auto-populate fields.

#### B) Manager/Analyst UX (Secondary)
**Target Users:** Purchasing managers, sales managers, operations analysts  
**Interaction Patterns:**
- Filtering and searching large datasets (views, saved filters)
- Batch operations (suggest PO from multiple backorders)
- Multi-step wizards (create PO → review → submit → approve)
- Reporting and status breakdowns (backorder lifecycle, PO approval queues)
- Cross-module navigation (SO → backorders → PO → inventory)

**Key Screens:**
- BackordersListPage (web) → vendor filter + suggest-PO modal
- PurchaseOrdersListPage (web) → status filters + bulk actions
- SalesOrderDetailPage → backorder breakdown badges (clickable to filtered list)

**Design Principles:**
- **Context preservation:** Deep links maintain filter state (shareable URLs).
- **Discoverability:** Related entities linked (SO → backorders → PO).
- **Batch transparency:** Show skipped items with reasons (suggest-PO modal).

#### C) Audit/Debug UX (Tertiary)
**Target Users:** System admins, support engineers, developers  
**Interaction Patterns:**
- Inspecting raw object state (ID, timestamps, status history)
- Tracing requests via requestId (error messages → CloudWatch logs)
- Testing feature flags (dev headers override backend flags)
- Smoke test execution and manifest inspection

**Key Screens:**
- DevToolsScreen (mobile) → feature flag toggles, environment display
- Error messages → include requestId for log correlation
- Smoke test runner → manifest output with created entity IDs

**Design Principles:**
- **Transparency:** Show underlying IDs, request metadata, error details.
- **Copy-friendly:** Long-press to copy IDs, error messages, log snippets.
- **Flag visibility:** Dev mode shows current flag states and overrides.

**Status:** ✅ **Active** — Operator UX is primary focus; Manager UX receives polish as needed; Audit UX is dev-only (no prod UI).

---

## 8. Telemetry & Analytics Foundations

### 8.1 Telemetry Stack (Locked)

**Product Analytics:**
- **Tool:** PostHog (self-hosted or cloud)
- **Scope:** User behavior tracking, feature adoption, funnel analysis
- **Events:** Domain events (backorder_ignored, po_received, SalesOrderReserved, SalesOrderFulfilled) + UX events (screen_viewed, button_clicked, so_reserve_clicked, so_fulfill_clicked)
- **Session replay:** Enabled for web (opt-in for mobile)

**Error Tracking:**
- **Tool:** Sentry
- **Scope:** Client-side errors (React/React Native), backend errors (Lambda exceptions)
- **Context:** Minimum tags: `tenantId`, `actorId`, `environment`, `release`
- **Breadcrumbs:** Navigation, API calls, user actions (sanitized, no PII)

**Observability (Future):**
- **Tool:** OpenTelemetry (OTEL) → AWS CloudWatch / Honeycomb / Datadog
- **Scope:** Distributed tracing (API Gateway → Lambda → DynamoDB)
- **Metrics:** Request latency, error rates, DynamoDB throttling
- **Status:** ⬜ Planned (post-MVP)

**Rationale:**
- **PostHog:** Open-source with self-hosting option; feature flags + A/B testing built-in; no vendor lock-in.
- **Sentry:** Industry standard for error tracking; excellent React/React Native integrations; affordable pricing.
- **OTEL:** Future-proof observability; AWS-native with CloudWatch integration; enables cross-service tracing.

**Status:** 🟨 **Partial** — Sentry integrated (backend + mobile); PostHog planned; OTEL not yet implemented.

**Implementation:**
- **Web helper:** `apps/web/src/lib/telemetry.ts` exports `track(eventName, properties)` (PostHog-backed)
- **Env vars:** `VITE_POSTHOG_API_KEY`, `VITE_POSTHOG_HOST` (optional, defaults to app.posthog.com)
- **Safe no-op:** If env vars missing, `track()` does nothing (no crashes)
- **Envelope fields:** Automatically includes `ts`, `source="web"`, `route` (location.pathname), `tenantId`/`actorId` when available from AuthProvider context

**Mobile scaffolding:**
- **Helper:** `apps/mobile/src/lib/telemetry.ts` exports `track(eventName, properties)` with envelope (`ts`, `source="mobile"`, `screen`, `tenantId`, optional `actorId`)
- **Env vars:** `EXPO_PUBLIC_POSTHOG_API_KEY`, `EXPO_PUBLIC_POSTHOG_HOST` (defaults to app.posthog.com)
- **Sentry:** Init if `EXPO_PUBLIC_SENTRY_DSN` present; tags `source="mobile"` and `tenantId` from DevAuthBootstrap (no unsafe actorId decoding)
- **Mobile PO edit instrumentation:** `screen_viewed` (screen `PurchaseOrderEdit`, includes `poId` + status) and `po_edit_submit` (`result=attempt|success|error`, `opCount`, `upsertCount`, `removeCount`, `httpStatus?`, `errorCode?`) fire from [apps/mobile/src/screens/EditPurchaseOrderScreen.tsx](../apps/mobile/src/screens/EditPurchaseOrderScreen.tsx); Sentry tags include `screen`, `route`, `objectType`, `objectId`, `poStatus` when present.
- **Safe no-op:** Missing keys → telemetry helpers are no-ops (no crashes)

**Instrumented Workflow (Example): Backorder Ignore (Web + Mobile)**
- **UX events:**
  - `BackorderDetail_Viewed` with `{ objectType: "backorderRequest", objectId }`
  - `BO_Ignore_Clicked` with `{ objectType: "backorderRequest", objectId, result: "success|fail", errorCode? }`
- **Domain event (API):**
  - `BackorderIgnored` emitted from backend with `{ objectType, objectId, soId, itemId, statusBefore, statusAfter, durationMs }`
- **PII rule:** IDs only in properties; no names/emails.

**Sprint P Telemetry Additions: SO Reserve/Fulfill**
- **Domain events (API):**
  - `SalesOrderReserved`: Emitted after inventory movements persist (success) or on error (INVALID_STATUS | INSUFFICIENT_AVAILABILITY). Payload: `{ objectType, objectId, lineCount, totalQtyReserved, statusBefore, statusAfter, result, errorCode? }`
  - `SalesOrderFulfilled`: Emitted after movements + line updates + status computed (success) or on error (INVALID_STATUS | OVER_FULFILLMENT). Payload: `{ objectType, objectId, lineCount, totalQtyFulfilled, statusBefore, statusAfter, result, errorCode? }`
- **UX events (Web + Mobile):**
  - `so_reserve_clicked`: Tracks reserve button clicks (attempt/success/fail). Payload: `{ objectType, objectId, lineCount, result, errorCode? }`
  - `so_fulfill_clicked`: Tracks fulfill button clicks (attempt/success/fail) and scan-to-fulfill path (scanMode=true). Payload: `{ objectType, objectId, lineCount, result, errorCode?, scanMode? }`
- **Pattern:** IDs + aggregated counts only; no lines array. Sentry integration adds tags (objectType, objectId, action) on failures.

---

### 8.2 Telemetry Contract (Event Envelope)

**Standard Event Shape:**
```typescript
type TelemetryEvent = {
  // Core identifiers (required)
  eventName: string;          // e.g., "backorder_ignored", "po_received"
  timestamp: string;          // ISO 8601 timestamp
  sessionId: string;          // Client-generated session UUID
  
  // Actor context (required)
  tenantId: string;           // Always present (multi-tenant isolation)
  actorId?: string;           // User ID (omit for anonymous/unauthenticated)
  
  // Object context (required for domain events)
  objectType?: string;        // e.g., "backorderRequest", "purchaseOrder"
  objectId?: string;          // e.g., "bo_abc123", "po_xyz789"
  
  // UX context (required for UX events)
  screen?: string;            // Mobile: "BackorderDetail", Web: route path
  component?: string;         // e.g., "IgnoreButton", "SuggestPoModal"
  
  // Additional metadata (optional)
  properties?: Record<string, any>;  // Event-specific data (sanitized)
  
  // Environment (required)
  platform: "web" | "mobile";  // Client platform
  appVersion?: string;         // Semantic version (e.g., "1.2.3")
  environment: "dev" | "staging" | "prod";  // Deployment environment
};
```

**Envelope Rules:**
1. **Never send PII:** No customer names, addresses, emails, phone numbers in `properties`. **Auto-enforced:** All telemetry helpers (`track()`, `emitDomainEvent()`) include built-in `sanitizeTelemetryProps()` that drops PII keys (name, email, phone, address, firstName, lastName, displayName) and nested objects/arrays.
2. **Always send tenant:** All events must include `tenantId` for isolation and filtering.
3. **Object references only:** Send object IDs, not full object payloads (query backend for details).
4. **Timestamps in UTC:** Always ISO 8601 format (`new Date().toISOString()`).
5. **Session continuity:** `sessionId` persists across screens/routes within a single app launch.

**Domain Events Helper (API):**
- **Location:** `apps/api/src/common/logger.ts` exports `emitDomainEvent(ctx, eventName, payload)`
- **Envelope (auto):** `eventName`, `ts`, `source="api"`, `tenantId`, `actorId` (or `actorType="system"`)
- **Payload (IDs only):** Use `objectType`, `objectId`, optional `soId`, `itemId`, `statusBefore`, `statusAfter`, `result`, `durationMs`, `errorCode`
- **Sanitization (auto):** Built-in PII filter drops name/email/phone/address keys and nested objects
- **Example:** `emitDomainEvent(ctx, "BackorderIgnored", { objectType: "backorderRequest", objectId: id, soId, itemId, statusBefore, statusAfter })`

---

### 8.3 Event Families & Examples

#### A) Domain Events (Business Logic)
**Purpose:** Track domain state transitions and user-driven workflows.

**Examples:**
```typescript
// Backorder ignored by operator
{
  eventName: "backorder_ignored",
  timestamp: "2025-12-29T10:30:00.000Z",
  sessionId: "sess_abc123",
  tenantId: "DemoTenant",
  actorId: "user_xyz",
  objectType: "backorderRequest",
  objectId: "bo_12345",
  properties: {
    previousStatus: "open",
    source: "detail_screen"  // vs "bulk_action"
  },
  platform: "mobile",
  environment: "prod"
}

// Sales Order committed (Sprint L)
{
  eventName: "SalesOrderCommitted",
  timestamp: "2025-12-29T14:20:00.000Z",
  sessionId: "sess_def456",
  tenantId: "DemoTenant",
  actorId: "user_xyz",
  objectType: "salesOrder",
  objectId: "so_78901",
  properties: {
    statusBefore: "approved",
    statusAfter: "committed",
    strict: false,
    shortagesCount: 2,
    movementsEmitted: 5,
    result: "success"
  },
  platform: "api",
  environment: "prod"
}

// Sales Order reserved (Sprint P)
{
  eventName: "SalesOrderReserved",
  timestamp: "2025-12-29T14:22:00.000Z",
  sessionId: "sess_def456",
  tenantId: "DemoTenant",
  actorId: "user_xyz",
  objectType: "salesOrder",
  objectId: "so_78901",
  properties: {
    lineCount: 2,
    totalQtyReserved: 50,
    statusBefore: "submitted",
    statusAfter: "submitted",
    result: "success"
  },
  platform: "api",
  environment: "prod"
}

// Sales Order fulfilled (Sprint P)
{
  eventName: "SalesOrderFulfilled",
  timestamp: "2025-12-29T14:30:00.000Z",
  sessionId: "sess_def456",
  tenantId: "DemoTenant",
  actorId: "user_xyz",
  objectType: "salesOrder",
  objectId: "so_78901",
  properties: {
    lineCount: 2,
    totalQtyFulfilled: 50,
    statusBefore: "committed",
    statusAfter: "fulfilled",
    result: "success"
  },
  platform: "api",
  environment: "prod"
}

// Purchase Order received (Sprint L)
{
  eventName: "PurchaseOrderReceived",
  timestamp: "2025-12-29T14:25:00.000Z",
  sessionId: "sess_ghi789",
  tenantId: "DemoTenant",
  actorId: "user_xyz",
  objectType: "purchaseOrder",
  objectId: "po_67890",
  properties: {
    lineCount: 3,
    totalQtyReceived: 150,
    statusBefore: "approved",
    statusAfter: "partially-received",
    result: "success"
  },
  platform: "api",
  environment: "prod"
}

// Purchase Order approved (Sprint L)
{
  eventName: "PurchaseOrderApproved",
  timestamp: "2025-12-29T14:15:00.000Z",
  sessionId: "sess_jkl012",
  tenantId: "DemoTenant",
  actorId: "user_xyz",
  objectType: "purchaseOrder",
  objectId: "po_67890",
  properties: {
    statusBefore: "submitted",
    statusAfter: "approved",
    result: "success"
  },
  platform: "api",
  environment: "prod"
}

// PO received (legacy example — partial or full)
{
  eventName: "po_received",
  timestamp: "2025-12-29T10:35:00.000Z",
  sessionId: "sess_abc123",
  tenantId: "DemoTenant",
  actorId: "user_xyz",
  objectType: "purchaseOrder",
  objectId: "po_67890",
  properties: {
    lineCount: 3,
    totalQtyReceived: 150,
    isPartialReceive: true,
    newStatus: "partially_received"
  },
  platform: "web",
  environment: "prod"
}

// Suggest-PO executed (multi-vendor)
{
  eventName: "suggest_po_executed",
  timestamp: "2025-12-29T10:40:00.000Z",
  sessionId: "sess_def456",
  tenantId: "DemoTenant",
  actorId: "user_xyz",
  properties: {
    backorderCount: 5,
    vendorCount: 2,
    draftCount: 2,
    skippedCount: 1,
    source: "backorders_list"  // vs "so_detail"
  },
  platform: "web",
  environment: "prod"
}
```

#### B) UX Events (Interaction Tracking)
**Purpose:** Track user navigation, feature discovery, and interaction patterns.

**Examples:**
```typescript
// Screen viewed (mobile)
{
  eventName: "screen_viewed",
  timestamp: "2025-12-29T10:25:00.000Z",
  sessionId: "sess_abc123",
  tenantId: "DemoTenant",
  actorId: "user_xyz",
  screen: "BackorderDetail",
  properties: {
    objectId: "bo_12345",
    referrer: "BackordersList"  // Previous screen
  },
  platform: "mobile",
  environment: "prod"
}

// Sales Order commit clicked (Sprint L — web)
{
  eventName: "SO_Commit_Clicked",
  timestamp: "2025-12-29T14:20:00.000Z",
  sessionId: "sess_def456",
  tenantId: "DemoTenant",
  actorId: "user_xyz",
  screen: "/sales-orders/so_78901",
  properties: {
    objectType: "salesOrder",
    objectId: "so_78901",
    strict: false,
    result: "success",  // or "attempt", "fail"
    shortagesCount: 0
  },
  platform: "web",
  environment: "prod"
}

// Sales Order reserve clicked (Sprint P — web)
{
  eventName: "so_reserve_clicked",
  timestamp: "2025-12-29T14:22:00.000Z",
  sessionId: "sess_def456",
  tenantId: "DemoTenant",
  actorId: "user_xyz",
  screen: "/sales-orders/so_78901",
  properties: {
    objectType: "salesOrder",
    objectId: "so_78901",
    lineCount: 2,
    result: "success",  // or "attempt", "fail"
    errorCode?: "INSUFFICIENT_AVAILABILITY"  // on fail
  },
  platform: "web",
  environment: "prod"
}

// Sales Order fulfill clicked (Sprint P — web)
{
  eventName: "so_fulfill_clicked",
  timestamp: "2025-12-29T14:23:00.000Z",
  sessionId: "sess_def456",
  tenantId: "DemoTenant",
  actorId: "user_xyz",
  screen: "/sales-orders/so_78901",
  properties: {
    objectType: "salesOrder",
    objectId: "so_78901",
    lineCount: 2,
    result: "success",  // or "attempt", "fail"
    errorCode?: "OVER_FULFILLMENT"  // on fail
  },
  platform: "web",
  environment: "prod"
}

// Purchase Order receive clicked (Sprint L — web)
{
  eventName: "PO_Receive_Clicked",
  timestamp: "2025-12-29T14:25:00.000Z",
  sessionId: "sess_ghi789",
  tenantId: "DemoTenant",
  actorId: "user_xyz",
  screen: "/purchase-orders/po_67890",
  properties: {
    objectType: "purchaseOrder",
    objectId: "po_67890",
    result: "success",  // or "attempt", "fail"
    lineCount: 3
  },
  platform: "web",
  environment: "prod"
}

// Purchase Order approve clicked (Sprint L — mobile)
{
  eventName: "PO_Approve_Clicked",
  timestamp: "2025-12-29T14:15:00.000Z",
  sessionId: "sess_jkl012",
  tenantId: "DemoTenant",
  actorId: "user_xyz",
  screen: "PurchaseOrderDetail",
  properties: {
    objectType: "purchaseOrder",
    objectId: "po_67890",
    result: "success"  // or "attempt", "fail"
  },
  platform: "mobile",
  environment: "prod"
}

// Purchase Order scan-receive submitted (Sprint L — mobile)
{
  eventName: "PO_ScanReceive_Submitted",
  timestamp: "2025-12-29T14:28:00.000Z",
  sessionId: "sess_mno345",
  tenantId: "DemoTenant",
  actorId: "user_xyz",
  screen: "PurchaseOrderDetail",
  properties: {
    objectType: "purchaseOrder",
    objectId: "po_67890",
    result: "success",  // or "attempt", "fail"
    lineCount: 5
  },
  platform: "mobile",
  environment: "prod"
}

// Button clicked (legacy example)
{
  eventName: "button_clicked",
  timestamp: "2025-12-29T10:30:00.000Z",
  sessionId: "sess_def456",
  tenantId: "DemoTenant",
  actorId: "user_xyz",
  screen: "/backorders/bo_12345",
  component: "IgnoreButton",
  properties: {
    objectId: "bo_12345"
  },
  platform: "web",
  environment: "prod"
}

// Filter applied
{
  eventName: "filter_applied",
  timestamp: "2025-12-29T10:28:00.000Z",
  sessionId: "sess_def456",
  tenantId: "DemoTenant",
  actorId: "user_xyz",
  screen: "/backorders",
  component: "VendorFilter",
  properties: {
    filterType: "vendorId",
    vendorId: "vendor_abc"  // Reference only, not vendor name
  },
  platform: "web",
  environment: "prod"
}
```

#### C) Error Events (Failure Tracking)
**Purpose:** Track client-side errors, API failures, and validation errors.

**Examples:**
```typescript
// API error (network failure)
{
  eventName: "api_error",
  timestamp: "2025-12-29T10:32:00.000Z",
  sessionId: "sess_abc123",
  tenantId: "DemoTenant",
  actorId: "user_xyz",
  screen: "BackorderDetail",
  properties: {
    endpoint: "/objects/backorderRequest/bo_12345:ignore",
    method: "POST",
    statusCode: 500,
    errorCode: "INTERNAL_SERVER_ERROR",
    requestId: "req_xyz123"  // For log correlation
  },
  platform: "mobile",
  environment: "prod"
}

// Validation error (user input)
{
  eventName: "validation_error",
  timestamp: "2025-12-29T10:33:00.000Z",
  sessionId: "sess_def456",
  tenantId: "DemoTenant",
  actorId: "user_xyz",
  screen: "/purchase-orders/po_67890",
  component: "ReceiveModal",
  properties: {
    fieldName: "deltaQty",
    errorCode: "RECEIVE_EXCEEDS_REMAINING",
    attemptedValue: 100,  // Sanitized numeric value
    maxAllowed: 50
  },
  platform: "web",
  environment: "prod"
}
```

---

### 8.4 Foundation-by-Accretion Rule (Telemetry)

**Principle:** Every sprint that adds domain behavior or UX surface area must also add telemetry instrumentation.

**Minimum Coverage per Sprint:**
1. **1–3 domain events** for new state transitions or workflows (e.g., backorder ignored, PO received).
2. **1–3 UX events** for new screens or primary user actions (e.g., screen viewed, button clicked).
3. **Error events** for any new API endpoints or validation rules (captured automatically by Sentry + error boundaries).

**Examples:**
- **Sprint J (Backorder Detail):** Added `backorder_ignored` (domain), `screen_viewed` (UX), `button_clicked` (UX).
- **Sprint I (PO Receive):** Added `po_received` (domain), `receive_modal_opened` (UX), `api_error` (automatic via Sentry).

**Guardrails:**
- **No event sprawl:** Limit to 3–5 events per feature; avoid logging every button click.
- **Event naming:** Use `snake_case` for event names (e.g., `backorder_ignored`, not `BackorderIgnored`).
- **Property discipline:** Only include properties that inform product decisions (not debugging data).

**Status:** 🟨 **Partial** — Domain events implemented for core workflows; UX events partially instrumented; full coverage planned for post-MVP.

---

### 8.5 Sentry Context Requirements (Minimum)

**All Sentry errors must include these tags/context:**

**Required Tags:**
```typescript
{
  tenantId: string;      // Always present (multi-tenant isolation)
  actorId?: string;      // User ID (if authenticated)
  environment: string;   // "dev" | "staging" | "prod"
  platform: string;      // "web" | "mobile" | "api"
}
```

**Required Context (where applicable):**
```typescript
{
  // Object context (for domain errors)
  objectType?: string;   // e.g., "backorderRequest", "purchaseOrder"
  objectId?: string;     // e.g., "bo_abc123", "po_xyz789"
  
  // Route/screen context
  route?: string;        // Web: "/backorders/bo_abc123", Mobile: "BackorderDetail"
  screen?: string;       // Mobile screen name
  
  // Request context (for API errors)
  requestId?: string;    // API Gateway request ID (from error response)
  endpoint?: string;     // e.g., "/objects/backorderRequest/bo_123:ignore"
  method?: string;       // HTTP method
}
```

**Implementation:**
- **Web:** Set Sentry context in AuthProvider (tenantId, actorId) + ErrorBoundary (route).
- **Mobile:** Set Sentry context in DevAuthBootstrap (tenantId, actorId) + navigation listener (screen).
- **API:** Lambda handler sets context from event (tenantId, actorId, requestId, route).

**Example (React Error Boundary):**
```typescript
import * as Sentry from "@sentry/react";

function ErrorBoundary({ children }: { children: React.ReactNode }) {
  const { tenantId, actorId } = useAuth();
  const location = useLocation();
  
  React.useEffect(() => {
    Sentry.setTag("tenantId", tenantId);
    Sentry.setTag("actorId", actorId || "anonymous");
    Sentry.setContext("route", { path: location.pathname });
  }, [tenantId, actorId, location]);
  
  return <Sentry.ErrorBoundary fallback={<ErrorFallback />}>{children}</Sentry.ErrorBoundary>;
}
```

**Status:** 🟨 **Partial** — Sentry integrated; minimum context implemented for backend; web/mobile context pending.

---

## Addendum — Purchasing & Receiving Foundations (Sprints XXXV–XXXIX, 2025-12-25)

- **Web purchasing vertical slice shipped:** Backorders workbench (list/filter/select/bulk ignore), suggest-PO, multi-vendor draft chooser, create-from-suggestion, and navigation into PO detail; Purchase Orders list/detail with submit/approve/receive/cancel/close gating; PO Activity feed sourced from inventory movements (per-line fetch + aggregation).
- **Status + guard correctness:** Partial receive transitions to `partially-received` (API hyphenated); Close requires `fulfilled` (API 409 otherwise); Cancel only for `draft|submitted`; Receive blocked after `closed|cancelled` with 409 `PO_STATUS_NOT_RECEIVABLE`; Vendor guard supported (FEATURE_ENFORCE_VENDOR_ROLE, non-prod override header X-Feature-Enforce-Vendor: 1) and validated via smoke.
- **Receiving fidelity:** Per-line receive payload supports `{ lineId, deltaQty, lot?, locationId? }`; lots/locations persist into inventory movements and can be queried with `GET /inventory/{itemId}/movements?refId={poId}&poLineId={lineId}`.
- **Smokes (opt-in proofs):** `smoke:close-the-loop`, `smoke:close-the-loop-multi-vendor`, `smoke:close-the-loop-partial-receive`, `smoke:vendor-guard-enforced`, `smoke:po-receive-after-close-guard`, `smoke:po-receive-after-cancel-guard`, `smoke:po-receive-lot-location-assertions`.

**End of Report**

</details>
