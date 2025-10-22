# MBapp-Working — A→E History & Sprint F Plan
_Last updated: 2025-10-22_

---

## Executive Summary
Sprint E is wrapped: backorder signals now drive purchasing via a worklist and PO suggestions, and product procurement flags are enforced. Per the playbook, we added minimal UI stubs (badges and simple lists) and verified the whole slice with smokes. Next up (Sprint F): multi-vendor suggestion drafts, Backorders bulk actions + vendor filter, scanner/wizard QoL, and unified mobile hooks.

---

## Status by Sprint (Summaries)
### ✅ Sprint A — Foundations & Objects
- Project scaffolding; Objects CRUD; dev-login; base router/helpers.
- Mobile: generic Objects list/detail.
- Smokes: service ping; objects CRUD.

### ✅ Sprint B — Inventory Counters & Movements
- Endpoints: GET /inventory/{id}/onhand, POST /inventory/onhand:batch, GET /inventory/{id}/movements.
- Counters: on-hand / reserved / available; movement history.
- Smokes: single, batch, movement list.

### ✅ Sprint C — Routing & Delivery MVP
- Persisted routing graph; plan compute endpoints; mobile list/detail.
- Smokes: shortest, closure.

### ✅ Sprint D — PO/SO Redesign MVP
- Unified PO/SO statuses and actions; strict vs non-strict SO commit returns shortages.
- Router wired; handlers implemented; movement persistence consistent with counters.
- Smokes: Sales and Purchasing happy paths + guards.

### ✅ Sprint E — Backorders & Product Flags
**Spec**
- Product additions: reorderEnabled (default true), preferredVendorId, minOrderQty, leadTimeDays.
- New object: BackorderRequest { id, type:'backorderRequest', soId, soLineId, itemId, qty, status:'open|ignored|converted', createdAt }.
- New paths: POST /purchasing/suggest-po; POST /purchasing/po:create-from-suggestion; POST /objects/backorderRequest/{id}:ignore; POST /objects/backorderRequest/{id}:convert.
**Backend**
- SO non-strict commit enqueues BackorderRequest for shortages when product.reorderEnabled !== false.
- Purchasing + Backorders action handlers; router patches.
**Mobile (SMF stubs)**
- SalesOrderDetail: header “Backorders present” and line “Backordered (N)” pills.
- BackordersList: open requests with Ignore/Convert.
- PO/Inventory/SO list + detail stubs.
**Smokes**
- product-flags, backorders-worklist, backorders-ignore-convert, po-suggest-draft, epc-resolve (404) — all PASS.

---

## Sprint F — Plan (Multi-Vendor Suggestions & Scanner QoL)
**Theme:** Finish procurement ergonomics and polish SO wizard/scanner.

**Objectives**
1) Multi-vendor PO suggestions
   - Evolve POST /purchasing/suggest-po to return grouped drafts by vendor.
   - When multiple vendors are present, respond with: { drafts: PurchaseOrder[] } (single-vendor may still return a single draft).
   - Optional per-line annotation: minOrderQtyApplied or adjustedFrom.
2) Backorders Worklist v2 (UI)
   - Multi-select Convert/Ignore; vendor filter; link to created draft POs.
3) SO Wizard / Scanner QoL
   - Confirm stop-on-select behavior for item/customer autocomplete.
   - (Optional) EPC seed-and-resolve happy-path for wizard smoke.
4) Hooks consolidation (mobile)
   - Standardize useObjectsList/useObject to a single options-object signature across modules.

**Deliverables**
- Spec: multi-vendor suggest-po response in MBapp-Modules.yaml.
- Backend: suggest-po returns { drafts: [...] } when multiple vendors.
- Mobile: Backorders bulk actions + vendor filter + drill to draft PO; wizard polish; unified hooks.
- Smokes: po:suggest-multivendor, backorders:bulk, epc:seed-and-resolve (optional).

**Definition of Done (Sprint F)**
- Multi-vendor suggestions shipped and smoke PASS.
- Backorders list supports bulk actions + vendor filter with links to draft POs.
- Scanner/wizard QoL verified (stop-on-select).
- Hooks standardized with no regressions (screens compile; basic flows intact).

---

## Templates & Conventions (carry-forward)
- Module Dev Template: Contract-first → Backend → Smokes → UI stubs → Docs → PR.
- Routes: /objects/<type>[/<id>|/search], actions /module/<noun>/{id}:<verb>, purchasing /purchasing/... .
- Smokes naming: smoke:<module>:<flow>.
- UI Stubs: list with q filter; detail with read-only badges; minimal actions only.

---

## PR Description Template (paste into PR)
# PR title
Sprint F — <short summary>

# Summary
<one-liner on theme/goal>

# Scope
- Spec: …
- Backend: …
- Mobile: …
- Smokes: …

# How to verify (manual)
1) …
2) …

# Smoke suite
```
node ops/smoke.mjs smoke:po:suggest-multivendor
node ops/smoke.mjs smoke:backorders:bulk
node ops/smoke.mjs smoke:epc:seed-and-resolve   # optional
```

# Expected PASS examples
```json
{"test":"po-suggest-multivendor","result":"PASS","drafts":2}
{"test":"backorders-bulk","result":"PASS","converted":3,"ignored":1}
```

# Risks / mitigations
- …

# Migration
- None (or steps)

# Checklist
- [ ] Spec updated & linted
- [ ] Backend handlers & router wired
- [ ] Mobile stubs updated
- [ ] Smokes PASS
- [ ] Working.md updated

