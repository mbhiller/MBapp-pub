# MBapp-Working — A→G History & Sprint H Plan
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


## ✅ Sprint G — Results (Persist Drafts + Quick Receive + Hook Unification)
**Theme:** Persist PO drafts; Quick Receive ergonomics; finish hooks alignment.

**What we implemented**
1) **Saver endpoint**: `POST /purchasing/po:create-from-suggestion` accepts `draft` or `drafts`, persists `purchaseOrder#<id>`, idempotent via `Idempotency-Key`; returns `{ id?, ids }`.
2) **PO Detail CTA**: “Save Draft” posts to saver and navigates to the persisted id (replaces ephemeral draft id).
3) **Quick Receive (flag)**: Feature-flagged “Receive All” action on PO detail; posts line deltas to `/purchasing/po/{id}:receive`; idempotent-safe.
4) **Hooks consolidation (mobile)**: Introduced single canonical `useObjects` hook. **List** mode returns `{ items, total? }`; **single** returns the object. Updated PO/SO/Inventory/List+Detail and Backorders screens.
5) **Smokes**: `smoke:po:save-from-suggest` and `smoke:po:quick-receive` added and passing.
6) **CI**: Workflow runs spec bundle/types, API build, Mobile typecheck, and the two new smokes in matrix.

**Spec**
- Added `/purchasing/po:create-from-suggestion` to **MBapp-Modules.yaml** (request: `draft|drafts`; response: `{ id?, ids[] }`).
- Tightened `SuggestPoResponse` to `oneOf` (either `draft` or `drafts[]`).

**Definition of Done (met)**
- Saver returns created id(s); mobile CTA persists + navigates ✅
- Receive-All creates movements and refetches; idempotent ✅
- Unified `useObjects` across touched screens ✅
- New smokes pass locally & in CI ✅

---


## Sprint H — Per-Line Receive + Pagination + UX Polish (Delivered)

**Highlights**
- Per-line `POST /purchasing/po/{id}:receive` now supports `{ lineId, deltaQty, lot?, locationId? }`.
- Idempotency: both **Idempotency-Key** and **payload-signature**. Same payload (lines, qty, lot, location) returns current PO even if a different key is used.
- Inventory movement writes normalized (`type/docType`, `action`, `at`, `refId`, `poLineId`, optional `lot/locationId`).
- Inventory create hardening: verb coercion and **reserve guard** (409 if qty > available).
- List APIs include optional `pageInfo`; mobile hook surfaces it without breaking `{ items, total? }`.
- Mobile PO detail screen: per-line Receive modal wired via centralized `poActions.receiveLine()`; toasts + disabled states aligned to shared pattern.

**Smokes (green)**
- `smoke:inventory:onhand`, `smoke:inventory:guards`, `smoke:inventory:onhand-batch`, `smoke:inventory:list-movements`
- `smoke:po:receive-line`, `smoke:po:receive-line-batch`
- `smoke:po:receive-line-idem-different-key` (new)

**Notes**
- `PurchaseOrder.vendorId` remains the party with vendor role (guard enforced on create/update).
- Movement rows are forward-compatible: read paths accept legacy verb fields if any historical data exists.


---

## Templates & Conventions (carry-forward)
- Module Dev Template: Contract-first → Backend → Smokes → UI stubs → Docs → PR.
- Routes: /objects/<type>[/<id>|/search], actions /module/<noun>/{id}:<verb>, purchasing /purchasing/... .
- Smokes naming: smoke:<module>:<flow>.
- UI Stubs: list with q filter; detail with read-only badges; minimal actions only.

---

**EXAMPLE PR TEMPLATE**

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
# NEXT SPRINT
## Sprint I — Pagination UX + Vendor Guard + Receive History (Plan & DoD)

**Goals**
1) Pagination UX: add infinite scroll / "Load more" using optional `pageInfo`, no breaking changes.
2) Vendor Guard UX: friendly banner with actions when vendor role is missing/invalid on PO create/update.
3) Per-line Receive History: show recent receive movements per PO line (qty, lot, location, timestamp).

**API Scope**
- Ensure list endpoints include optional `pageInfo` where supported.
- `GET /inventory/{id}/movements`: support query params `refId?`, `poLineId?` (filter-only; additive).
- Leave commented `emitEvent('po.received' | 'po.line.received')` stubs.

**Mobile Scope**
- Hook pagination on: Purchase Orders list, Inventory list (infinite scroll + Load more fallback).
- PO Detail: add "Receive History" chip per line; sheet displays last N receives (lot/location/qty/at).
- Vendor guard: inline banner + actions; consistent toasts/disabled states.

**Smokes & CI**
- New smokes: 
  - `smoke:objects:list-pagination` (pageInfo / nextCursor behavior)
  - `smoke:movements:filter-by-poLine` (correct filtering by refId+poLineId)
- CI: add both tests to matrix.

**Acceptance (DoD)**
- Lists can fetch next pages using `pageInfo.nextCursor`; first page behavior unchanged.
- Movement filter returns correct subset with `refId`/`poLineId`.
- PO line shows accurate recent receive history; no double-apply on idempotent retries.
- Vendor errors display banner with actionable guidance.
- All smokes green; CI updated.

**Risks / Mitigations**
- Pagination regressions → additive changes only; smoke test added.
- Movement filter perf → simple filter after query; revisit indexing later if needed.

**File Needs**
- spec/MBapp-Modules.yaml (latest), generated mobile types
- API: movements list route, objects list/search helpers, ddb/responses utils
- Mobile: PO list screen, Inventory list screen, toast/banner components, Party detail route id
- CI: .github/workflows/ci.yml, ops/smoke/smoke.mjs (latest)




## Receive Idempotency (Details)

- **Key-based**: Provide `Idempotency-Key` to retry safely; same key = same outcome.
- **Payload-signature**: We also hash the canonical `lines[]` payload (sorted `lineId`, `deltaQty`, plus `lot/locationId`).  
  If the same payload arrives with a different key (common in mobile retry storms), we return **200** with current PO and do not double-apply.

**Client tip**  
Use a stable key for a given (poId, lineId, qty, lot, location), e.g.:



### Future Epic — Config-Driven Business Processes (Deferred)
We will add light orchestration for cross-object flows (e.g., Registration → communications → Reservation → Sales Order).
Entrance criteria:
- ≥3 recurring flows; stable object lifecycles; measurable manual overhead.

Non-negotiables:
- Idempotent steps; config-first “recipes” (YAML/JSON) for steps like createObject, sendEmail, prompt/awaitSignal.
- Observability: store a short timeline (steps, startedAt, lastError).

No-regret prep (ongoing):
- Keep Idempotency-Key and X-Request-Id plumbing.
- Maintain createdAt/updatedAt on objects.
- Add (disabled) `emitEvent` stubs at key actions for painless activation later.
