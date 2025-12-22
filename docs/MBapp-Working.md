# Sprint IX – Events (Read-Only) + Registrations Linkage (Mobile)

**Theme:** Events module with client-side Registrations linkage; Registrations feature-gated for safe rollout.

**Scope:**
- Events module: read-only tile + list/detail screens.
- EventDetail includes Registrations related section (filtered by eventId).
- Registrations section gated by FEATURE_REGISTRATIONS_ENABLED flag (dev default off).
- Dev seeding is centralized in DevTools; per-screen seed buttons (Events/Parties/Resources/Registrations) have been removed.

**Mobile Files Modified:**
1. `apps/mobile/src/features/events/types.ts` – Event type from generated schema.
2. `apps/mobile/src/features/events/api.ts` – listEvents(), getEvent(), + create/update (write support).
3. `apps/mobile/src/screens/EventsListScreen.tsx` – List with pagination/search + __DEV__ seed button.
4. `apps/mobile/src/screens/EventDetailScreen.tsx` – Detail with event fields + Registrations subsection.
5. `apps/mobile/src/features/_shared/flags.ts` – Added FEATURE_REGISTRATIONS_ENABLED (default false).
6. `apps/mobile/src/features/_shared/modules.ts` – Events tile + Registrations enabled() flag.
7. `apps/mobile/src/navigation/types.ts` – Added EventsList, EventDetail routes.
8. `apps/mobile/src/navigation/RootStack.tsx` – Registered Events screens.

**Features:**
- **Events:** Permission gated `event:read` (no feature flag). List pagination (limit/next) + search. Detail shows name/status/location/start/end/capacity/description/notes.
- **EventDetail-Registrations:** Fetch registrations using listRegistrations({ limit: 100 }); client-side filter by eventId; display up to 20. Each row tappable to RegistrationDetail.
- **Registrations flag:** FEATURE_REGISTRATIONS_ENABLED = false in dev by default, env-controlled (EXPO_PUBLIC_FEATURE_REGISTRATIONS_ENABLED) in prod. Affects ModuleHub tile visibility + EventDetailScreen fetch/render.
- **EventDetailScreen:** If feature off, shows "Registrations are disabled" text (graceful, not error). If fetch fails with "disabled" in message, shows same message.
- **Dev seeding:** Lives only in DevTools; EventsList no longer hosts a per-screen seed button.

**Definition of Done**
- ✅ Events tile visible on hub (if event:read permission).
- ✅ Events list/detail pagination, search, error handling work.
- ✅ Registrations subsection in EventDetail client-side filtered by eventId.
- ✅ Registrations section gracefully disabled when feature flag off.
- ✅ Registrations module tile hidden when feature flag off.
- ✅ __DEV__ seed button functional; creates test event with correct timestamps.
- ✅ Mobile typecheck passes.

**Verification**
```bash
cd apps/mobile && npm run typecheck
```

**Manual QA**
- Events: List pagination/search works; detail shows all fields; registrations section visible if feature on, shows "disabled" if feature off.
- Hub: Registrations tile hidden when FEATURE_REGISTRATIONS_ENABLED=false.
- (Dev) Seed button: Creates event, shows success feedback, reloads list.

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

### ✅ Sprint XII — PartyRoles + Resource Seed + Availability Fix (Mobile)
**Scope**
- Parties: Seed Party/Vendor now prepends to list, clears filters, scrolls to top; role filter + unified NEW badge.
- Resources: __DEV__ seed button; timestamps + NEW badge (10-minute window); newest-first sort.
- Registrations/Reservations: Fixed `getResourceAvailability()` to use authenticated client (bearer always sent).

**Mobile Files Modified:**
1. `apps/mobile/src/screens/PartyListScreen.tsx` – Added Seed Vendor button, prepend/scroll logic, import getParty.
2. `apps/mobile/src/screens/ResourcesListScreen.tsx` – Seed Resource button, timestamps, unified NEW badge pill style.
3. `apps/mobile/src/features/resources/api.ts` – Added createResource() helper.
4. `apps/mobile/src/features/reservations/api.ts` – Replaced unauthenticated request helper with apiClient.get().

**Definition of Done**
- ✅ Seed Party/Vendor appears at list top with NEW badge; role filter works; roleFlags/roles reflected.
- ✅ Seed Resource appears at top with NEW badge; created/updated timestamps visible.
- ✅ getResourceAvailability() authenticated (bearer token always sent).
- ✅ NEW badge style unified (pill with primary background, white text, fontSize 10).
- ✅ Mobile typecheck passes.

