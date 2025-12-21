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


## Sprint I — Pagination UX + Vendor Guard + Receive History (Completed 2025-10-24)

**Goals achieved**
- Pagination UX: Added optional cursor pagination surfaced via `pageInfo` while preserving legacy `{ items, total?, next? }`.
- Vendor Guard UX: Banner on PO Detail with “Change vendor” and “Open Vendor” actions.
- Per-line Receive History: PO line chip opens a sheet showing recent receives (lot/location/qty/at), pagination-aware.

**API**
- `/inventory/{id}/movements` now supports additive filters: `refId?` (PO id) and `poLineId?` (PO line id).
- Responses include optional `pageInfo { hasNext, nextCursor, pageSize }` in addition to legacy `next` when available.
- Objects list/search endpoints return `pageInfo` alongside existing `{ items, next? }`.

**Mobile**
- Purchase Orders List: infinite scroll + “Load more” fallback via `useObjects` (`hasNext`, `fetchNext`).
- Inventory List: same pagination UX as above.
- Purchase Order Detail:
  - **Vendor Guard** banner (missing/invalid vendor) with modal selector wired to set `vendorId`.
  - **Receive History** sheet per line (filters by `refId` + `poLineId`; paginated).

**Smokes & CI**
- Added: `smoke:objects:list-pagination`
- Added: `smoke:movements:filter-by-poLine`
- CI workflow updated to run both new smokes.

**Definition of Done**
- [x] Lists can fetch next pages via `pageInfo.nextCursor` (first page shape unchanged).
- [x] Movements list filters correctly when `refId` / `poLineId` are provided.
- [x] PO line shows accurate recent receive history; no double-apply issues observed in smoke.
- [x] Vendor errors render banner + actionable guidance (change/open vendor).
- [x] All new smokes green; CI includes new tests.

**Risks & Mitigation**
- Pagination regressions → additive only + smoke coverage.
- Movement filter perf → simple in-memory filter after query; revisit indexing if needed.
- Dynamic nav edge cases → history chip/sheet scoped to PO detail only.

**Artifacts**
- Spec: `spec/MBapp-Modules.yaml` (additive query params on movements; optional `pageInfo` notes).
- API: `apps/api/src/inventory/movements.ts`, `apps/api/src/objects/list.ts`, `apps/api/src/objects/search.ts`.
- Mobile: `apps/mobile/src/features/purchasing/ReceiveHistorySheet.tsx`, `apps/mobile/src/features/_shared/VendorGuardBanner.tsx`, `apps/mobile/src/features/parties/PartySelectorModal.tsx`, list screens (PO/Inventory) pagination, PO Detail wiring.
- Smokes: `ops/smoke/smoke.mjs` + CI matrix updates.

---

## ✅ Sprint II — Results (2025-10-24)

**Theme:** Vendor guardrails, receive idempotency, movement filters, and event stubs — with smoke coverage and DX flags.

**Backend**
- **Vendor guard (submit/approve/receive):** enforced via `featureVendorGuardEnabled` (env in prod, header override in dev/CI). Validates `purchaseOrder.vendorId` points to a **Party** with role `vendor` using `getObjectById({ tenantId, type:"party", id })`.
- **Receive handler hardening:** `/purchasing/po/{id}:receive`
  - Uses shared `getPurchaseOrder` / `updatePurchaseOrder` so status transitions match submit/approve.
  - **Idempotency:** (1) key ledger `Idempotency-Key`; (2) payload-signature hash of canonical `lines[]` to prevent double-apply across different keys.
  - **Guards:** only `approved | partially_fulfilled`; 409 on over-receive per line.
  - **Movements shape:** writes `docType:"inventoryMovement"`, `action:"receive"`, `refId` (po id), `poLineId`, optional `lot`/`locationId`, `at`, `createdAt`/`updatedAt`.
  - **Events:** integrated `maybeDispatch` with **simulate** header (`X-Feature-Events-Simulate`) returning `_dev.emitted: true` in responses when exercised by smokes.
