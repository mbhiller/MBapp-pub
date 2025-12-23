# Sprint XXVII Kickoff — Baseline Validation Report

**Generated:** 2025-12-23  
**Status:** Ready for planning (no implementation yet)

---

## Executive Summary

**Baseline Health:** ✅ **GREEN**
- All 39/39 smoke tests passing against AWS
- All three applications (api, mobile, web) pass TypeScript compilation
- Git working tree clean; all Sprint XXVI changes committed
- Web Parties CRUD fully functional; mobile Parties create/edit ready
- AWS-only enforcement in place (no localhost fallback)

**Recommended Sprint XXVII:** Products + Inventory vertical slice
- **Why:** API fully mature, mobile partially ready, web pattern established by Parties
- **Scope:** Products CRUD (web+mobile) + Inventory read-only (web) + smoke coverage
- **Estimated effort:** 6–9 days

---

## Section 1: Repo Health Baseline

### 1.1 Git Status
```
Branch: feat/tier1-sprint-XXVI
Status: Clean (all changes committed)
Files modified: 0
Files untracked: 0
```

### 1.2 TypeScript Compilation

| App | Command | Result | Details |
|-----|---------|--------|---------|
| api | `npm run typecheck` | ✅ PASS | 0 errors, 0 warnings |
| mobile | `npm run typecheck` | ✅ PASS | 0 errors, 0 warnings |
| web | `npm run typecheck` | ✅ PASS | 0 errors, 0 warnings |

### 1.3 Smoke Test Status

**Test Run:** ops/tools/run-ci-smokes.mjs  
**Result:** ✅ **All flows passed**  
**Count:** 39/39 tests passing

**Flows included:**
- ✅ smoke:parties:crud (NEW in Sprint XXVI)
- ✅ smoke:close-the-loop (existing; 38 tests)