**Verification**
```bash
cd apps/mobile && npm run typecheck
```

**Manual QA**
- Parties: seed party/vendor → list updates, scrolls to top, NEW badge visible, role filter can filter new vendor.
- Resources: seed resource → list updates, scrolls to top, NEW badge visible, timestamps shown.
- Registrations: create reservation, select resource → availability blocks display correctly.

---

### ✅ Sprint E — Backorders & Product Flags
**Spec**
- Product additions: reorderEnabled (default true), preferredVendorId, minOrderQty, leadTimeDays.
- New object: BackorderRequest { id, type:'backorderRequest', soId, soLineId, itemId, qty, status:'open|ignored|converted', createdAt }.
- New paths: `POST /purchasing/suggest-po`; `POST /purchasing/po:create-from-suggestion`; `POST /objects/backorderRequest/{id}:ignore`; `POST /objects/backorderRequest/{id}:convert`.
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

**Note:** CI runs smokes defined in `ops/ci-smokes.json`. Additional smoke flows in `ops/smoke/smoke.mjs` can be run manually but are not in CI by default.

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

## ✅ Sprint XVIII — Sales Availability + 409 UX (2025-12-22)

**Theme:** SO detail visibility into inventory shortages; actionable 409 error UX; backorders navigation QoL.

**Mobile**
- **Per-line availability pills**: SO detail renders `{onHand, reserved, available}` for each line via new `useSalesOrderAvailability` hook (calls POST `/inventory/onhand:batch`).
- **409 error parsing**: Reserve/Commit 409s parse structured `shortages[]` payload and show a single alert listing top 3 items with demand vs. available; fallback to generic toast if data missing.
- **Availability refetch**: After any action success or 409, refetch availability so pills stay current.
- **Backorders navigation**: SO detail header shows tappable "Backorders present" badge when `so.backorders.length > 0`; navigates to BackordersList (unfiltered; shows all open backorders).
- **Duplicate CTA cleanup**: commitHint "View Backorders" button only shows when no header CTA (zero duplication).

**Backend**
- No changes; reuses existing `POST /inventory/onhand:batch`, `POST /sales/so/{id}:reserve`, `POST /sales/so/{id}:commit` (strict/non-strict) with structured shortage payloads already in place.

**Files Modified**
- Mobile: `apps/mobile/src/screens/SalesOrderDetailScreen.tsx` (availability pills, 409 parsing, refetch, badge CTA)
- Mobile: `apps/mobile/src/features/salesOrders/useAvailabilityBatch.ts` (new hook for batch availability fetch)

**Definition of Done**
- [x] SO lines show availability pill when data loads; graceful fallback ("Avail: —") when missing
- [x] 409 reserve/commit shows alert with top 3 shortages (Item <id> need <qty> avail <qty>); generic fallback if no structured data
- [x] Availability refetched after actions + 409
- [x] Badge tap navigates to BackordersList when backorders exist
- [x] No duplicate CTAs (header badge is sole entry point)
- [x] Typecheck passes

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

**List stability rules (mobile lists)**
- **Server query:** Use `query: { sort: "desc", by: "updatedAt" }` when supported.
- **Dev page size:** Set `params: { limit: __DEV__ ? 200 : 50 }` so newly created items appear on first page without pagination jump.
- **Client deterministic sort:** Fallback render sort: createdAt desc → updatedAt desc → id desc (newest-first).
- **Soft focus refetch:** Use `useFocusEffect` + `InteractionManager.runAfterInteractions` for background refresh without data clearing.
- **Create-return behavior:** After creating a record, set `scrollToTopOnNextFocus.current = true` before navigation; on return, scroll to top after refetch so new item is immediately visible; normal back navigation preserves scroll position via `maintainVisibleContentPosition={{ minIndexForVisible: 0 }}`.
- **Dev seed UI:** All seed actions live in DevTools screen; per-screen seed buttons removed from list screens.

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
| Products            | ✅   | ✅      | ✅     | 🟨       | List stable (newest-first + refresh) |
| Inventory           | ✅   | ✅      | ✅     | ✅       | List stabilized (refresh/sort/limit) |
| SalesOrders         | ✅   | ✅      | ✅     | ✅       | List stabilized: newest-first + create-return scroll-to-top |
| PurchaseOrders      | ✅   | ✅      | ✅     | ✅       | List stabilized: same behavior as Sales |
| BackOrders          | ✅   | ✅      | ✅     | ✅       | Bulk actions + vendor filter; card styling aligned |
| Party (CRM)         | ✅   | ✅      | ✅     | 🟨       | Hook unification |
| RoutePlans          | ✅   | ✅      | ✅     | 🟨       | Hook unification |
| Scans / EPC         | 🟨   | ✅      | 🟨     | ⬜       | Add seed+resolve (optional) |
| Organizations       | 🟨   | 🟨      | 🟨     | ⬜       | Basic objects exist; UX later |
| Events              | ✅   | ✅      | ✅     | ✅       | List sorting fixed (newest-first) |
| Registrations       | ✅   | ✅      | ✅     | ✅       | CRUD + filters completed (Sprints IV/XI) |
| Resources           | ✅   | ✅      | ✅     | ✅       | List/detail + seed/badges completed (Sprints V/VIII/XII) |
| Reservations        | ✅   | ✅      | ✅     | ✅       | CRUD + conflicts + availability completed (Sprints V–VII) |
| Workspaces/Views    | 🟨   | 🟨      | ⬜     | 🟨       | Minimal present |
| Scorecards/Reports  | ⬜   | ⬜      | ⬜     | ⬜       | Later tier |
| Settings/Config     | ⬜   | ⬜      | ⬜     | ⬜       | Global flags, tenants |

