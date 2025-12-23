# Sprint XXVI — Tier 1–4 Foundations Report
**Generated:** 2025-12-23  
**Scope:** Mobile + Web client foundations for production-ready MVP

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

**Status:** ⚠️ **Localhost fallback exists** — Defaults to `http://localhost:3000` if `MBAPP_API_BASE` unset  
**Auth:** Uses `MBAPP_BEARER` env var or calls `/auth/dev-login` to obtain token

---

## 2. Mobile UI Inventory (apps/mobile/src/screens)

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
| **Workspaces** | ✅ WorkspaceHubScreen (hub only) | ❌ Missing | ❌ Missing | ❌ N/A | **Stub only** — No CRUD |

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

## 3. Web UI Inventory (apps/web/src)

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

## 4. API Endpoint Mapping (Tier 1–4 MVP)

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
**Web gaps:** All screens  
**API complete:** ✅

---

### 4.7 Views & Workspaces (Sprint III)

| Endpoint | Method | Status | Mobile | Web | MVP Need |
|----------|--------|--------|--------|-----|----------|
| `/views` | GET | ✅ | ❌ | ❌ | **Required for saved filters** |
| `/views` | POST | ✅ | ❌ | ❌ | **Required** |
| `/views/{id}` | GET | ✅ | ❌ | ❌ | **Required** |
| `/views/{id}` | PUT | ✅ | ❌ | ❌ | **Required** |
| `/views/{id}` | DELETE | ✅ | ❌ | ❌ | Optional |
| `/workspaces` | GET | ✅ | ❌ | ❌ | Optional (nice-to-have) |
| `/workspaces` | POST | ✅ | ❌ | ❌ | Optional |
| `/workspaces/{id}` | GET | ✅ | ❌ | ❌ | Optional |

**Mobile gaps:** Complete Views/Workspaces UI (API exists, no screens)  
**Web gaps:** All screens  
**API complete:** ✅

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
- [ ] Update [docs/MBapp-Working.md](../docs/MBapp-Working.md) with Sprint XXVI summary
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

**End of Report**