- **Movements list:** `GET /inventory/{id}/movements` now supports additive query filters `refId` and `poLineId` (filtered after the pk/sk query), returns optional `pageInfo` alongside legacy `next`.

**Mobile**
- **PO list/detail** wired to unified `useObjects` hook; fixed `reset()` optionality on list search.
- **Receive History** sheet hooked to movements endpoint filters.
- **VendorGuardBanner** shown on PO detail when vendor role missing/invalid (mirrors server messages).

**Smokes (green)**
- `smoke:po:quick-receive`
- `smoke:po:receive-line`
- `smoke:po:receive-line-batch`
- `smoke:po:receive-line-idem-different-key`
- `smoke:movements:filter-by-poLine`
- `smoke:po:vendor-guard:on`
- `smoke:po:vendor-guard:off`
- `smoke:po:emit-events`
- `smoke:objects:pageInfo-present`

**Flags (DX)**
- `FEATURE_ENFORCE_VENDOR_ROLE` / header `X-Feature-Enforce-Vendor` (dev/CI only override).
- `FEATURE_EVENT_DISPATCH_SIMULATE` / header `X-Feature-Events-Simulate` for smoke visibility.

**Notes / Deferred optimization**
- 📌 **Future:** *Inventory movements: add GSI1 (partition key `ITEM#<itemId>`, time-ordered sort) and toggle read path behind `MBAPP_USE_GSI1`.* We’ll pick this up in the optimization sprint.

---

## Templates & Conventions (carry-forward)
- Module Dev Template: Contract-first → Backend → Smokes → UI stubs → Docs → PR.
- Routes: /objects/<type>[/<id>|/search], actions /module/<noun>/{id}:<verb>, purchasing /purchasing/... .
- Smokes naming: smoke:<module>:<flow>.
- UI Stubs: list with q filter; detail with read-only badges; minimal actions only.

---

### Sprint V Option 2 – Implementation Notes
- Flag: FEATURE_RESERVATIONS_ENABLED (env) with dev/CI header override X-Feature-Reservations-Enabled.
- Overlap rule: (aStart < bEnd) && (bStart < aEnd).
- Endpoints: POST /reservations:check-conflicts, GET /resources/{id}/availability (flag-gated).
- Smokes: npm run smoke:resources:crud; npm run smoke:reservations:crud; npm run smoke:reservations:conflicts; npm run smokes:run:ci:win.

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
## Sprint III — Plan (Events plumbing, UX polish, and query perf)

**Goals**
1) **Events plumbing (stub → pluggable):** introduce a thin dispatcher contract with provider adapters; keep simulate path.
2) **Receive UX polish:** richer line history (group by lot/location), better empty/edge states, and consistent toasts.
3) **Query perf groundwork:** optional `MBAPP_USE_GSI1` for `/inventory/{id}/movements` (no migration by default), plus internal metrics for query size.
4) **CI & smokes:** extend events and movements coverage; keep vendor guard tests.

**API Scope**
- `events/dispatcher`: provider interface + default no-op; wire `MBAPP_EVENTS_PROVIDER` (`noop|log|eventbridge`), still safe when unset.
- `GET /inventory/{id}/movements`: behind `MBAPP_USE_GSI1`, try GSI1 path; otherwise current pk/prefix+filter.
- Keep `/purchasing/po/{id}:receive` semantics; add `_meta.applied: true` in `_dev` when idempotency short-circuit returns early (dev only).

**Mobile Scope**
- PO detail: “Receive history” chip shows grouped lines (lot/location buckets, total qty).
- Vendor banner CTA: quick-link to Party picker.
- Lists: maintain infinite scroll; show “No results / End of list” consistently.

**Smokes & CI**
- New/updated:
  - `smoke:events:simulate` (assert `_dev.emitted:true` on receive)
  - `smoke:movements:gsi1-parity` (optional; PASS if either path returns same rows)