---

## Sources of Truth (SSOT)

Authoritative references for system design and implementation:

- **Roadmap:** [docs/MBapp-Roadmap-Master-v10.0.md](MBapp-Roadmap-Master-v10.0.md)
- **Object schemas / contracts:** [spec/MBapp-Modules.yaml](../spec/MBapp-Modules.yaml)
- **API implementation entrypoints:** [apps/api/src/index.ts](../apps/api/src/index.ts) + per-module handlers under `apps/api/src/*`
- **Mobile route names:** [apps/mobile/src/navigation/types.ts](../apps/mobile/src/navigation/types.ts) + [RootStack.tsx](../apps/mobile/src/navigation/RootStack.tsx)
- **Mobile module tiles + required permissions:** [apps/mobile/src/features/_shared/modules.ts](../apps/mobile/src/features/_shared/modules.ts)
- **Feature flags:**
  - Backend: [apps/api/src/flags.ts](../apps/api/src/flags.ts)
  - Mobile: [apps/mobile/src/features/_shared/flags.ts](../apps/mobile/src/features/_shared/flags.ts)
- **Dev seed tooling:** [apps/mobile/src/screens/DevTools.tsx](../apps/mobile/src/screens/DevTools.tsx)
- **Smokes (source):** [ops/smoke/smoke.mjs](../ops/smoke/smoke.mjs)
- **CI smoke matrix:** [ops/ci-smokes.json](../ops/ci-smokes.json)
- **Sales Availability UX (Sprint XVIII):**
  - Mobile hook: [apps/mobile/src/features/salesOrders/useAvailabilityBatch.ts](../apps/mobile/src/features/salesOrders/useAvailabilityBatch.ts)
  - Mobile detail screen: [apps/mobile/src/screens/SalesOrderDetailScreen.tsx](../apps/mobile/src/screens/SalesOrderDetailScreen.tsx)
  - Backend batch endpoint: [apps/api/src/inventory/onhand-batch.ts](../apps/api/src/inventory/onhand-batch.ts)
  - Backend availability logic: [apps/api/src/sales/so-reserve.ts](../apps/api/src/sales/so-reserve.ts) and [so-commit.ts](../apps/api/src/sales/so-commit.ts)

---

## Feature Flags Reference

This section documents flags used across the backend (AWS Lambda) and mobile (Expo) to control feature rollout and dev/test behaviors.

### Feature Flags Mapping

| Feature | Backend Env | Mobile Env | Dev/CI Header Override | Mobile __DEV__ Override | Default |
|---------|------------|------------|----------------------|------------------------|--------|
| **Registrations** | `FEATURE_REGISTRATIONS_ENABLED` | `EXPO_PUBLIC_FEATURE_REGISTRATIONS_ENABLED` | `X-Feature-Registrations-Enabled` | No | `false` |
| **Reservations** | `FEATURE_RESERVATIONS_ENABLED` | `EXPO_PUBLIC_FEATURE_RESERVATIONS_ENABLED` | `X-Feature-Reservations-Enabled` | Yes (`true`) | `false` |
| **Views** | `FEATURE_VIEWS_ENABLED` | _(none)_ | `X-Feature-Views-Enabled` | No | `false` |
| **Event Dispatch** | `FEATURE_EVENT_DISPATCH_ENABLED` | _(none)_ | `X-Feature-Events-Enabled` | No | `false` |
| **Event Simulate** | `FEATURE_EVENT_DISPATCH_SIMULATE` | _(none)_ | `X-Feature-Events-Simulate` | No | `false` |