---

## All Modules Coverage Tracker
Legend: ✅ done • 🟨 stub/partial • ⬜ planned

| Module              | Spec | Backend | Smokes | UI Stubs | Notes / Next |
|---------------------|:----:|:-------:|:------:|:--------:|--------------|
| Products            | ✅   | ✅      | ✅     | 🟨       | Add Products list/detail stub |
| Inventory           | ✅   | ✅      | ✅     | ✅       | Counters/movements present |
| SalesOrders         | ✅   | ✅      | ✅     | ✅       | Wizard QoL next |
| PurchaseOrders      | ✅   | ✅      | ✅     | ✅       | Multi-vendor drafts (F) |
| BackOrders          | ✅   | ✅      | ✅     | ✅       | Bulk actions + vendor filter (F) |
| Party (CRM)         | ✅   | ✅      | ✅     | 🟨       | Hook unification |
| RoutePlans          | ✅   | ✅      | ✅     | 🟨       | Hook unification |
| Scans / EPC         | 🟨   | ✅      | 🟨     | ⬜       | Add seed+resolve (optional) |
| Organizations       | 🟨   | 🟨      | 🟨     | ⬜       | Basic objects exist; UX later |
| Events              | ⬜   | ⬜      | ⬜     | ⬜       | Roadmap-driven |
| Registrations       | ⬜   | ⬜      | ⬜     | ⬜       | Depends on Events |
| Resources           | ⬜   | ⬜      | ⬜     | ⬜       | Roadmap-driven |
| Reservations        | ⬜   | ⬜      | ⬜     | ⬜       | Roadmap-driven |
| Workspaces/Views    | 🟨   | 🟨      | ⬜     | 🟨       | Minimal present |
| Scorecards/Reports  | ⬜   | ⬜      | ⬜     | ⬜       | Later tier |
| Settings/Config     | ⬜   | ⬜      | ⬜     | ⬜       | Global flags, tenants |

---

## Sprint F Kickoff — Copy/Paste for New Chat
**Title:** QR RFID App — Sprint F Kickoff (Multi-Vendor Suggestions & Scanner QoL)

**Message:**
I’ve attached **MBapp-Working.md**, the spec, and project files (API router, purchasing handlers, backorders actions, smoke.mjs). For Sprint F, let’s: (1) evolve `suggest-po` to return **grouped drafts per vendor**; (2) add **bulk Convert/Ignore** and a **vendor filter** to Backorders; (3) implement **stop-on-select** in the SO wizard; and (4) standardize hooks (`useObjectsList/useObject`) across modules. Provide compact spec diffs, exact router patches, handler updates, smoke additions (`po:suggest-multivendor`, `backorders:bulk`, optional `epc:seed-and-resolve`), and minimal UI patches to support these flows.

## Sprint F — Results (2025-10-22)

- **Multi-vendor suggestions**: `POST /purchasing/suggest-po` now groups by vendor (Party with role `vendor`) and returns `{ drafts:[...] }`. When only one vendor is present, a backward-compatible `draft` alias is also returned.
- **Backorders ergonomics**: Backorders list now supports **bulk Ignore/Convert**, a **vendor filter**, and (when multiple drafts are returned) a **Draft Chooser** modal before opening PO detail.
- **Wizard/Scanner QoL**: Autocomplete now **stops on select** (Item & Party pickers) and closes immediately, preventing re-open debounce loops.
- **Hooks consolidation**: Introduced canonical `useObject({ type, id, ... })` signature (positional still supported). Project-wide alignment in progress.
- **Smokes**: Added `smoke:po:suggest-multivendor` and `smoke:backorders:bulk` — both **PASS** in CI-local runs.
- **Spec**: `MBapp-Modules.yaml` updated with `SuggestPoResponse` and request saver schema accepting single or multiple drafts (optional).

### Notes
- `PurchaseOrder.vendorId` is a **Party.id** with role `vendor` (per Relationships). Any convenience wrappers should reference the same Party identity.
- `BackorderRequest.preferredVendorId` may be present for UI filtering; otherwise vendor is derived via `item → inventory → product` fields.

---

## Sprint G — Proposal (Next)

**Theme:** Persist PO drafts + receiving ergonomics, finish hooks alignment

**Objectives**
1. **Persist drafts**: Implement `/purchasing/po:create-from-suggestion` to accept `draft` or `drafts`, persist `purchaseOrder#*` objects, and return created id(s).
2. **PO Detail CTA**: Add a “Save Draft” action to persist and navigate to the saved PO (replace draft id with real id).
3. **Quick Receive (flagged)**: Add a minimal “Receive All” that emits `inventoryMovement(receive)` for each PO line (feature-flag guarded).
4. **Hooks finish**: Convert remaining `useObject(type,id)` call sites to `useObject({ type, id })` across modules.
5. **Smokes**: Add `smoke:po:save-from-suggest` and `smoke:po:quick-receive`.

**Definition of Done**
- Saver endpoint working and used by mobile CTA.
- Quick Receive creates movements and updates on-hand (idempotent).
- All new smokes PASS locally and in CI (manual smoke job).

**Kickoff Checklist**
- Regenerate types from `MBapp-Modules.yaml`.
- Add API handler `apps/api/src/purchasing/po-create-from-suggestion.ts`.
- Wire PO Detail “Save Draft” button.
- Add new smoke tests to `ops/smoke/smoke.mjs`.