- Matrix runs vendor guard on/off, idempotent retries, and filter by `poLineId`.

**Acceptance (DoD)**
- All existing smokes remain green; new smokes pass locally and in CI.
- Events path is configurable and harmless when provider unset.
- Movements endpoint returns identical results with/without GSI flag in small datasets.

**Risks / Mitigations**
- Divergence between pk-scan and GSI results → parity smoke + feature flag default OFF.
- Event provider misconfig → default noop, explicit logs when provider missing.

**Files to touch**
- `apps/api/src/events/dispatcher.ts` (provider interface, maybe adapters)
- `apps/api/src/purchasing/po-receive.ts` (uses dispatcher; `_dev` meta tweak in dev)
- `apps/api/src/inventory/movements.ts` (optional GSI path)
- `ops/smoke/smoke.mjs` (new smokes)
- Mobile PO detail & ReceiveHistorySheet (grouping/UI polish)




## Receive Idempotency (Details)

- **Key-based**: Provide `Idempotency-Key` to retry safely; same key = same outcome.
- **Payload-signature**: We also hash the canonical `lines[]` payload (sorted `lineId`, `deltaQty`, plus `lot/locationId`).  
  If the same payload arrives with a different key (common in mobile retry storms), we return **200** with current PO and do not double-apply.

**Client tip**  
Use a stable key for a given (poId, lineId, qty, lot, location), e.g.:

**Notes / Deferred optimization**
- 📌 **Future:** *Inventory movements: add GSI1 (partition key `ITEM#<itemId>`, time-ordered sort) and toggle read path behind `MBAPP_USE_GSI1`.* We’ll pick this up in the optimization sprint.

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

## Sprint III — Results

- **Summary:** Views/Workspaces v1 delivered behind feature flags; event dispatcher simulate path implemented (noop provider in dev/simulate).

- **Smokes:**
  - `smoke:views:crud` — PASS (create → list → update → delete stored config)
  - `smoke:workspaces:list` — PASS (v1 list semantics; empty result is valid for v1)
  - `smoke:events:enabled-noop` — PASS (response includes `_dev` metadata; `_dev.provider == "noop"`)

- **Flags:** Defaults OFF; can be overridden in dev/CI via headers:
  - `FEATURE_VIEWS_ENABLED` / `X-Feature-Views-Enabled`
  - `FEATURE_EVENT_DISPATCH_ENABLED` / `X-Feature-Events-Enabled`
  - `FEATURE_EVENT_DISPATCH_SIMULATE` / `X-Feature-Events-Simulate`

- **Notes / Tech debt:**
  - Workspaces v1 exposes minimal listing and view references; full tile composition and rich workspace UX deferred to v2.
  - Dispatcher simulate path is noop and safe; plan to wire real provider (EventBridge/SNS) behind flags later.
  - Consider mapping or migration utilities between legacy Views and future Workspace tile schema when evolving v2.

---

## Sprint IV — Results

- **Summary:** Registrations v1 delivered (CRUD + filters); feature-flagged (default OFF); objects-repo pattern with tenant/RBAC enforcement.

- **Endpoints:**
  - `POST /registrations` — Create registration (201 Created)
  - `GET /registrations` — List with filters: eventId, partyId, status (200 OK)
  - `GET /registrations/{id}` — Get single registration (200 OK)
  - `PUT /registrations/{id}` — Update registration (200 OK)
  - `DELETE /registrations/{id}` — Delete registration (204 No Content)

- **Schema (spec/MBapp-Modules.yaml):**
  - Registration: { eventId, partyId, division?, class?, status: draft|submitted|confirmed|cancelled, fees: [{ code, amount, qty? }], notes? }
  - Extends ObjectBase (id, tenantId, type, createdAt, updatedAt)

- **Smokes:**
  - `smoke:registrations:crud` — PASS (create → get → update status to 'confirmed' → delete → verify removal)
  - `smoke:registrations:filters` — PASS (3 created, filters: byEvent=2, byParty=2, byStatus=2)