**Notes:**
- Backend flags (env + header override) defined in [apps/api/src/flags.ts](../apps/api/src/flags.ts)
- Mobile flags defined in [apps/mobile/src/features/_shared/flags.ts](../apps/mobile/src/features/_shared/flags.ts)
- Header overrides only work in dev/CI (ignored in prod for security)
- Mobile Views/Events have no local flag (controlled by backend only)
- Reservations mobile flag: `__DEV__ ? true : (env === "true" || env === "1")`
- Registrations mobile flag: `env === "true" || env === "1"` (no __DEV__ override)

### Auth Policy & Module Visibility

The mobile ModuleHub fetches `GET /auth/policy` to determine which modules are visible and enabled:

- **Fail-closed behavior:** If `/auth/policy` returns `null` or fails, ModuleHub shows an error banner and displays no tiles (empty module list).
- **Runtime policy:** JWT `mbapp.policy` claim is `Record<string, boolean>` (e.g., `{ "parties:read": true, "event:read": true }`) used by backend `hasPerm`/`requirePerm` for enforcement.
- **Permission matching:** Mobile uses wildcard matching on the policy map:
  - `"*"` → superuser (all permissions allowed)
  - `"*:*"` or `"*:all"` → all resources and actions
  - `"*:<action>"` → all resources with a specific action (e.g., `*:read`)
  - `"<type>:*"` → all actions on a specific type (e.g., `parties:*`)
  - Case-insensitive matching of permission strings.

**Development note:** The `/auth/policy` endpoint ([apps/api/src/auth/policy.ts](../apps/api/src/auth/policy.ts)) currently returns a dev stub with `scopes: ["*:*"]` array plus user/roles/tenants/version/issuedAt. This is NOT the same as the JWT policy claim. In production, the endpoint should derive scopes from JWT roles (see TODO at line 9).

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

