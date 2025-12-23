# Sprint XXVII — Products + Inventory Vertical Slice Plan
**Generated:** 2025-12-23  
**Based on:** SPRINT_XXVI_FOUNDATIONS_REPORT.md + baseline validation  
**Scope:** Products CRUD + Inventory read-only (web + mobile) + smoke coverage

---

## 1. Sprint Context & Rationale

### Current Baseline (Post-Sprint XXVI)
- ✅ Web foundations complete: http.ts, AuthProvider, Layout, Router, ErrorBoundary
- ✅ Parties CRUD on web (list/detail/create/edit) + mobile create/edit screens
- ✅ AWS-only smoke enforcement (no localhost fallback)
- ✅ All typechecks passing; 39/39 smoke tests passing
- ✅ Git clean on `feat/tier1-sprint-XXVI`

### Roadmap Alignment (Tier 1.2 — Commerce Core)
From [MBapp-Roadmap-Master-v10.0.md](MBapp-Roadmap-Master-v10.0.md):
- **Tier 1.2**: Commerce Core — Products + Inventory at MVP (read + write for Products, read-only for Inventory)
- **Recommended Sequence**: Parties (✅ Sprint XXVI) → Products + Inventory (Sprint XXVII) → Sales Orders (Sprint XXVIII)

### Why Products + Inventory for Sprint XXVII?
1. **API fully mature** — All endpoints complete, tested, documented
2. **Mobile partially ready** — List/detail screens exist; only missing create/edit forms
3. **Web foundation established** — Parties pattern provides template for forms
4. **Low action complexity** — No complex workflows (unlike PO/SO); pure CRUD
5. **Natural pairing** — Products are referenced in Inventory; creates nice UX flow (see product → check inventory)

---

## 2. API Endpoint Mapping (Products + Inventory)

### 2.1 Products Endpoints

| Endpoint | Method | Status | Mobile | Web | Sprint XXVII |
|----------|--------|--------|--------|-----|-----|
| `/objects/product` | GET | ✅ | ✅ List | ⬜ New | **Add List page** |
| `/objects/product` | POST | ✅ | ⬜ No form | ⬜ New | **Add Create form** |
| `/objects/product/{id}` | GET | ✅ | ✅ Detail | ⬜ New | **Add Detail page** |
| `/objects/product/{id}` | PUT | ✅ | ⬜ No form | ⬜ New | **Add Edit form** |
| `/objects/product/search` | POST | ✅ | ⬜ Optional | ⬜ Optional | Optional (pagination enough) |