- **Flags:** Default OFF; dev-header override in non-prod:
  - `FEATURE_REGISTRATIONS_ENABLED` / `X-Feature-Registrations-Enabled`

- **API Polish:**
  - DELETE returns 204 No Content (empty body, RFC 7231 compliant)
  - Added `noContent()` response helper to `apps/api/src/common/responses.ts`

- **Notes / Next:**
  - Payments and capacity management out-of-scope for v1
  - Consider: search (q filter), mobile RegistrationHub screen, registration actions (:cancel, :checkin, :checkout)
  - No migrations; filters via in-memory post-query (keeps schema clean)

- **Polish:**
  - Added `?q` search to GET /registrations (case-insensitive substring on id, partyId, division, class)
  - Minimal mobile RegistrationsListScreen (search + create modal, feature-flagged)
  - All smokes passing (registrations:crud, registrations:filters incl. q filter)
  - No schema/migrations

---

## Sprint V — Resources/Reservations Foundation (In Progress)

**Theme:** Add Resource and Reservation objects with overlap conflict detection; custom endpoints for availability checks.

**Scope**
- **Objects**: Resource and Reservation (both via generic `/objects/:type` CRUD).
- **Custom endpoints**:
  - `POST /reservations:check-conflicts` — validate time slot (returns conflicts array or 409).
  - `GET /resources/{id}/availability?from=ISO&to=ISO` — list busy periods.
- **Overlap rule**: (aStart < bEnd) && (bStart < aEnd).
- **Conflict response**: 409 with `{ code: "conflict", message, details: { conflicts: [...] } }`.
- **Feature flag**: `FEATURE_RESERVATIONS_ENABLED` (default false, dev header override).
- **RBAC**: `resource:read|write`, `reservation:read|write` permissions.
- **Mobile**: Read-only preview; write actions deferred to Sprint VI.

**Acceptance Criteria (Sprint V foundation)**
- ✅ Spec compiles (YAML valid, OpenAPI 3.0.3).
- ✅ TypeScript types generated from spec (Resource, Reservation, request/response schemas).
- ✅ Generic `/objects/:type` CRUD works for resources and reservations.
- ✅ Overlap validation enforced on create/update; 409 on conflict.
- ✅ `POST /reservations:check-conflicts` returns 200 (available) or 409 (conflict).
- ✅ `GET /resources/{id}/availability` returns busy periods in requested time range.
- ✅ Feature flag gates endpoints (PROD only env; non-prod allows dev header override).
- ✅ RBAC permissions enforced (`resource:*`, `reservation:*`).
- ✅ All smoke flows pass:
  - `smoke:reservations:crud` — create, list, update, delete reservations.
  - `smoke:reservations:conflicts` — check-conflicts returns 409 on overlap.
  - `smoke:resources:availability` — availability query returns busy periods.
- ✅ Mobile app: read-only preview (ResourcesList, ReservationsList screens); no write actions visible.

**Deliverables**
1. Spec: Added Resource, Reservation, ReservationsCheckConflictsRequest/Response, ResourceAvailabilityResponse schemas; endpoints with 409 error, flag annotations.
2. API:
   - Flag definition in `apps/api/src/flags.ts`.
   - Overlap validation in `apps/api/src/objects/create.ts` and `update.ts`.
   - `apps/api/src/reservations/check-conflicts.ts` handler.
   - `apps/api/src/resources/availability.ts` handler.
   - Routing wired in `apps/api/src/index.ts`.
3. Smokes: Three new flows in `ops/smoke/smoke.mjs`.
4. Mobile: Read-only preview screens (feature-flagged).

**Notes / Next**
- Actions (cancel, start, end) deferred to Sprint VI+.
- Recurring reservations, availability patterns (e.g., "closed Sundays") out-of-scope v1.
- Capacity/multi-resource reservations (e.g., "need both Arena & Stall") design only in v1.