### Known Limitations / Future Polish (Sprint XVIII)
- **BackordersList filtering:** No backend support yet for SO or itemId filtering. CTA from SO detail navigates to global open backorders list. Recommend adding `soId` query param + backend filter when needed.
- **409 UX for Cancel/Close:** Currently show generic toast only (status-based guards don't include structured shortage detail like Reserve/Commit). No action needed unless we want parity; current UX acceptable.

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

---

## Sprint X — Parties (read-only) + dev seed

**Scope & Features**
- Module tile gated by permission `parties:read`.
- PartyListScreen: search + optional role filter, error banner, tap-to-detail.
- PartyDetailScreen: read-only detail with error banner + retry.
- Fixed party label resolution and roleFlags typing; PartyPicker/PartySelectorModal no longer rely on `.name`.
- __DEV__ seed Party button for testing (uses `/objects/party` with optional partyRole alignment).

**How to Verify**
```bash
cd apps/mobile && npm run typecheck
```

**Manual QA**
- Seed a party (dev button), refresh list (search + role filter), then open detail.
- Confirm error banners show and retry works when fetch fails.

---

## Sprint XI — Registrations Enabled + Parties UX Improvements

**Registrations**
- Mobile flag: `FEATURE_REGISTRATIONS_ENABLED` now respects `EXPO_PUBLIC_FEATURE_REGISTRATIONS_ENABLED` (removed `__DEV__` forced false). Registrations tile appears when enabled.
- Backend `/registrations` returns 200; related registrations render on EventDetail and PartyDetail (client-side filter by `eventId`/`partyId`, up to 20, tappable to RegistrationDetail).
- __DEV__ Seed Registration button (when present) creates minimal registration; CI now includes registrations smokes via `ops/ci-smokes.json`.

**Parties**
- Dev seed creates `partyRole` (customer/vendor) after creating the party to match smoke canonical setup.
- PartyListScreen: shows created/updated timestamps, adds a "NEW" badge for items created within 10 minutes, sorts newest-first, and fixes role filtering client-side (checks `roleFlags` and `roles`).

**Verify**
```bash
cd apps/mobile && npm run typecheck
node ops/tools/run-ci-smokes.mjs
```

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

## ✅ Sprint V — Resources/Reservations Foundation (Completed 2025-12-21)

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

---

## ✅ Sprint VI — Reservations Write UI (Option A) (Completed 2025-12-21)

**Theme:** Mobile create/edit reservation screens with conflict handling.

**Scope (Mobile-focused)**
- Added `CreateReservationScreen` with ResourcePicker, ISO datetime inputs, status selector.
- Added `EditReservationScreen` with pre-populated form from existing reservation.
- Conflict handling: 409 responses display friendly error + list of conflicting reservations with "View" actions.
- Feature flag: `FEATURE_RESERVATIONS_ENABLED` (env: `EXPO_PUBLIC_FEATURE_RESERVATIONS_ENABLED=true`, default: false).
- Create/Edit entry points hidden when flag is OFF; screens remain registered.

**Mobile Files**
- `apps/mobile/src/screens/CreateReservationScreen.tsx` — new reservation form with ResourcePicker.
- `apps/mobile/src/screens/EditReservationScreen.tsx` — edit existing reservation.
- `apps/mobile/src/features/reservations/api.ts` — added `createReservation()`, `updateReservation()` with 409 enrichment.
- `apps/mobile/src/features/_shared/flags.ts` — `FEATURE_RESERVATIONS_ENABLED` via env.
- `apps/mobile/src/screens/ReservationsListScreen.tsx` — "+ Create Reservation" button (flag-gated).
- `apps/mobile/src/screens/ReservationDetailScreen.tsx` — "Edit Reservation" button (flag-gated).

**Conflict Handling**
- On 409: parse `err.code === "conflict"` and `err.conflicts` array.
- Display error message + conflict list with IDs and times (if available).
- "View" action navigates to conflicting reservation detail.

**How to Enable**
- Set `EXPO_PUBLIC_FEATURE_RESERVATIONS_ENABLED=true` in `.env` or `.env.local`.
- Restart Expo dev server.

**Definition of Done**
- ✅ Create/Edit screens functional with ResourcePicker integration.
- ✅ ISO datetime validation (startsAt < endsAt).
- ✅ 409 conflicts show user-friendly message + navigable conflict list.
- ✅ Feature flag hides Create/Edit CTAs when disabled.
- ✅ Mobile typecheck passes.

---

## Sprint VII – Availability-First Reservation UX (Mobile)

**Theme:** Empower users to self-resolve conflicts by showing busy blocks and suggesting next available slots.

**Scope:** Mobile-only enhancements + smoke test extension. No API/infra changes (uses existing `/resources/{id}/availability` endpoint).

**Mobile Files Modified:**
1. `apps/mobile/src/features/reservations/api.ts` – New `getResourceAvailability()` helper
2. `apps/mobile/src/screens/CreateReservationScreen.tsx` – Availability display + "Use next available slot"
3. `apps/mobile/src/screens/EditReservationScreen.tsx` – Identical availability UX
4. `apps/mobile/src/screens/ReservationsListScreen.tsx` – ResourceId + Status filters

**Features:**
- **Busy Blocks Display (Steps 1–3):** On resource selection, fetch + display next 14 days of busy blocks (from `GET /resources/{id}/availability`). Updates when resourceId changes.
- **Next Available Slot Button (Step 6):** When conflict error occurs, user taps "Use next available slot" → algorithm iteratively searches up to 20 slots → auto-fills suggested start/end times → clears error → user submits.
- **Suggestion Algorithm (Step 6):** Iterative search with MAX_ITERATIONS=20; finds first non-overlapping [suggestedStart, suggestedStart + duration] against sorted busyBlocks array; uses interval overlap rule `(a.start < b.end) && (b.start < a.end)`.
- **List Filters (Steps 4–5):** Client-side composition: ResourceId (case-insensitive partial match) + Status (buttons: All/pending/confirmed/cancelled) both applied together via `filteredReservations` compute.

**Smoke Enhancement (Step 7):**
- Extended `smoke:reservations:conflicts` flow with Step 5: GET `/resources/{id}/availability?from=T0-1h&to=T1+1h` after conflict creation.
- Validates: 200 status, `body.busy` is array, reservation A present (by ID OR overlapping block).
- Output includes: `availabilityEndpoint: { busyBlocks, hasReservationA, hasOverlap }`.

**Definition of Done**
- ✅ Availability panels render on Create/Edit screens.
- ✅ Busy blocks fetch on resourceId change (14-day window).
- ✅ "Use next available slot" suggestion fills form + clears conflict error.
- ✅ ReservationsListScreen filters apply together (no field-level isolation).
- ✅ Smoke test validates availability endpoint includes reservation in conflict response.
- ✅ Mobile typecheck passes.
- ✅ Smoke syntax valid.

**Verification**
```bash
# Mobile implementation
cd apps/mobile && npm run typecheck

# Smoke test syntax
node -c ops/smoke/smoke.mjs

# Run availability conflict test (requires API deployed with FEATURE_RESERVATIONS_ENABLED=true)
node ops/smoke/smoke.mjs smoke:reservations:conflicts
```