**Environment:** AWS API Gateway (https://ki8kgivz1f.execute-api.us-east-1.amazonaws.com)

---

## Section 2: API Endpoint Maturity Matrix

### Tier 1 — Foundation
| Module | Create | Read | Update | Delete | Smoke Test | Sprint |
|--------|--------|------|--------|--------|-----------|--------|
| **Party** | ✅ | ✅ | ✅ | ✅ | ✅ parties:crud | XXVI |
| **Product** | ✅ | ✅ | ✅ | ✅ | ⬜ (deferred) | XXVII |
| **Inventory** | ✅ | ✅ | ✅ | ✅ | ✅ (via movements) | XXVII |

### Tier 2 — Commerce Core
| Module | POST | GET | PUT | Smoke | Status |
|--------|------|-----|-----|-------|--------|
| **Sales Order** | ✅ | ✅ | ✅ | ✅ | Mobile complete; web pending |
| **Purchase Order** | ✅ | ✅ | ✅ | ✅ | Mobile partial; web pending |
| **Backorder Request** | ✅ | ✅ | ✅ | ✅ | Mobile partial; web pending |

### Tier 3 — Advanced
| Module | Status | Notes |
|--------|--------|-------|
| **Views** | ✅ Endpoints exist | Screens missing (web + mobile) |
| **Workspaces** | ✅ Endpoints exist | Screens missing (web + mobile) |
| **Events** | ✅ Endpoints exist | Mobile screens exist (feature-flagged) |
| **Registrations** | ✅ Endpoints exist | Mobile screens exist (read-only) |
| **Reservations** | ✅ Endpoints exist | Mobile screens partial (create exists) |
| **Resources** | ✅ Endpoints exist | Mobile screens exist (read-only) |
| **Routing** | ✅ Endpoints exist | Mobile screens partial |

---

## Section 3: Client UI Inventory

### 3.1 Web Client (apps/web)

**Overall Status:** ⚠️ **Early stage** (Parties complete, others stub)

| Module | Pages | Status | Sprint |
|--------|-------|--------|--------|
| **Parties** | List, Detail, Create, Edit | ✅ Complete | XXVI |
| **Products** | ⬜ None | ⬜ Missing | XXVII |
| **Inventory** | ⬜ None | ⬜ Missing | XXVII |
| **Sales Orders** | ⬜ None | ⬜ Missing | XXVIII |
| **Purchase Orders** | ⬜ None | ⬜ Missing | XXVIII |
| **All others** | ⬜ None | ⬜ Missing | TBD |

**Foundations in place:**
- ✅ React Router v6.28 (router + navigation)
- ✅ AuthProvider (bearer token context)
- ✅ Layout (header + nav + content area)
- ✅ http.ts (apiFetch wrapper with auth headers)
- ✅ ErrorBoundary (global error handling)
- ✅ PartyForm (reusable form pattern)

---

### 3.2 Mobile Client (apps/mobile)

**Overall Status:** 🟨 **Medium coverage** (screens exist, forms mostly missing)

| Module | List | Detail | Create | Edit | Smoke | Status |
|--------|------|--------|--------|------|-------|--------|
| **Parties** | ✅ | ✅ | ⬜ | ⬜ | ✅ | Needs create/edit forms |
| **Products** | ✅ | ✅ | ⬜ | ⬜ | 🟨 | Needs create/edit forms |
| **Inventory** | ✅ | ✅ | ⬜ | ⬜ | ✅ | Needs create/edit forms (read-only MVP ok) |
| **Sales Orders** | ✅ | ✅ | ✅ (draft) | ⬜ | ✅ | Draft create exists; line editing missing |
| **Purchase Orders** | ✅ | ✅ | ⬜ | ⬜ | ✅ | Needs create form; receive line modal exists |
| **Backorders** | ✅ | ⬜ | ⬜ | ⬜ | ✅ | Needs detail screen + actions |
| **Events** | ✅ | ✅ | ⬜ | ⬜ | ✅ | Feature-flagged; seed button in dev |
| **Registrations** | ✅ | ✅ | ⬜ | ⬜ | ✅ | Feature-flagged OFF by default |
| **Reservations** | ✅ | ✅ | ✅ | ⬜ | ✅ | Create modal exists; edit missing |
| **Resources** | ✅ | ✅ | ⬜ | ⬜ | ✅ | Read-only |
| **Route Plans** | ✅ | ✅ | ✅ | ⬜ | 🟨 | Create exists; edit missing |
| **Workspaces** | ⬜ (hub stub) | ⬜ | ⬜ | ⬜ | ✅ | No CRUD UI |
| **Views** | ⬜ | ⬜ | ⬜ | ⬜ | 🟨 | Endpoints exist; no screens |

---

## Section 4: API Schema Quick Reference

### Product Fields
```typescript
{
  id: string;
  sku: string;              // Required; unique
  name: string;             // Required
  type: "good" | "service"; // Required
  uom: string;              // Required; unit of measure
  price: number;            // Required; ≥0
  taxCode?: string;         // Optional
  tags?: any;               // Optional
  createdAt?: string;
  updatedAt?: string;
}
```

**Endpoints:**
- POST /objects/product
- GET /objects/product (paginated)
- GET /objects/product/{id}
- PUT /objects/product/{id}
- DELETE /objects/product/{id}
- POST /objects/product/search (optional)

### Inventory Item Fields
```typescript
{
  id: string;
  type: "inventoryItem";
  itemId: string;       // Unique per tenant
  productId?: string;   // Reference to product
  tenantId: string;
  createdAt?: string;
  updatedAt?: string;
}
```

**Related endpoints:**
- GET /objects/inventoryItem (paginated)
- GET /objects/inventoryItem/{id}
- GET /inventory/{id}/onhand → { itemId, onHand, reserved, committed }
- GET /inventory/{id}/movements (paginated)

---

## Section 5: Sprint XXVII Recommendation

### 5.1 Proposed Scope

**Products + Inventory vertical slice:**
- **Web:** Products CRUD (list/detail/create/edit) + Inventory read-only (list/detail)
- **Mobile:** Products CRUD forms (create/edit screens) + Inventory unchanged (read-only ok)
- **Smoke:** smoke:products:crud (full CRUD pattern like parties:crud)
- **Docs:** Update MBapp-Working, smoke-coverage, MBapp-Backend-Guide

### 5.2 Why This Slice?

✅ **API fully mature** — All endpoints complete + tested  
✅ **Mobile partially ready** — List/detail screens exist; only forms missing  
✅ **Web pattern established** — Parties CRUD provides exact template  
✅ **Low complexity** — No complex workflows; pure CRUD  
✅ **Natural UX flow** — Products → Inventory onhand makes sense together  
✅ **Follows roadmap** — Tier 1.2 (Commerce Core) sequence  

### 5.3 Estimated Effort

| Task | Days | Notes |
|------|------|-------|
| Web products pages (5 files) | 2–3 | Follows Parties pattern |
| Web inventory pages (2 files) | 1–2 | Read-only; simpler |
| Mobile product screens (3 files) | 1.5–2 | Fewer screens than web |
| Smoke test | 0.5–1 | Template from parties:crud |
| Docs + testing | 0.5–1 | 3 docs + smoke suite |
| **Total** | **6–9 days** | 1–1.5 week sprint |

### 5.4 Deliverables Checklist

- [ ] Web: ProductsListPage, ProductDetailPage, CreateProductPage, EditProductPage
- [ ] Web: ProductForm (reusable component)
- [ ] Web: InventoryListPage, InventoryDetailPage
- [ ] Web: Layout + App.tsx router updates
- [ ] Mobile: CreateProductScreen, EditProductScreen, ProductForm
- [ ] Mobile: ProductsListScreen + ProductDetailScreen button updates
- [ ] Mobile: Navigation route registration
- [ ] Smoke: smoke:products:crud test (full CRUD flow)
- [ ] Smoke: ops/ci-smokes.json updated with new smoke
- [ ] Docs: MBapp-Working.md entry for Sprint XXVII
- [ ] Docs: smoke-coverage.md row for products:crud
- [ ] Docs: MBapp-Backend-Guide.md Products/Inventory section

---

## Section 6: Alternative Sprints (Not Recommended)

### Option A: Sales Orders
- **Pros:** Mobile already has create draft; could add web quickly
- **Cons:** Complex line-item editing; would defer until after Inventory
- **Verdict:** Defer to Sprint XXVIII (after Products/Inventory foundation)

### Option B: Purchase Orders + Backorders Loop
- **Pros:** Closes purchasing end-to-end
- **Cons:** Complex line-item editing + SKU locks; medium complexity
- **Verdict:** Defer to Sprint XXIX (after Products/Inventory + Sales Orders)

### Option C: Views/Workspaces
- **Pros:** Tier 2.1; enables saved filters and dashboards
- **Cons:** UI design needed; lower priority than core commerce modules
- **Verdict:** Defer to Sprint XXX (after core CRUD modules complete)

---

## Section 7: Known Constraints & Notes

### Constraint: Product SKU Uniqueness
- **Issue:** API enforces SKU uniqueness (via GSI2)
- **Mitigation:** Smoke test uses idem key + random suffix to avoid collisions
- **Testing:** smoke:products:crud must use unique SKU on each run

### Constraint: Inventory Item ↔ Product Relationship
- **Issue:** Inventory items reference products; missing product creates orphans
- **Mitigation:** For Sprint XXVII, display "Unknown product" fallback; add validation in Sprint XXVIII
- **Testing:** Inventory detail page should handle missing product gracefully

### Constraint: Mobile Form Validation
- **Issue:** Mobile and web validation must match exactly
- **Solution:** Use shared Zod schemas if possible; document required fields in API guide
- **Testing:** Test edge cases (0 price, empty SKU, special chars in name)

### Feature Flags in Sprint XXVII
- **Status:** No new flags needed (existing feature flags for Events/Registrations/Reservations unchanged)
- **Note:** Parties/Products/Inventory enabled by default (no flag gating)

---

## Section 8: Known Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|-----------|
| Product SKU collision in smoke test | Medium | Test flakes | Use UUID suffix in test data |
| Inventory movements pagination cursor | Low | Detail page fails | Add error boundary + fallback UI |
| Mobile form validation mismatch | Medium | UX inconsistency | Mirror web validation exactly; test both |
| Web routes conflict with Parties routes | Low | Runtime errors | Use unique path patterns (/products, /inventory) |
| Smoke test bearer token expiration | Low | CI failure | Run test in short window; add token refresh logic if needed |

---

## Section 9: Post-Sprint Sequence (High Level)

| Sprint | Scope | Why | Status |
|--------|-------|-----|--------|
| XXVI | Parties CRUD (web+mobile) + web foundations | Vertical slice to establish patterns | ✅ **DONE** |
| XXVII | Products + Inventory CRUD (web) + forms (mobile) | Extend commerce core; build on patterns | 📋 **Planned** |
| XXVIII | Sales Orders CRUD (web) + edit UI (mobile) | Complete order-to-cash start | 🔄 Next |
| XXIX | Purchase Orders CRUD (web) + PO→receive loop | Complete procure-to-pay start | 🔄 Next |
| XXX | Views + Workspaces CRUD (web+mobile) | Tier 2.1; enable saved filters | 🔄 Future |

---

## Summary

**Sprint XXVI Outcomes:** ✅ Complete
- Web foundations + Parties CRUD fully functional
- AWS-only enforcement in place
- 39/39 smoke tests passing
- All typechecks green

**Sprint XXVII Ready:** ✅ Yes
- Proposed Products + Inventory slice well-defined
- API mature + tested
- Parties pattern provides template
- 6–9 day effort estimate is reasonable
- File-by-file task list documented in SPRINT_XXVII_PLAN.md

**Next Step:** User approval to proceed with Sprint XXVII implementation, or request changes to plan.

---

**Files Generated:**
- ✅ [docs/SPRINT_XXVII_PLAN.md](docs/SPRINT_XXVII_PLAN.md) — Detailed implementation plan (Section 11 onwards)
- ✅ [docs/SPRINT_XXVII_KICKOFF_BASELINE.md](docs/SPRINT_XXVII_KICKOFF_BASELINE.md) — This report

**Report Generated:** 2025-12-23T21:15:00Z