**API Schema (from [apps/api/src/db.ts](../apps/api/src/db.ts#L45-L54)):**
```typescript
type Product = {
  id: string;
  sku: string;
  name: string;
  type: "good" | "service";
  uom: string;
  price: number;
  taxCode?: string;
  tags?: any;
  createdAt?: number;
  updatedAt?: number;
};
```

**Required fields:** `name`, `sku`, `type` (good|service), `uom`, `price`  
**Optional fields:** `taxCode`, `tags`

---

### 2.2 Inventory Endpoints

| Endpoint | Method | Status | Mobile | Web | Sprint XXVII |
|----------|--------|--------|--------|-----|-----|
| `/objects/inventoryItem` | GET | ✅ | ✅ List | ⬜ New | **Add List page** |
| `/objects/inventoryItem/{id}` | GET | ✅ | ✅ Detail | ⬜ New | **Add Detail page** |
| `/inventory/{id}/onhand` | GET | ✅ | ✅ Used | ⬜ New | **Show in Detail page** |
| `/inventory/{id}/movements` | GET | ✅ | ✅ Used | ⬜ New | **Show in Detail page** |

**Inventory Item Schema:**
```typescript
type InventoryItem = {
  id: string;
  type: "inventoryItem";
  itemId: string;              // references product
  productId?: string;
  tenantId: string;
  createdAt?: string;
  updatedAt?: string;
};
```

**OnHand Response:**
```typescript
type OnHand = {
  itemId: string;
  onHand: number;
  reserved: number;
  committed?: number;
};
```

---

## 3. Web Pages & Components to Create

### 3.1 Products Module

**File Structure:**
```
apps/web/src/pages/
  ProductsListPage.tsx        (List all products with search/pagination)
  ProductDetailPage.tsx       (Read-only product details)
  CreateProductPage.tsx       (Form to create new product)
  EditProductPage.tsx         (Form to edit existing product)

apps/web/src/components/
  ProductForm.tsx             (Reusable create/edit form; mirrors PartyForm pattern)
```

#### ProductsListPage.tsx
- **Purpose:** Display paginated product list
- **Features:**
  - GET /objects/product with pagination
  - Search by `q` param (name/SKU contains)
  - Click row → navigate to DetailPage
  - "Create Product" button → navigate to CreateProductPage
  - Display columns: SKU, Name, Type (good/service), UOM, Price
- **Error handling:** Show error toast on API failure
- **Loading state:** Skeleton or spinner during fetch

#### ProductDetailPage.tsx
- **Purpose:** View single product details
- **Features:**
  - GET /objects/product/{id}
  - Display all fields (SKU, Name, Type, UOM, Price, TaxCode, Tags)
  - "Edit" button → navigate to EditProductPage
  - "Delete" button (optional, with confirmation)
  - Back button → navigate to ListPage
- **Error handling:** Show error if product not found (404)

#### CreateProductPage.tsx
- **Purpose:** Form to create new product
- **Composition:** Renders ProductForm with `mode="create"`
- **Features:**
  - On success: toast "Product created"; navigate to DetailPage
  - On error: show form-level error + field-level errors
  - "Cancel" button → go back to ListPage

#### EditProductPage.tsx
- **Purpose:** Form to edit existing product
- **Composition:** Renders ProductForm with `mode="edit"` + initial values
- **Features:**
  - Load product on mount via `useEffect`
  - On success: toast "Product updated"; navigate to DetailPage
  - On error: show form-level error
  - "Cancel" button → go back to DetailPage

#### ProductForm.tsx (Component)
- **Purpose:** Reusable form for create/edit (mirrors PartyForm.tsx pattern)
- **Props:**
  ```typescript
  interface ProductFormProps {
    product?: Product;
    onSubmit: (data: Partial<Product>) => Promise<void>;
    isLoading?: boolean;
  }
  ```
- **Fields:**
  - `name` (required, text, 1-120 chars)
  - `sku` (required, text, alphanumeric + dash)
  - `type` (required, select: good|service)
  - `uom` (required, text, default "ea")
  - `price` (required, number, ≥0)
  - `taxCode` (optional, text)
  - `tags` (optional, JSON or tag input)
- **Validation:** Client-side via Zod schema matching API guards
- **Buttons:** Submit (with loading state), Cancel

---

### 3.2 Inventory Module

**File Structure:**
```
apps/web/src/pages/
  InventoryListPage.tsx       (List all inventory items, read-only)
  InventoryDetailPage.tsx     (Show item + onHand + movements)

apps/web/src/components/
  (No form needed; read-only for Sprint XXVII)
```

#### InventoryListPage.tsx
- **Purpose:** Display paginated inventory items
- **Features:**
  - GET /objects/inventoryItem with pagination
  - Search by `q` param (itemId/productId contains)
  - Click row → navigate to DetailPage
  - Display columns: Item ID, Product, OnHand, Reserved
- **Note:** "Create" button NOT included (inventory items typically created via purchase receive or system seeding)

#### InventoryDetailPage.tsx
- **Purpose:** View inventory item details + onHand + movements
- **Features:**
  - GET /objects/inventoryItem/{id}
  - GET /inventory/{id}/onhand (show onHand, reserved, committed)
  - GET /inventory/{id}/movements (paginated list of movements)
  - Display movements with: action (adjust/reserve/commit/etc), qty, timestamp
  - "Back" button → navigate to ListPage
- **Error handling:** Show error if item not found
- **Movements table:** Sortable by timestamp (newest first)

---

### 3.3 Navigation Updates

**Update [apps/web/src/components/Layout.tsx](../apps/web/src/components/Layout.tsx):**
- Add nav links: Products, Inventory (along with existing Parties, Home)
- Format: `<NavLink to="/products">Products</NavLink>`

**Update [apps/web/src/App.tsx](../apps/web/src/App.tsx) Router config:**
```typescript
const routes = [
  { path: "/", element: <HomePage /> },
  // Parties (Sprint XXVI)
  { path: "/parties", element: <PartiesListPage /> },
  { path: "/parties/:id", element: <PartyDetailPage /> },
  { path: "/parties/create", element: <CreatePartyPage /> },
  { path: "/parties/:id/edit", element: <EditPartyPage /> },
  // Products (Sprint XXVII)
  { path: "/products", element: <ProductsListPage /> },
  { path: "/products/:id", element: <ProductDetailPage /> },
  { path: "/products/create", element: <CreateProductPage /> },
  { path: "/products/:id/edit", element: <EditProductPage /> },
  // Inventory (Sprint XXVII)
  { path: "/inventory", element: <InventoryListPage /> },
  { path: "/inventory/:id", element: <InventoryDetailPage /> },
];
```

---

## 4. Mobile Screens & Components to Create

### 4.1 Products Module

**File Structure:**
```
apps/mobile/src/screens/
  CreateProductScreen.tsx     (Form to create product)
  EditProductScreen.tsx       (Form to edit product)

apps/mobile/src/features/products/
  ProductForm.tsx             (Reusable form component, mirrors web)
```

#### CreateProductScreen.tsx
- **Purpose:** Form to create new product (on modal stack or push)
- **Features:**
  - Render ProductForm with `onSubmit` calling `createProduct()`
  - On success: toast "✓ Product created"; navigate back to list
  - On error: show error toast + form errors
- **Navigation:** Modal or push depending on existing pattern

#### EditProductScreen.tsx
- **Purpose:** Form to edit existing product
- **Features:**
  - Route param: `productId`
  - Load product on mount via `useEffect` → set form initial values
  - Render ProductForm with `onSubmit` calling `updateProduct()`
  - On success: toast "✓ Product updated"; navigate back to list
  - On error: show error toast

#### ProductForm.tsx (Mobile Component)
- **Purpose:** Reusable form (mirrors [apps/mobile/src/screens/CreatePartyScreen.tsx](../apps/mobile/src/screens/CreatePartyScreen.tsx) pattern if exists)
- **Props:**
  ```typescript
  interface ProductFormProps {
    product?: Product;
    onSubmit: (data: Partial<Product>) => Promise<void>;
    isLoading?: boolean;
  }
  ```
- **Fields:** Same as web (name, sku, type, uom, price, taxCode, tags)
- **UI:** Native form inputs, text inputs with validation feedback, dropdown for `type`, numeric input for `price`
- **Buttons:** Submit, Cancel

#### ProductsListScreen.tsx (Update Existing)
- **Current:** Displays list, has search filter
- **Add:** "Create Product" button → navigate to CreateProductScreen
- **Add:** Edit button on each row (optional, via long-press or swipe) → navigate to EditProductScreen

#### ProductDetailScreen.tsx (Update Existing)
- **Current:** Displays product details
- **Add:** Edit button → navigate to EditProductScreen
- **Add:** Delete button (optional, with confirmation)

---

### 4.2 Inventory Module

**No create/edit screens needed for Sprint XXVII** (read-only MVP)

**InventoryListScreen.tsx (Verify existing):**
- Should show: itemId, product reference, onHand (via separate call)
- Confirm search by itemId/product works

**InventoryDetailScreen.tsx (Verify existing):**
- Should show: inventory item details, onHand stats, movements list
- Confirm all GET calls work

---

### 4.3 Navigation Updates

**Update [apps/mobile/src/navigation/RootStack.tsx](../apps/mobile/src/navigation/RootStack.tsx):**
```typescript
// In Tab navigator or stack, add:
Screen
  name="CreateProductScreen"
  component={CreateProductScreen}
  options={{ title: "Create Product" }}
/>
<Stack.Screen
  name="EditProductScreen"
  component={EditProductScreen}
  options={{ title: "Edit Product" }}
/>
```

---

## 5. Smoke Tests to Add

### 5.1 smoke:products:crud (New)

**Test Flow:**
1. **Create** POST /objects/product with valid data
2. **Verify** GET /objects/product/{id} returns created product
3. **Update** PUT /objects/product/{id} with patch (e.g., price change)
4. **Verify** GET returns updated price
5. **Search** POST /objects/product/search with filter
6. **Verify** search results contain updated product
7. **Delete** DELETE /objects/product/{id}
8. **Verify** GET returns 404

**Location:** Add to [ops/smoke/smoke.mjs](../ops/smoke/smoke.mjs) after smoke:parties:crud  
**Pattern:** Match smoke:parties:crud pattern (Idempotency-Key, bearer auth, eventual consistency retry)

**Pseudo-code:**
```javascript
export async function smoke_products_crud() {
  const ikey = idemKey();
  const product = { 
    name: `Test Product ${ikey}`,
    sku: `SKU-${ikey}`,
    type: "good",
    uom: "ea",
    price: 99.99
  };
  
  // CREATE
  const created = await apiFetch("POST", "/objects/product", product, ikey);
  assert(created.id, "Create should return id");
  
  // GET (with retry for eventual consistency)
  let got = null;
  for (let i = 0; i < 5; i++) {
    got = await apiFetch("GET", `/objects/product/${created.id}`);
    if (got.id) break;
    await delay(200);
  }
  assert(got?.id, "Get should return created product");
  assert(got.name === product.name, "Name should match");
  
  // UPDATE
  const updated = await apiFetch("PUT", `/objects/product/${created.id}`, 
    { price: 149.99 }, ikey);
  assert(updated.price === 149.99, "Update should change price");
  
  // SEARCH
  const search = await apiFetch("POST", "/objects/product/search", 
    { q: ikey });
  assert(search.items?.length > 0, "Search should find product");
  
  console.log("✓ smoke:products:crud passed");
}
```

---

### 5.2 smoke:inventory:read (Optional, or rename existing)

**Test Flow:**
1. **List** GET /objects/inventoryItem (paginated)
2. **Detail** GET /objects/inventoryItem/{id}
3. **OnHand** GET /inventory/{id}/onhand
4. **Movements** GET /inventory/{id}/movements

**Note:** If inventory items are auto-created during tests (via products), this test may already exist or need minimal changes.

---

## 6. Documentation Updates

### 6.1 [docs/MBapp-Working.md](../docs/MBapp-Working.md)

**Add entry under "Sprint XXVII":**
```markdown
## Sprint XXVII — Products + Inventory CRUD Vertical Slice

**Status:** In progress  
**Scope:** Products CRUD on web + mobile; Inventory read-only on web; smoke coverage

### Deliverables
- Web: ProductsListPage, ProductDetailPage, CreateProductPage, EditProductPage, ProductForm
- Web: InventoryListPage, InventoryDetailPage (read-only)
- Mobile: CreateProductScreen, EditProductScreen, ProductForm
- Mobile: Updated ProductsListScreen + ProductDetailScreen with edit/delete buttons
- Smoke: smoke:products:crud (create→get→update→search→delete pattern)
- Layout nav: Added Products + Inventory links

### Files Changed
- apps/web/src/pages/Products*.tsx (4 new files)
- apps/web/src/components/ProductForm.tsx (new)
- apps/web/src/pages/Inventory*.tsx (2 new files)
- apps/web/src/components/Layout.tsx (updated nav)
- apps/web/src/App.tsx (updated router)
- apps/mobile/src/screens/Create|Edit ProductScreen.tsx (2 new files)
- apps/mobile/src/features/products/ProductForm.tsx (new)
- apps/mobile/src/screens/Products*.tsx (updated with buttons)
- apps/mobile/src/navigation/RootStack.tsx (updated routes)
- ops/smoke/smoke.mjs (added smoke:products:crud)
- ops/ci-smokes.json (updated flows)

### Known Gaps
- Inventory create/edit deferred to Sprint XXVIII
- Product search via search endpoint optional (list pagination sufficient)
- Inventory movements audit trail read-only (adjust deferred)
```

---

### 6.2 [docs/smoke-coverage.md](../docs/smoke-coverage.md)

**Add row to "Health & Core" section:**
```markdown
| smoke:products:crud | ✅ | POST /objects/product (create), GET (get), PUT (update), POST (search), DELETE | 5 calls | Pattern follows parties:crud |
```

**Update** "Totals" (was 39, now 40 tests; adjust flow counts if applicable)

---

### 6.3 [docs/MBapp-Backend-Guide.md](../docs/MBapp-Backend-Guide.md)

**Add "Products & Inventory" section under "Tier 1.2 — Commerce Core":**
```markdown
### Products Endpoints

**POST /objects/product**
```json
{
  "name": "Widget",
  "sku": "WIDGET-001",
  "type": "good",           // "good" or "service"
  "uom": "ea",              // unit of measure
  "price": 99.99,
  "taxCode": "TAX-001",     // optional
  "tags": {}                // optional
}
```

**GET /objects/product**
- Pagination via `next` cursor
- Search via `q` param (name/SKU contains)

**GET /objects/product/{id}**
- Returns full product object

**PUT /objects/product/{id}**
- Partial update; supports field patch (name, sku, price, etc.)

### Inventory Endpoints

**GET /objects/inventoryItem**
- Returns all inventory items for tenant
- Supports pagination + `q` search

**GET /objects/inventoryItem/{id}**
- Returns single inventory item

**GET /inventory/{id}/onhand**
- Returns: `{ itemId, onHand, reserved, committed }`

**GET /inventory/{id}/movements**
- Returns paginated movements (action: adjust|reserve|commit|fulfill|receive|etc, qty, timestamp)
```

---

## 7. Acceptance Criteria

### 7.1 Code Quality
- [ ] `npm run typecheck` passes for all apps (api, mobile, web)
- [ ] No lint errors in web/mobile pages + components
- [ ] All new functions have JSDoc comments

### 7.2 Functionality (Web)
- [ ] **ProductsListPage:** Load, paginate, search by SKU/name, click → detail
- [ ] **ProductDetailPage:** Load product, "Edit" button works, "Delete" optional
- [ ] **CreateProductPage:** Submit form → API create → toast → navigate to detail
- [ ] **EditProductPage:** Load product, edit field, submit → API update → toast
- [ ] **ProductForm:** Client-side validation (name required, sku required, price ≥0)
- [ ] **InventoryListPage:** Load, paginate, search by itemId
- [ ] **InventoryDetailPage:** Load item, show onHand + movements, paginate movements
- [ ] **Layout:** Nav links visible and functional (Products, Inventory)

### 7.3 Functionality (Mobile)
- [ ] **CreateProductScreen:** Form submits → API create → toast → back to list
- [ ] **EditProductScreen:** Load product → edit → submit → API update → toast
- [ ] **ProductForm:** Validation matches web form
- [ ] **ProductsListScreen:** "Create" button visible and functional
- [ ] **ProductDetailScreen:** "Edit" button visible and functional
- [ ] **Navigation:** Screens properly registered in RootStack

### 7.4 Smoke Tests
- [ ] **smoke:products:crud** creates product → verifies via GET → updates → verifies → searches → deletes
- [ ] All 40/40 smokes passing (smoke:products:crud + smoke:close-the-loop)
- [ ] Test uses Idempotency-Key to prevent duplicates
- [ ] Test uses eventual consistency retry (5×200ms) for read verification

### 7.5 Documentation
- [ ] [docs/MBapp-Working.md](../docs/MBapp-Working.md) updated with Sprint XXVII entry
- [ ] [docs/smoke-coverage.md](../docs/smoke-coverage.md) includes smoke:products:crud row
- [ ] [docs/MBapp-Backend-Guide.md](../docs/MBapp-Backend-Guide.md) documents Products/Inventory endpoints + field schemas

---

## 8. File-by-File Task Checklist

### Web Pages (apps/web/src)

- [ ] **pages/ProductsListPage.tsx** — Component with list, search, pagination, "Create" button
- [ ] **pages/ProductDetailPage.tsx** — Component with product details, "Edit" button
- [ ] **pages/CreateProductPage.tsx** — Wrapper component calling ProductForm in create mode
- [ ] **pages/EditProductPage.tsx** — Wrapper component calling ProductForm in edit mode
- [ ] **components/ProductForm.tsx** — Reusable form with validation; mirrors PartyForm.tsx
- [ ] **pages/InventoryListPage.tsx** — List inventory items with search + pagination
- [ ] **pages/InventoryDetailPage.tsx** — Show item + onHand + movements
- [ ] **components/Layout.tsx** — Add nav links for Products + Inventory
- [ ] **App.tsx** — Add 6 product routes + 2 inventory routes to router config

### Mobile Screens & Navigation (apps/mobile/src)

- [ ] **screens/CreateProductScreen.tsx** — Form screen for new product
- [ ] **screens/EditProductScreen.tsx** — Form screen for existing product
- [ ] **features/products/ProductForm.tsx** — Reusable form component
- [ ] **screens/ProductsListScreen.tsx** — Update with "Create" button
- [ ] **screens/ProductDetailScreen.tsx** — Update with "Edit" + optional "Delete" button
- [ ] **navigation/RootStack.tsx** — Register CreateProductScreen + EditProductScreen

### Smoke Tests (ops/smoke)

- [ ] **smoke.mjs** — Add smoke_products_crud() function
- [ ] **smoke.mjs** — Wire function into exports (near smoke_parties_crud)
- [ ] **ci-smokes.json** — Add "smoke:products:crud" to flows array

### Documentation (docs/)

- [ ] **MBapp-Working.md** — Add Sprint XXVII entry with deliverables + file list
- [ ] **smoke-coverage.md** — Add smoke:products:crud row to coverage table
- [ ] **MBapp-Backend-Guide.md** — Add Products/Inventory endpoint documentation

---

## 9. Risks & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|-----------|
| Product SKU uniqueness constraint | Medium | CRUD smoke fails on duplicate SKU | Use idem key + random suffix in smoke test |
| Inventory item orphaned (no product) | Low | Detail page may fail to load product ref | Add optional product lookup; show "Unknown" fallback |
| Movements list pagination cursor invalid | Low | Detail page movements don't load | Add error boundary; show "Unable to load movements" |
| Mobile form validation incomplete | Medium | API rejects invalid data | Mirror web validation exactly; test with edge cases (0 price, empty sku) |
| Web/Mobile form field mismatch | Medium | One client accepts data other rejects | Use shared validation schema (Zod) if possible; document required vs optional |

---

## 10. Not Included (Deferred)

- **Inventory create/edit forms** — Deferred to Sprint XXVIII (complex: itemId ↔ product mapping)
- **Product delete UI** — Optional; suggest warning dialog if implemented
- **Bulk product import** — Deferred to Sprint XXIX (CSV upload)
- **Product search via /objects/product/search** — Optional; pagination sufficient
- **Inventory adjust UI** — Deferred to Sprint XXVIII (requires movement action selection)
- **Views/Workspaces** — Separate sprint (Tier 2.1)

---

## 11. Sprint XXVII Estimated Effort

| Component | Estimate | Notes |
|-----------|----------|-------|
| Web products pages + form | 2–3 days | Follows Parties pattern; 4 pages + 1 form |
| Web inventory pages | 1–2 days | Read-only; lighter than products |
| Mobile product screens + form | 1.5–2 days | Fewer pages than web; native UI simpler |
| Smoke test (products:crud) | 0.5–1 day | Template existing from parties:crud |
| Documentation + testing | 1 day | Update 3 docs + run full smoke suite |
| **Total** | **6–9 days** | 1–1.5 week sprint |

---

## 12. Definition of Done

✅ **All acceptance criteria met (Section 7)**  
✅ **All file checklist items completed (Section 8)**  
✅ **40/40 smoke tests passing** (including new smoke:products:crud)  
✅ **All docs updated** (MBapp-Working, smoke-coverage, MBapp-Backend-Guide)  
✅ **Pull request ready for review** (no bearer token leaks, clean git history)  
✅ **No TODOs or FIXMEs in delivered code** (except marked as "Future: Sprint XXX")

---

**End of Sprint XXVII Plan Document**
