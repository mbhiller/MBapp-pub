# MBapp Status / Working

**Navigation:** [Roadmap](MBapp-Roadmap.md) · [Foundations](MBapp-Foundations.md) · [Cadence](MBapp-Cadence.md) · [Verification](smoke-coverage.md)  
**Last Updated:** 2025-12-30  
**Workflow & DoD:** See [MBapp-Cadence.md](MBapp-Cadence.md) for canonical workflow, Definition of Done, and testing rules.

---

## Current State Summary

### Line Identity Canonicalization (id vs. lineId) — ✅ Complete (Sprint O, 2025-12-29)

**Epic Summary:** Systematic migration of line identity from deprecated `lineId` to canonical `id` across API, web, and mobile. Backward-compatible 1-sprint transition window with structured logging.

- **E1 (Spec):** [spec/MBapp-Modules.yaml](../spec/MBapp-Modules.yaml) updated to canonicalize `id` in action request/response schemas for `{po,so}:receive`, `{so}:reserve`, `{so}:release`, `{so}:fulfill` endpoints
- **E2 (API Input Compat):** Action handlers (`po-receive`, `so-reserve`, `so-release`, `so-fulfill`) now accept both `id` (canonical) and `lineId` (deprecated) on input, normalize to `id` internally, log legacy usage via structured events (`po-receive.legacy_lineId`, `so-reserve.legacy_lineId`, etc.), and always emit `id` in responses. 1-sprint compatibility window allows clients to migrate safely.
- **E3 (Smoke Regression):** New test `smoke:line-identity:id-canonical` validates all action endpoints accept `id` and emit `id` in responses; updated 5 existing action smokes (close-the-loop, close-the-loop-multi-vendor, partial-receive, backorders-partial-fulfill, outbound-reserve-fulfill-release) to use `id` in payloads instead of `lineId`.
- **E4 (Web Client Migration):** PurchaseOrderDetailPage and SalesOrderDetailPage action handlers (receive, fulfill, receive-remaining, reserve, release) updated to send `id` instead of `lineId`. Read-side helpers retain fallback to `lineId`. Typecheck clean.
- **E5 (Mobile Client Migration):** PurchaseOrderDetailScreen and SalesOrderDetailScreen action handlers updated; type definitions (ReceiveLine, LineDelta, ReserveLine, ReleaseLine, FulfillLine) refactored to use `id`; selection helpers retain read-side fallback. Typecheck clean.
- **E6 (Documentation):** Foundations.md § 2.6 documents canonical contract, transition timeline, and all affected endpoints. smoke-coverage.md and Status.md updated. Sprint O marked complete.
- **Guarantee:** Full stack aligned on canonical `id`; all clients send `id`; API accepts both `id`/`lineId` on input (Sprint O only); responses always include `id` (never `lineId`).
- **Next:** Sprint P removes `lineId` from API input schemas; post-P cleanup verifies telemetry shows ~0% legacy usage before final removal.

### Telemetry Accretion on Core Workflows — 🟨 In Progress (Sprint P, started 2025-12-29)

**Epic Summary:** Add consistent domain event emission to SO and PO core workflows (reserve, release, fulfill, receive) with standardized envelope fields (tenantId, actorId, objectType/objectId, statusBefore/After, result, errorCode on failure).

- **E1 (API — so-reserve.ts):** [apps/api/src/sales/so-reserve.ts](../apps/api/src/sales/so-reserve.ts) now emits `SalesOrderReserved` domain event after movements persist (success path: lineCount, totalQtyReserved, statusBefore/After, result="success") and on error paths (result="fail", errorCode: "INVALID_STATUS" | "INSUFFICIENT_AVAILABILITY"). Payload contains IDs + counts only; no lines array.
- **E2 (API — so-fulfill.ts):** [apps/api/src/sales/so-fulfill.ts](../apps/api/src/sales/so-fulfill.ts) now emits `SalesOrderFulfilled` domain event after movements persist + SO lines updated + status computed (success path: lineCount, totalQtyFulfilled, statusBefore/After, result="success") and on error paths (result="fail", errorCode: "INVALID_STATUS" | "OVER_FULFILLMENT").
- **E3 (Web UX — SalesOrderDetailPage):** [apps/web/src/pages/SalesOrderDetailPage.tsx](../apps/web/src/pages/SalesOrderDetailPage.tsx) emits `so_reserve_clicked` and `so_fulfill_clicked` events via track() helper (snake_case names per convention); tracks attempt/success/fail lifecycle with result field and errorCode on failures. Payload: objectType, objectId, lineCount, result, errorCode. Integrated with Sentry error context tags.
- **E4 (Mobile UX — SalesOrderDetailScreen):** [apps/mobile/src/screens/SalesOrderDetailScreen.tsx](../apps/mobile/src/screens/SalesOrderDetailScreen.tsx) emits `so_reserve_clicked` and `so_fulfill_clicked` events via track() helper in two paths: (1) `run()` wrapper for reserve/fulfill button actions (attempt/success/fail tracking with lineCount + errorCode); (2) `submitPendingFulfills()` for scan-to-fulfill path (attempt/success/fail with scanMode: true flag). Integrated with Sentry error context tags matching web pattern (tags: objectType, objectId, action).
- **E5 (Docs — Foundations + Status):** MBapp-Foundations.md updated with Sprint P telemetry summary (domain events: SalesOrderReserved, SalesOrderFulfilled; UX events: so_reserve_clicked, so_fulfill_clicked; pattern: IDs + counts only, no lines array, Sentry integration). Event examples already present in § 8.3. MBapp-Status.md updated with E4 completion note.
- **Status:** ✅ **Complete (Sprint P, 2025-12-29)** — All E1–E5 tasks complete; typecheck + smoke tests pass; documentation synchronized.
- **Next:** Sprint Q readiness for so-release domain event (E6) and po-receive domain event (E7) if planned.

### Views/Workspaces v1 Hardening — ✅ Complete (Sprint Q, 2025-12-30)

**Epic Summary:** Server-side filter validation + web "Update View" affordance + smoke coverage to prevent view sprawl and invalid filter persistence.

- **E1 (Smoke — apply-to-po-list):** [ops/smoke/smoke.mjs](../ops/smoke/smoke.mjs) new test `smoke:views:apply-to-po-list` validates that applying a view with filters (e.g., status="draft") constrains list results. Creates 2 POs with different statuses, creates view with filter, queries list, asserts filter constrains results (draft PO present, submitted PO absent). Added to CI manifest.
- **E2 (Web — Update View):** [apps/web/src/components/SaveViewButton.tsx](../apps/web/src/components/SaveViewButton.tsx), [apps/web/src/pages/PurchaseOrdersListPage.tsx](../apps/web/src/pages/PurchaseOrdersListPage.tsx), [apps/web/src/pages/SalesOrdersListPage.tsx](../apps/web/src/pages/SalesOrdersListPage.tsx) now detect `?viewId` URL parameter and show "Update View" (primary action) + "Save as New" (secondary button) when a view is applied. Uses PATCH `/views/{id}` endpoint to persist filter changes without creating duplicates. Name field optional in update mode (empty = no change). Prevents view sprawl by allowing operators to refine existing views.
- **E3 (API — Filter Validation):** [apps/api/src/views/validate.ts](../apps/api/src/views/validate.ts) (new helper), [apps/api/src/views/create.ts](../apps/api/src/views/create.ts), [apps/api/src/views/update.ts](../apps/api/src/views/update.ts) now validate filter shape: field must be non-empty string, op must be one of 11 allowed operators (eq, ne, lt, le, gt, ge, in, nin, contains, startsWith, regex), value must be array for in/nin or primitive for others. Returns 400 bad_request with clear message (e.g., "Invalid view filter: op must be one of..."). No deep field-existence validation (too risky without canonical field registry). New smoke `smoke:views:validate-filters` validates rejection of invalid filters (missing field, bad op, in with non-array, object value) and acceptance of valid filters.
- **E4 (Docs):** MBapp-Foundations.md § 4.7 updated with Sprint Q hardening notes (filter validation, Update View affordance, columns stored but not rendered, sort support status). MBapp-Status.md Sprint Q summary added. smoke-coverage.md documents new smoke tests.
- **Status:** ✅ **Complete (Sprint Q, 2025-12-30)** — All E1–E4 tasks complete; apps/api typecheck passes; smoke:views:crud, smoke:workspaces:list, smoke:views:validate-filters all pass; web typecheck clean.
- **Next:** Mobile views UI (deferred); server-side field-existence validation (deferred); workspace-view aliasing clarification (future).

### Workspaces List Pagination Reliability — ✅ Complete (Sprint Q, 2025-12-30)

**Epic Summary:** Harden `/workspaces` list so q/entityType filtering works across pages and cursor aliasing remains reliable.

- **E1 (Pagination):** `/workspaces` now pages with the same cursor contract as `/views` (`next` cursor from `listObjects`), removes `fields` projection from repo calls to avoid cursor loss, and applies in-memory filters (q on name/description, entityType/ownerId/shared) across accumulated pages.
- **E2 (Projection):** Items are projected as `type="workspace"` with `views` defaulting to `[]`; optional `fields` query is applied only after collection so pagination cursors remain intact.
- **E3 (Verification):** `smoke:workspaces:list` passes with q + entityType filters and pagination retries after the fix (cursor observed when additional pages exist).

### Mobile PO Edit Parity — ✅ Complete (Sprint U, 2025-12-30)

**Epic Summary:** Bring mobile PO line editing to parity with SO: shared diff helper, cid/id rules, draft-only guard, and immediate detail refresh on return.

- **E1 (Entrypoint):** PurchaseOrderDetailScreen shows Edit button only for draft POs and now returns to detail with auto-refetch + “PO updated” toast when edits save.
- **E2 (Parity Polish):** EditPurchaseOrderScreen aligned to the SO edit model: shared PATCHABLE fields (`itemId`,`qty`,`uom`), tmp-* cid handling, shared normalization helper, no-op diff toast, and draft-only 409 guard (`PO_NOT_EDITABLE`).
- **E3 (Telemetry):** Added `po_edit_lines_clicked` and `po_edit_lines_submitted` lifecycle events (attempt/success/fail, includes errorCode and lineCount) matching SO patterns.
- **Status:** ✅ Typecheck clean; uses shared LineEditor component and shared patchLinesDiff helper; detail refreshes without pull-to-refresh.
- **E4 (Refresh/Guardrails):** Edit CTA remains draft-only; post-edit refresh is focus-safe via `didEdit` flag + on-focus refetch, with single “PO updated” toast.

### Mobile Save View v1 — ✅ Complete (Sprint R, 2025-12-30)

**Epic Summary:** Mobile save/update views for PO/SO list screens with bidirectional state mapping and auth-wired API client.

- **E1 (API — Mobile Client):** [apps/mobile/src/features/views/hooks.ts](../apps/mobile/src/features/views/hooks.ts) extended with `create(payload: CreateViewPayload)` and `patch(id: string, payload: PatchViewPayload)` methods. Auth token wired to AsyncStorage (`mbapp.dev.token`) matching DevAuthBootstrap pattern. Enhanced `getJSON()` to accept `method` parameter (GET/POST/PATCH) and optional `body` for mutations. Payload types include `name` (required), `entityType` (required), `filters`, `sort`, `description`, `shared` (all optional).
- **E2 (Inverse Mapper):** [apps/mobile/src/features/views/buildViewFromState.ts](../apps/mobile/src/features/views/buildViewFromState.ts) (new file) implements `buildViewFromState(entityType: string, state: MobileState)` inverse mapper. Entity-specific mappings: PO (q/status/vendorId), SO (q/status), Inventory (q/productId), Party (q/role), Product (q). Normalizes state by dropping empty values, validating operator types, ensuring value types match operators. Sort validation: only `createdAt`/`updatedAt` fields allowed, `asc`/`desc` direction required. Round-trip guarantee: `mapViewToMobileState(entityType, view)` → apply → `buildViewFromState(entityType, applied)` yields symmetric result for mapped fields.
- **E3 (UI — SaveViewModal):** [apps/mobile/src/features/views/SaveViewModal.tsx](../apps/mobile/src/features/views/SaveViewModal.tsx) (new file) reusable modal component with `name` (required TextInput), `description` (optional multi-line), `shared` toggle (omitted for v1, defaults false). Behavior: Detects update vs. create via `appliedView?.id`, shows "Save View" header (create) or "Update <Name>" header (update). Uses `buildViewFromState(entityType, currentState)` to derive filters from current state. API: POST `/views` for create, PATCH `/views/{id}` for update. Error handling: Toast with first 50 chars of error message. Loading state disables inputs + spinner.
- **E4 (UI — PurchaseOrdersListScreen):** [apps/mobile/src/screens/PurchaseOrdersListScreen.tsx](../apps/mobile/src/screens/PurchaseOrdersListScreen.tsx) integrated SaveViewModal with `saveModalOpen` state, `handleViewSaved(view)` callback, refactored button layout (primary "+ New PO" + secondary "Save"/"Update"), and SaveViewModal component at end. Passes `currentState: { q, filter: filters.filter, sort: filters.sort }` to modal.
- **E5 (UI — SalesOrdersListScreen):** [apps/mobile/src/screens/SalesOrdersListScreen.tsx](../apps/mobile/src/screens/SalesOrdersListScreen.tsx) integrated SaveViewModal with same pattern as PO (saveModalOpen state, handleViewSaved callback, button layout refactor, modal integration). Entity type: `"salesOrder"` (simpler filters: status + q, no vendorId).
- **Status:** ✅ **Complete (Sprint R, 2025-12-30)** — All E1–E5 tasks complete; mobile API types + auth wiring tested; inverse mapper with round-trip guarantee ✅; SaveViewModal component ✅; PO/SO screen integration ✅; apps/mobile typecheck passes; smoke:views:apply-to-po-list ✅ validates view-derived filter application.
- **Supported fields (v1):**
  - **PO:** q (contains), status (eq), vendorId (eq)
  - **SO:** q (contains), status (eq)
  - **Sort:** Limited to createdAt/updatedAt with asc/desc (other fields dropped during normalization)
  - **Shared:** Defaults to false if omitted (not exposed in UI for v1)
  - **Columns:** Parsed but not applied to list rendering (future feature)
- **Next:** Inventory/Parties/Products list save; workspaces hub apply/open views; additional entity types (e.g., backorders, registrations).

### Mobile Views Management v1 — ✅ Complete (Sprint S, 2025-12-30)

**Epic Summary:** Mobile ViewsManage screen to list/search/filter views and perform rename/delete with safety prompts.

- **E1 (Screen):** [apps/mobile/src/screens/ViewsManageScreen.tsx](../apps/mobile/src/screens/ViewsManageScreen.tsx) lists views with entityType chips (All/PO/SO), q search, pagination (load-more), and row actions (Rename via PATCH name, Delete via DELETE). Empty state shows “No views match your filters.” Toast feedback on success/failure.
- **E2 (Navigation):** [apps/mobile/src/navigation/types.ts](../apps/mobile/src/navigation/types.ts) + [RootStack.tsx](../apps/mobile/src/navigation/RootStack.tsx) register `ViewsManage` route (param: `initialEntityType?`). WorkspaceHub exposes a “Manage Views” button, passing current entityType filter when set.
- **E3 (API client):** useViewsApi now exposes `del(id)` (DELETE /views/{id}) alongside existing list/get/create/patch; uses same tenant/auth headers.
- **Safety:** Delete action prompts confirm dialog with view name; rename requires non-empty name; pagination explicit via load-more button to avoid surprise fetches.
- **Status:** ✅ Typecheck clean; uses existing toast/theme patterns; no new smokes required (views:crud already covers delete).

### Mobile Workspaces v1 — ✅ Complete (Sprint T, 2025-12-30)

**Epic Summary:** Mobile workspace management with view memberships and open-to-list navigation; workspaces remain an alias of views on the backend.

- **E1 (API Client):** Mobile workspaces client gained create/patch/delete with idempotency headers; update uses PUT to satisfy backend validation (name/entityType required). `views` field supported for memberships.
- **E2 (Manage Screen):** [apps/mobile/src/screens/WorkspacesManageScreen.tsx](../apps/mobile/src/screens/WorkspacesManageScreen.tsx) lists/searches workspaces (chips: All/PO/SO), shows view counts, supports create (name/entityType/shared, views=[]), rename, delete with toasts, pagination.
- **E3 (Detail Screen):** [apps/mobile/src/screens/WorkspaceDetailScreen.tsx](../apps/mobile/src/screens/WorkspaceDetailScreen.tsx) shows workspace info, resolves member view names, edits memberships via checklist filtered by entityType (PATCH via PUT with required fields), and opens member views into entity list routes using `viewId`.
- **E4 (Navigation Entry):** WorkspaceHub now links to WorkspacesManage alongside Manage Views; new routes registered for manage/detail.
- **E5 (Membership edit):** Mobile now supports editing workspace `views[]` membership (manage screen + dedicated membership editor). Backend stores workspaces as `type="view"`; updates require `entityType` and enforce `name` ≤ 120 chars.
- **Caveat:** Backend enforces name length ≤120 chars while spec allows 200; workspaces are stored as type="view" aliases with `views: string[]` memberships. Backend update is PUT-only today (PATCH not wired).

### Backorder → PO → Receive Loop Polish — ✅ Complete (Sprint I + Sprint J)
- **MOQ Bump Fix:** suggest-po now applies minOrderQty regardless of vendor source (override/backorder derivation).
- **Runtime Tracking:** BackorderRequest schema includes `fulfilledQty` and `remainingQty` (nullable, server-maintained during PO receive).
- **Visibility:** Web/Mobile SO detail shows backorder status breakdown (open/converted/fulfilled/ignored); PO detail shows per-line backorder linkage.
- **Detail Pages:** Web `/backorders/:id` and Mobile `BackorderDetail` screens show full context (SO/item/vendor links), fulfillment progress, and ignore action.
- **Navigation:** SO detail badges link to filtered backorders; PO chips link to backorder detail; list rows navigate to detail.
- **Mobile Ignore:** BackordersListScreen supports bulk Ignore action to remove unwanted backorders.
- **Smoke Coverage:** Tests for ignore action, partial fulfillment, and MOQ bumping; full CI suite passing (28 tests).
- **Key Endpoints:** `/objects/backorderRequest/search` (status breakdown), `/purchasing/suggest-po` (MOQ-aware), PO receive (fulfillment tracking), `:ignore` action.

### Patch-lines Parity (SO/PO) — ✅ Complete (Sprint G)
- **Endpoints:** `/sales/so/{id}:patch-lines` and `/purchasing/po/{id}:patch-lines` implemented with identical sequencing.
- **ID stability:** Server assigns stable `L{n}` IDs; removed IDs are reserved and **never reused** (guaranteed no id churn).
- **Error contract:** Both endpoints return `409 Conflict` with structured `{ code, status }` when not editable (SO_NOT_EDITABLE / PO_NOT_EDITABLE).
- **Web usage:** Both SalesOrder and PurchaseOrder edit pages use a shared diff helper to compute minimal ops.
- **Guards:** Sales Orders allow patching in `draft|submitted|approved`; Purchase Orders are draft-only.
- **CI coverage:** Both `smoke:salesOrders:patch-lines` and `smoke:purchaseOrders:patch-lines` validate id stability and no-reuse guarantee.
- **Next:** Broader web modules to adopt the shared line editor; mobile edit UIs can later align on the same contract.

### Shared Line Editors v1 (SO/PO) — ✅ Implemented (Sprint M, 2025-12-29)
- **Goal:** ONE shared line editing model that works identically for SO + PO, web + mobile, with consistent ID handling.
- **API Normalization (E1):**
  - `po-create-from-suggestion` now uses `ensureLineIds()` helper → generates stable `L{n}` IDs (no more ad-hoc `ln_*` patterns)
  - Dev-mode logging warns if non-`L{n}` IDs detected (legacy/external data)
  - ✅ File: [apps/api/src/purchasing/po-create-from-suggestion.ts](../apps/api/src/purchasing/po-create-from-suggestion.ts)
- **Web CID Support (E2):**
  - `computePatchLinesDiff()` now sends `cid` field for client-only lines (e.g., `tmp-xyz`), `id` for server lines
  - Edit pages preserve server IDs exactly (removed `makeLineId()` fallback generation)
  - Forms no longer generate synthetic `L${idx}` IDs (preserve `id`/`cid` only)
  - `LineArrayEditor` auto-generates `tmp-{uuid}` CIDs for new lines
  - ✅ Files: patchLinesDiff.ts, EditSalesOrderPage.tsx, EditPurchaseOrderPage.tsx, SalesOrderForm.tsx, PurchaseOrderForm.tsx, LineArrayEditor.tsx (6 files)
- **Pattern Lock (E3):**
  - `LineArrayEditor.ensureKeys()` auto-generates CID for lines without server ID (edge case protection)
  - JSDoc pattern documentation added to SO/PO form types (3 critical rules: NEVER fallback IDs, NEVER tmp-* as id, NEVER PUT full arrays)
  - Inline comments at form submission points reinforce pattern
  - ✅ Files: LineArrayEditor.tsx, SalesOrderForm.tsx, PurchaseOrderForm.tsx, EditSalesOrderPage.tsx, EditPurchaseOrderPage.tsx (5 files)
- **Regression Tests (E4):**
  - `smoke:po:create-from-suggestion:line-ids`: Creates backorder → suggest-po → create-from-suggestion → asserts all line IDs match `^L\d+$`
  - `smoke:so:patch-lines:cid`: Creates SO draft → patch-lines with `cid` → verifies server assigns stable `L{n}` → subsequent patch uses `id`
  - ✅ Files: [ops/smoke/smoke.mjs](../ops/smoke/smoke.mjs) (lines 6672-6876), [ops/ci-smokes.json](../ops/ci-smokes.json)
- **CI Posture:** 30/30 smoke tests passing (added 2 new regression tests)
- **Remaining Work:**
  - ⬜ Mobile: Implement RN line editor UX (LineArrayEditor equivalent)
  - ⬜ Web: Audit other endpoints that create/update lines without `ensureLineIds()`
- **Mobile Parity:** Shared `computePatchLinesDiff` helper now lives in apps/mobile/src/lib/patchLinesDiff.ts (SO/PO), matching web semantics.
- **Mobile PO Edit:** `EditPurchaseOrderScreen` supports draft-only line edits using patch-lines (id/cid diff, add/remove/edit, no-op toast, 409 guard) and refreshes detail on return; PO detail links to edit when draft; uses dedicated patch-lines API client helper.
- **Mobile Line Editor:** Shared React Native `LineEditor` component now powers both SO and PO edit screens (itemId/qty/uom, cid tmp-* generation, add/remove/edit UI reuse).
- **CI Regression:** Added `smoke:po:patch-lines:cid` to validate cid→id assignment for PO patch-lines; CI suite remains green.
- **Pattern Documentation:** See [MBapp-Foundations.md § 2.5 Shared Line Editor Contract](MBapp-Foundations.md#25-shared-line-editor-contract)
- **Spec Alignment:** Canonical line identity is `id`; `lineId` accepted only as deprecated alias during transition (patch-lines + receive/fulfill reserve/release schemas updated).
- **API Input Compat (E2, 2025-12-29):** Action handlers (`po-receive`, `so-reserve`, `so-release`, `so-fulfill`) now accept both `id` (canonical) and `lineId` (deprecated) in request bodies, normalize internally to `id`, log `so-reserve.legacy_lineId` / `so-release.legacy_lineId` / `so-fulfill.legacy_lineId` / `po-receive.legacy_lineId` structured events when legacy usage detected, and always emit `id` in responses. Allows safe client migration without breaking existing API users (1-sprint compatibility window).
- **Smoke Regression (E3, 2025-12-29):** New smoke `smoke:line-identity:id-canonical` validates all action endpoints accept `id` and emit `id`; updated 5 existing action smokes (close-the-loop, close-the-loop-multi-vendor, partial-receive, backorders-partial-fulfill, outbound-reserve-fulfill-release) to use `id` in payloads instead of deprecated `lineId`.
- **Web Client Migration (E4, 2025-12-29):** Web app action payloads updated to use canonical `id` field: PurchaseOrderDetailPage (receive/receive-remaining handlers), SalesOrderDetailPage (fulfill handler). Read-side helpers (getPoLineId) retain fallback to `lineId` during transition. Typecheck clean; ready for E5 (mobile client updates).
- **Mobile Client Migration (E5, 2025-12-29):** Mobile app action payloads updated to use canonical `id` field: PurchaseOrderDetailScreen (receive/scan-receive handlers), SalesOrderDetailScreen (reserve/release/fulfill handlers), DevToolsScreen (test payloads). Type definitions updated (ReceiveLine, LineDelta, ReserveLine, ReleaseLine, FulfillLine). Selection helpers (pickBestMatchingLineId) retain read-side fallback to `lineId`. Typecheck clean. All clients (web, mobile, API) now aligned on canonical id.
- **Telemetry:** Mobile PO edit emits `screen_viewed` (screen=`PurchaseOrderEdit`, includes `poId` + status) and `po_edit_submit` (`result=attempt|success|error`, `opCount`, `upsertCount`, `removeCount`, `httpStatus?`, `errorCode?`); Sentry tags include `screen`, `route`, `objectType`, `objectId`, `poStatus` when present.

**Recent Deliveries (Sprint I, 2025-12-28):**
- ✅ **Backend MOQ loading fix:** suggest-po applies minOrderQty after vendor determined (from override, backorder, or product).
- ✅ **Two new smoke tests:** smoke:backorders:partial-fulfill (partial receive → partial backorder fulfillment) and smoke:suggest-po:moq (MOQ bump verification).
- ✅ **Web PO detail backorder linkage:** Per-line backorder IDs with filtered deep-link to backorders list.
- ✅ **Web SO detail backorder breakdown:** Status badges (open/converted/fulfilled/ignored) show lifecycle per SO.
- ✅ **Mobile SO detail backorder breakdown:** Fetches all statuses, displays count breakdown with status chips.
- ✅ **Mobile backorders Ignore action:** Bulk Ignore workflow integrated (pre-existing, confirmed working).

**CI Posture:**
- 31/31 smoke tests passing in CI (Sprint I added smoke:backorders:partial-fulfill, smoke:suggest-po:moq; Sprint J added smoke:backorders:ignore; Sprint M added smoke:po:create-from-suggestion:line-ids, smoke:so:patch-lines:cid; Sprint E added smoke:line-identity:id-canonical; E4+E5 confirmed web+mobile payloads use canonical id)
- Latest additions: smoke:line-identity:id-canonical (Sprint E, E3) — validates all action endpoints accept `id` (canonical) and emit `id` in responses; existing action smokes (receive/reserve/fulfill/release) updated to use `id` instead of `lineId`; web (E4) and mobile (E5) clients now send canonical `id` in all action payloads
- smoke:views:apply-to-po-list now deletes its temp view after assertions to reduce tenant clutter and avoid downstream flakiness.
- smoke:workspaces:list now paginates with retries to find created items across pages and handle eventual consistency before asserting filters.
- All tests documented in [smoke-coverage.md](smoke-coverage.md)

**What's Next:**
- Sprint planning: Further receive UX polish, inventory visibility, mobile flow refinements
- See [Recent Deliveries](#recent-deliveries) below for complete sprint history
- See [Archive / Sprint History](#archive--sprint-history) for historical context

---

## Module Coverage Matrix

Legend: ✅ done • 🟨 stub/partial • ⬜ planned

| Module              | Spec | Backend | Smokes | UI Stubs | Notes / Next |
|---------------------|:----:|:-------:|:------:|:--------:|--------------|
| Products            | ✅   | ✅      | ✅     | 🟨       | List stable (newest-first + refresh) |
| Inventory           | ✅   | ✅      | ✅     | ✅       | List stabilized (refresh/sort/limit) |
| SalesOrders         | ✅   | ✅      | ✅     | ✅       | List stabilized: newest-first + create-return scroll-to-top; Detail shows backorder resolution breakdown (open/converted/fulfilled/ignored) |
| PurchaseOrders      | ✅   | ✅      | ✅     | ✅       | Detail shows backorder linkage per line; suggest-po applies MOQ regardless of vendor source |
| BackOrders          | ✅   | ✅      | ✅     | ✅       | Detail pages (web/mobile) with SO/PO/item deep-links; bulk ignore + vendor filter; fulfillment progress tracking |
| Party (CRM)         | ✅   | ✅      | ✅     | 🟨       | Hook unification |
| RoutePlans          | ✅   | ✅      | ✅     | 🟨       | Hook unification |
| Scans / EPC         | 🟨   | ✅      | 🟨     | ⬜       | Add seed+resolve (optional) |
| Organizations       | 🟨   | 🟨      | 🟨     | ⬜       | Basic objects exist; UX later |
| Events              | ✅   | ✅      | ✅     | ✅       | List sorting fixed (newest-first) |
| Registrations       | ✅   | ✅      | ✅     | ✅       | CRUD + filters completed (Sprints IV/XI) |
| Resources           | ✅   | ✅      | ✅     | ✅       | List/detail + seed/badges completed (Sprints V/VIII/XII) |
| Reservations        | ✅   | ✅      | ✅     | ✅       | CRUD + conflicts + availability completed (Sprints V–VII) |
| Workspaces/Views    | ✅   | ✅      | ✅     | 🟨       | Views: Web CRUD; Web lists (SO/PO/Inventory/Parties/Products) can save/apply views; Mobile WorkspaceHub deep-links views into SO/PO/Inventory/Parties/Products lists with apply/clear; Workspaces: API aliases views, Web list/detail |
| Telemetry/Analytics | 🟨   | 🟨      | ⬜     | 🟨       | **Sprint L ✅:** SO Commit, PO Receive, PO Approve instrumented end-to-end (API domain events + Web/Mobile UX events); Backorder Ignore ✅; PII sanitization helper ✅; Sentry error capture ✅; PostHog scaffolds ✅ (web/mobile env-config); OTEL future |
| Scorecards/Reports  | ⬜   | ⬜      | ⬜     | ⬜       | Later tier |
| Settings/Config     | ⬜   | ⬜      | ⬜     | ⬜       | Global flags, tenants |

---

## Feature Flags Active

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

## Known Issues / Limitations

- **Multi-PO navigation UX:** When multiple POs are created from suggest-po, no batch summary or navigation guide is shown (Sprint A follow-up)
- **VendorGuard precheck UX:** No proactive banner/inline checks before submit/approve/receive when vendor role is missing (Sprint A follow-up)
- **Recurring reservations:** Out-of-scope for v1 (Sprint V notes)
- **Availability patterns:** "Closed Sundays" style patterns deferred (Sprint V notes)
- **Capacity/multi-resource reservations:** Design-only in v1 (Sprint V notes)
- **Auth policy derivation:** `/auth/policy` endpoint uses dev stub; production should derive scopes from JWT roles (see TODO in apps/api/src/auth/policy.ts line 9)

---

## Recent Deliveries

Full sprint summaries for the last 5 completed sprints. For older history, see [Archive / Sprint History](#archive--sprint-history).

---

## Sprint C — Web Backorders Vertical Slice (2025-12-27)

**Theme:** Complete operator workflow from backorder detection → vendor selection → multi-PO creation → receive with guardrails.

**Scope:** End-to-end backorders → purchase orders with vendor filtering, smart defaults, optimistic UX, and smoke test coverage.

### Error Contract & RequestId Debugging
- Standard error envelope: `{ code, message, requestId, details? }` (errors include the API Gateway `requestId` when available).
- RequestId source: API Gateway context; propagated into structured logs (JSON with requestId, tenant, user, route, method).
- How to debug: search logs by `requestId` to pull the full trace (prefer structured logger output); pair with tenant/route if multiple matches.
- Smokes on timeout: wait helpers log concise blocks (function, ids, expected status, attempts, cursor/pageInfo, body snippet). Body snippets usually include `requestId` from the last API response—use that to find server logs.

### What Shipped

**Core User Story:**
1. **Detect backorders:** SO commit generates `BackorderRequest` records (API already in place)
2. **Triage backorders:** New `/backorders` page with vendor filtering, bulk actions, and deep links to SO/inventory
3. **Suggest POs:** Multi-vendor support with grouped drafts and skipped-reason visibility
4. **Create POs:** Parallel creation from multiple vendor drafts (one PO per vendor)
5. **Receive POs:** Safeguarded receive with location/lot defaults, idempotency, and backorder linkage visibility

### Pages & Routes

- **`/backorders` (BackordersListPage)** — New main worklist
  - Filter by `vendorId` via new `VendorPicker` dropdown component (with manual entry fallback)
  - Bulk actions: "Suggest PO" (multi-vendor modal), "Bulk Ignore" (optimistic removal)
  - Query params for filters: `vendorId`, `status`, `soId`, `backorderRequestId` (shareable URLs)
  - Rows grouped by vendor or ungrouped; item IDs are clickable links to `/inventory/{itemId}`
  - SO IDs are links to `/sales-orders/{soId}`
  
- **`/purchase-orders` (PurchaseOrdersListPage)** — List and filter purchase orders; links to detail. Supports status and vendor filters.

- **`/purchase-orders/:id` (PurchaseOrderDetailPage)** — Enhanced with backorder context
  - New "Backorder Fulfillment" section (blue box) shows line → backorder ID(s) mapping
  - Backorder ID tags are clickable, filter `/backorders?backorderRequestId={id}`
  - Receive defaults (localStorage) prefill location/lot per tenant
  - Receive guards: deltaQty > 0, idempotency key, status checks (not cancelled/closed), refetch after receive
  - Status display normalizes hyphens to underscores (partially-received, etc.)

- **`/purchase-orders/new` + `/purchase-orders/:id/edit`** — Web now supports draft PO create/edit with full line editing via shared LineArrayEditor (same pattern as Sales Orders).

**Quick Links:**
- Web: `/backorders`
- Web: `/purchase-orders`
- Web: `/purchase-orders/:id`

### Components (New & Enhanced)

- **`LineArrayEditor` (new, shared)** — apps/web/src/components/LineArrayEditor.tsx
  - Client-stable row keys (not persisted), add/remove/edit inline table for lines
  - Used by both SalesOrder and PurchaseOrder forms; enables PO draft create/edit lines on web

- **`VendorPicker` (new)** — apps/web/src/components/VendorPicker.tsx
  - Dropdown select with search filtering by name/ID
  - Manual text entry fallback for copy/paste vendor IDs
  - Loads vendors via `POST /objects/party/search` with role="vendor" client-side filter
  - Prefills from localStorage defaults per tenant
  - Pattern mirrors `LocationPicker` (existing component)

- **`SuggestPoChooserModal` (enhanced)** — apps/web/src/components/SuggestPoChooserModal.tsx
  - Single-vendor: Simple "Confirm" button to create 1 PO
  - Multi-vendor: Checkboxes + "Select All" button for multi-selection
  - Blue highlight (#e3f2fd border) on checked drafts
  - New "Skipped Reasons" section (red error box #fff5f5) lists:
    - Backorder IDs that couldn't be suggested
    - Reason per backorder (e.g., "No preferred vendor")
  - `onChooseMultiple` callback: parallel PO creation via `Promise.all()`
  - Result shows success count + any error messages
  - New exports: `SkippedReason` type for upstream integration

### Schema & API

**Spec Updates (spec/MBapp-Modules.yaml):**
- `PurchaseOrderLine` schema: Added optional `backorderRequestIds?: string[] | null` field
- `BackorderRequest.preferredVendorId` documented as filter-eligible in POST `/objects/backorderRequest/search`

**Key Endpoints & Payload Notes:**
- `POST /objects/backorderRequest/search` — Body filters now support `preferredVendorId` to return only backorders for a specific vendor
- `POST /purchasing/suggest-po` — Already returns `draft` or `drafts` array; web now handles multi-draft case with grouping
- `POST /purchasing/po:create-from-suggestion` — Already handles bulk (maps `drafts[]` to multi-PO creation)
- `POST /purchasing/po/{id}:receive` — Already required; receives enforce idempotency + guards
  - Payload: `{ lines: [{ lineId, deltaQty, locationId?, lot? }] }` with `Idempotency-Key` header
  - Errors: `PO_STATUS_NOT_RECEIVABLE` (409), `RECEIVE_EXCEEDS_REMAINING` (409)
- `POST /purchasing/po/{id}:submit` — Transition draft → submitted; requires valid vendor if guard enabled
- `POST /purchasing/po/{id}:approve` — Transition submitted → approved; idempotent; vendor guard enforced when flag is on

**Type Generation:**
After modifying `spec/MBapp-Modules.yaml`, regenerate types for all apps using root scripts:
```bash
# 1. Bundle spec fragments into single OpenAPI file
npm run spec:bundle

# 2. Generate types for API
npm run spec:types:api

# 3. Generate types for mobile
npm run spec:types:mobile
```

**Quick reference:**
- `spec/MBapp-Modules.yaml` — Schema source (split into fragments)
- `spec/openapi.yaml` — Bundled OpenAPI file (read-only, generated by `spec:bundle`)
- `apps/api/src/generated/openapi-types.ts` — Generated types for API
- `apps/mobile/src/api/generated-types.ts` — Generated types for mobile

### Smoke Tests Added

**CI-enabled tests** (run in CI pipeline):
- `smoke:salesOrders:draft-lines-server-assign-ids` — Creates SO draft with lines missing `id`; asserts server assigns line ids and they persist.
- `smoke:purchaseOrders:draft-create-edit-lines` — Creates PO draft with 2 lines, edits draft to drop one and add one; asserts kept line id persists, removed line disappears, new line gets server id.
- `smoke:vendor-filter-preferred` — Validates backorder search filtered by `preferredVendorId`
  - Creates 2 vendors, 2 products with different preferred vendors
  - Creates SO for only item1 (triggers backorder for vendor1)
  - Searches backorders: unfiltered (finds backorder), filtered by vendor1 (finds), filtered by vendor2 (empty)
  - Assertions: Filter correctly includes/excludes based on `preferredVendorId`
  
- `smoke:suggest-po-with-vendor` — Validates suggest-po drafts have correct vendorId + backorderRequestIds
  - Creates vendor + product with `preferredVendorId`
  - Creates SO shortage (triggers backorder)
  - Calls `POST /purchasing/suggest-po` with backorder IDs
  - Asserts: Draft `vendorId` matches preferred vendor, draft lines have `backorderRequestIds` array
  
**Test Registration (ops/ci-smokes.json):**
```json
"flows": [
  ...existing tests...,
  "smoke:salesOrders:draft-lines-server-assign-ids",
  "smoke:purchaseOrders:draft-create-edit-lines",
  "smoke:vendor-filter-preferred",
  "smoke:suggest-po-with-vendor"
]
```

**Run locally:**
```bash
# Single test
node ops/smoke/smoke.mjs smoke:vendor-filter-preferred

# Full CI suite (requires API + env vars)
node ops/smoke/smoke.mjs list  # Shows all available tests
```

**Workflow Smokes (core end-to-end):**
- `smoke:close-the-loop` — Backorders → suggest-po → create → receive (single vendor)
- `smoke:close-the-loop-multi-vendor` — Backorders → suggest-po → create-from-suggestion → receive (multi-vendor)
- `smoke:po:save-from-suggest` — Creates PO from suggestion payload
- `smoke:po:quick-receive` — Minimal receive path validation

**Run examples:**
```bash
# Requires MBAPP_API_BASE, MBAPP_BEARER, MBAPP_TENANT_ID
node ops/smoke/smoke.mjs smoke:close-the-loop
node ops/smoke/smoke.mjs smoke:close-the-loop-multi-vendor
```

### UX Improvements & Patterns

1. **Optimistic updates:** Bulk ignore removes items from list immediately, restores on error (no refetch needed)
2. **Smart defaults:** Location/lot stored per-tenant in localStorage, auto-applied on receive modal open
3. **Deep linking:** Item and SO IDs are clickable throughout the workflow for fast triage
4. **Multi-select with grouping:** Vendor-grouped drafts with visual feedback (blue highlight) for multi-PO workflows
5. **Idempotency:** All state-changing requests (receive, PO creation, suggest-po) include `Idempotency-Key` header

#### Receiving Ergonomics (Sprint E)
- Web: Added "Receive All Remaining (Apply Defaults)" — builds a single multi-line payload and applies order-level defaults (location, lot) only to empty fields; submission is blocked if required defaults are missing.
- Web: Enter key applies defaults on the defaults inputs; Enter on per-line inputs can submit receiving to speed operator flow.
- Mobile: Order-level defaults for location/lot apply during quick receive without overwriting line-specific values; per-line modal remains unchanged.

### How to Verify Locally

**Web flow:**
```
1. Create inventory shortage in SO (commit SO to trigger backorder)
2. Navigate to /backorders
3. See backorder row with SO link, item link
4. Select vendor via VendorPicker → rows filter
5. Click "Suggest PO" → modal shows drafts (possibly multi-vendor)
6. Multi-vendor case: Select drafts via checkboxes, "Create POs" → success message
7. Navigate to PO detail → see "Backorder Fulfillment" section
8. Receive items (defaults prefill location/lot) → status transitions to partially-received → fulfilled
9. Click backorder ID in blue section → filters /backorders by that backorder
```

**API validation:**
```bash
# Vendor-filtered search
curl -X POST https://api.example.com/objects/backorderRequest/search \
  -H "Authorization: Bearer $TOKEN" \
  -d '{ "filters": { "preferredVendorId": "vendor-123" } }'

# Suggest PO with backorder
curl -X POST https://api.example.com/purchasing/suggest-po \
  -H "Authorization: Bearer $TOKEN" \
  -d '{ "requests": [{ "backorderRequestId": "bo-456" }] }'

# Approve PO
curl -X POST https://api.example.com/purchasing/po/PO-123:approve \
  -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{}'
```

**Smoke tests:**
```bash
export MBAPP_API_BASE="https://api.example.com"
export MBAPP_BEARER="valid-jwt-token"
export MBAPP_TENANT_ID="SmokeTenant"

# Run individual tests
node ops/smoke/smoke.mjs smoke:vendor-filter-preferred
node ops/smoke/smoke.mjs smoke:suggest-po-with-vendor
```

### Files Modified/Created

**Web Components & Pages:**
- `apps/web/src/lib/vendors.ts` (new) — Fetch vendor list via party search
- `apps/web/src/components/VendorPicker.tsx` (new) — Dropdown vendor selector
- `apps/web/src/components/SuggestPoChooserModal.tsx` (enhanced) — Multi-vendor support + skipped reasons
- `apps/web/src/pages/BackordersListPage.tsx` (new) — Main backorders worklist + filters + bulk actions
- `apps/web/src/pages/PurchaseOrderDetailPage.tsx` (enhanced) — Backorder linkage section

**Spec & Tests:**
- `spec/MBapp-Modules.yaml` (updated) — `backorderRequestIds` on PurchaseOrderLine
- `ops/smoke/smoke.mjs` (updated) — Added 2 new test functions
- `ops/ci-smokes.json` (updated) — Registered new tests in CI

### Definition of Done
- ✅ VendorPicker renders, fetches vendors, prefills from localStorage
- ✅ BackordersListPage filters by vendor, shows bulk actions, rows link to SO/inventory
- ✅ SuggestPoChooserModal handles multi-vendor, shows skipped reasons, creates multiple POs in parallel
- ✅ Bulk ignore optimistic (no refetch), error recovery works
- ✅ PO receive validates deltaQty, uses defaults, includes idempotency key
- ✅ Backorder linkage visible on PO detail (blue section with clickable links)
- ✅ Deep links from backorders to SO and inventory items work
- ✅ Smoke tests for vendor filtering and suggest-po validation pass
- ✅ Smoke tests registered in CI config
- ✅ Web typecheck clean, no errors

---

## Sprint B — Inventory Operations UX (2025-12-26)

- **InventoryDetailPage enhancements:**
  - **On-Hand by Location table:** New section displays per-location inventory breakdown fetched from `GET /inventory/{id}/onhand:by-location`. Table columns: Location (name resolved from cache), On Hand, Reserved, Available. Location names resolved on first load with fallback to "(unassigned)" if location not found.
  - **Adjust modal:** New modal for manual quantity adjustments. Fields: deltaQty (required, positive or negative, validates non-zero and finite), locationId (optional), lot (optional), note (optional reason). Sends `POST /inventory/{id}:adjust` with `Idempotency-Key` header. Success reloads inventory counters and updates on-hand by location table.
  - **Operator defaults (localStorage):** Modal forms auto-prefill `locationId` and `lot` from browser localStorage keys `mbapp:lastLocationId` and `mbapp:lastLot`. On successful adjust, defaults are saved. Improves efficiency for repeated operations at same location/lot.
  - **Context link to InventoryMovementsPage:** Button guiding users to dedicated movement explorer for that inventory item.
- **InventoryMovementsPage (new page):** Located at `/inventory-movements`, filters movements by optional `locationId` query param. Features:
  - Location-based filtering via query string.
  - Action filter dropdown (all actions available).
  - RefId text filter for source document references.
  - Limit selector: 10, 20, 50, 100 items per page.
  - Cursor-based pagination with "Load More" button.
  - MovementsTable displays: timestamp, action, qty, note, location (resolved), lot, refId.
  - All filters sync to URL for bookmarkable/shareable states.
  - Accessible from InventoryDetailPage and LocationDetailPage with pre-filled locationId.
- **LocationDetailPage enhancement:** Added prominent "View All Movements" button above Details section, navigates to `/inventory-movements?locationId=<id>` to guide users to movement explorer. Existing "Recent Movements" table retained for quick reference.
- **Spec / Implementation Alignment:**
  - **InventoryAdjustmentRequest schema updated:** Only `deltaQty` is required; `reason` (legacy), `note`, and `notes` all optional. Backwards compatible: handler accepts all three field names with fallback priority: `note` → `notes` → `reason`.
  - **API handler logic:** `apps/api/src/inventory/adjust.ts` implements three-level fallback for note extraction, enabling zero-breaking-change upgrade from legacy `reason` field to new `note` field.
  - **Spec: spec/MBapp-Modules.yaml**
    - `InventoryAdjustmentRequest.required`: Only `[deltaQty]` (was `[reason, deltaQty]`)
    - Properties documented with descriptions for backwards compatibility
  - **API: apps/api/src/inventory/adjust.ts**
    - Accepts `reason`, `note`, or `notes` in request body
    - Populates handler's internal `note` field via fallback logic
    - Existing clients using `reason` continue to work without changes
- **Smoke Tests Added:**
  - `smoke:inventory:onhand-by-location` – Creates two locations (A, B); creates product + inventory; adjusts locationA (+10), locationB (+5); verifies aggregate onHand (15) and per-location breakdown; asserts location entries exist, correct values, sum equals aggregate. Tests eventual consistency with 10-attempt retry loop (500ms delays).
  - `smoke:inventory:adjust-negative` – Creates product + inventory; ensures onHand = 5; adjusts by -2 (shrink); verifies onHand decreased to 3; asserts available/reserved counters remain consistent (`available = onHand - reserved`).
  - **Command:** `node ops/smoke/smoke.mjs smoke:inventory:onhand-by-location` or `smoke:inventory:adjust-negative` (not in CI list; opt-in for validation).
- **How to verify locally:**
  - Web: Navigate to inventory detail page → see "On Hand by Location" table → click "Adjust" → fill deltaQty (+/-) and location → save → verify defaults persisted on next modal open → click "View Movements" to navigate to location-specific explorer.
  - API: `POST /inventory/{id}:adjust` with `{ deltaQty: -2, note: "shrink" }` → `GET /inventory/{id}/onhand` verifies delta applied.
  - Smoke: Set env vars, run `node ops/smoke/smoke.mjs smoke:inventory:adjust-negative`.

## Sprint A — Backorders → Purchase Orders Hardening (2025-12-26)

- Backorders Suggest PO flow hardened: handles `draft` or `drafts`, renders `skipped` summary with reasons, and shows a clear error when neither is present.
- PO receive uses canonical `lineId`: prefers `line.id`, then `line.lineId`; fails fast with a helpful UI message if missing.
- PO receive sends an `Idempotency-Key` header by default (uuid v4 when available, with a safe fallback), passed through the apiFetch wrapper.
- Spec aligned: `BackorderRequest.status` enum now includes `fulfilled` to match runtime and smoke expectations.

Follow-ups:
- Multi-PO navigation UX: indicate when multiple POs are created and provide better batch navigation or summary.
- VendorGuard precheck UX: add proactive banner/inline checks before submit/approve/receive when vendor role is missing.

## Warehouse Ops / Sales Outbound

- **Sales reserve/release** now optionally accept locationId (v1). When present, movements record locationId and onhand:by-location reserved reflects it.
- **Sales commit** now emits `inventoryMovement` with `action="commit"` per committed qty. The `locationId` and `lot` are derived from the latest reserve movement for that SO line (via `soId` + `soLineId` filtering); if no reserve exists, defaults to unassigned. This enables location-aware counters and lets web UI auto-default fulfill locations.
- **Movement storage:** `InventoryMovement` type and storage extended with optional `soId` and `soLineId` fields for reliable cross-action correlation (reserve→commit→fulfill).
- If locationId is omitted, behavior remains legacy "unassigned".
- **Smoke coverage:** `smoke:sales:reserve-with-location` and `smoke:sales:commit-with-location` validate location-aware reserve and commit workflows.
- **Future Tier 2:** Add multi-location allocations[] per SO line (pick list) and a GSI for inventoryMovement by (tenantId,itemId) for scale.

## Sprint XLIII: Location-Aware Fulfill + Per-Location Counters (2025-12-26)

- **New endpoint:**
  - GET `/inventory/{id}/onhand:by-location` – Returns array of location-specific counters (`{ itemId, locationId, onHand, reserved, available, asOf }`). Supports null locationId for unassigned stock.
- **Sales fulfill enhancements:**
  - API: POST `/sales/so/{id}:fulfill` now accepts optional `locationId` and `lot` per line: `{ lines: [{ lineId, deltaQty, locationId?, lot? }] }`.
  - Web UI (SalesOrderDetailPage): When order status allows fulfill, table shows:
    - Location column with LocationPicker per line.
    - Lot column with text input per line.
    - "Show/Hide availability" toggle per line → displays nested table of per-location counters (Location, On Hand, Reserved, Available) fetched from `/inventory/{id}/onhand:by-location`.
    - Location names resolved from cached `/objects/location` fetch (limit 200).
  - Fulfill payload includes `locationId` and `lot` when set; server records these in inventory movements.
- **Backend: Location-aware counter derivation:**
  - New function `deriveCountersByLocation(movements)` in `apps/api/src/inventory/counters.ts` groups movements by locationId.
  - Action semantics:
    - `receive`, `adjust`, `cycle_count`: increment onHand at locationId (or "unassigned" if null).
    - `putaway`: moves qty from `fromLocationId` (parsed from note field "from=..." or explicit field) to `toLocationId`; conservative (only credits destination if source unknown).
    - `reserve`, `commit`, `release`: apply to "unassigned" bucket (location-awareness not yet implemented for reservation).
    - `fulfill`: decrements onHand at locationId (or "unassigned").
  - **Important v1 limitations:**
    - Reserve/commit remain aggregate; no location-specific reservation yet.
    - Putaway `fromLocationId` parsing is conservative (regex `/from\s*=\s*([^\s,;]+)/i` on note field); may not deduct from source if note is missing or unparseable.
    - Location counters are best-effort; edge cases (e.g., manual adjustments without locationId) default to "unassigned".
- **Opt-in smoke test:**
  - `smoke:sales:fulfill-with-location` – Creates locations A+B; receives 5 units; putaways to locB; creates SO qty 2; submits/commits; fulfills with `{ locationId: locBId, lot: "LOT-SO" }`; asserts: (1) fulfill succeeds, (2) movement has locationId+lot, (3) `/inventory/{id}/onhand:by-location` shows locB onHand decreased by 2.
  - **Command:** `node ops/smoke/smoke.mjs smoke:sales:fulfill-with-location` (not in CI list; opt-in only).
- **How to verify locally:**
  - Web: Navigate to SO detail page with committed order → see Location and Lot columns in lines table → click "Show availability" → verify per-location counters display → select location and lot → click Fulfill → verify movement recorded with locationId+lot.
  - API: `GET /inventory/{itemId}/onhand:by-location` → returns `{ items: [{ itemId, locationId, onHand, reserved, available, asOf }] }`.
  - Smoke: Set env vars, run `node ops/smoke/smoke.mjs smoke:sales:fulfill-with-location`.

## Sprint XLI: Inventory Putaway + Cycle Count Operations (2025-12-25)

- **New endpoints:**
  - POST `/inventory/{id}:putaway` – Move inventory to a location with optional source location audit trail.
  - POST `/inventory/{id}:cycle-count` – Reconcile inventory by physical count with delta computation.
  - GET `/inventory/movements?locationId=&action=&refId=&limit=&next=` – Query movements by location (NEW); supports optional action/refId filters, cursor pagination (limit max 200).
- **New movement actions:** Extended InventoryMovement action enum from 6 to 8:
  - `putaway` – Location transfer (counter no-op; audit trail only).
  - `cycle_count` – Physical count with delta (like adjust; updates onHand if delta ≠ 0).
- **Movement semantics:**
  - **Putaway:** Records movement but does NOT change onHand; tracks location transfer for audit.
  - **Cycle Count:** Uses `countedQty`; server computes `delta = countedQty - currentOnHand`; records movement with action=`cycle_count` and qty=delta; updates onHand by delta (adjustment semantics).
- **Web UI enhancements:**
  - **InventoryDetailPage** (`/inventory/:id`):
    - Displays movements table with filters (action dropdown, locationId/refId text inputs) + load-more pagination.
    - Putaway modal: qty, toLocationId (required), fromLocationId (optional audit), lot, note; uses LocationPicker.
    - Cycle Count modal: countedQty (required), locationId (optional), lot, note; uses LocationPicker.
    - Both modals include idempotency keys; success reloads inventory data.
  - **LocationsListPage** (`/locations`): Lists locations with name links to detail page.
  - **LocationDetailPage** (`/locations/:id`):
    - Displays location details (ID, name, code, status, kind, parentId, createdAt, updatedAt, notes).
    - Parent location link (if parentId exists).
    - Movements section: filters by action + refId; load-more pagination; updates derived inventory items list as data loads.
    - Derived "Inventory Items Seen at This Location": unique itemIds from loaded movements, linked to `/inventory/{itemId}`.
- **Opt-in smoke tests:**
  - `smoke:inventory:putaway` – Creates locations A+B, product, inventory; ensures onHand ≥ 1; calls putaway (A→B, qty=1); asserts movement and onHand unchanged.
  - `smoke:inventory:cycle-count` – Creates product, inventory; ensures onHand = 5; calls cycle-count (countedQty=2, delta=-3); asserts onHand = 2 and movement with delta.
  - `smoke:inventory:movements-by-location` – Creates 2 locations, product, inventory; putaways qty 1 to locB; queries movements by locationId; asserts all items have locationId=locB and putaway found.
  - **Command:** `node ops/smoke/smoke.mjs smoke:inventory:putaway` or `smoke:inventory:cycle-count` or `smoke:inventory:movements-by-location` (not in CI list).
- **How to verify locally:**
  - Set env: `$env:MBAPP_API_BASE = "https://..."; $env:MBAPP_BEARER = "..."; $env:MBAPP_TENANT_ID = "SmokeTenant"`
  - Run smoke test: `node ops/smoke/smoke.mjs smoke:inventory:movements-by-location`
  - Web verification: Navigate to `/locations` → click a location name → see movements with action/refId filters + load-more button; click inventory item link to verify putaway movements on detail page.

---

## Archive / Sprint History

Historical sprint deliveries and technical implementation details. For current state, see sections above.

### Sources of Truth (SSOT)

Authoritative references for system design and implementation:

- **Roadmap:** [docs/MBapp-Roadmap.md](MBapp-Roadmap.md)
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

## Sprint XL: Locations Updates

- Location is now a first-class object (SSOT) exposed via `/objects/location`.
- Added web `/locations` page for listing, creating, editing, and pagination.
- PO receive now uses `LocationPicker` with manual override fallback retained.
- New opt-in smokes added: `smoke:locations:crud` and updated `smoke:po-receive-lot-location-assertions` to create/use a real location.

## Sprint XXXIX — Receive Defaults + Opt-in Smoke (2025-12-25)

- Web receive defaults (per tenant, localStorage) store last-used lot and locationId.
- UI controls: apply defaults to all lines, per-line "Use defaults", and clear buttons for lot/locationId.
- New opt-in smoke: `node ops/smoke/smoke.mjs smoke:po-receive-lot-location-assertions` (verifies lot/locationId persist to inventory movements).

## Sprint XXXVI — PO Activity + Partial Receive Smoke (2025-12-25)

- **PO Activity Feed (Web):**
  - PO Detail "Activity" is sourced from inventory movements.
  - Endpoint: GET /inventory/{itemId}/movements with query support: refId (poId), poLineId, limit, sort, next (cursor; cursor/pageToken aliases accepted).
  - Renders receive events with action, qty, lot, locationId, timestamps.
- **Partial Receipt Status:**
  - API sets PO.status = "partially-received" (hyphenated) after partial receive.
  - Web normalizes for gating but should expect hyphenated status from server.
- **Runbook:**
  - node ops/smoke/smoke.mjs smoke:close-the-loop-partial-receive

## Sprint XXXVII — Vendor Guard Enforcement + Vendor Portal Notes (2025-12-25)

- **Vendor guard flag:**
  - FEATURE_ENFORCE_VENDOR_ROLE (env)
  - Non-prod override header: X-Feature-Enforce-Vendor: 1 (ignored in prod)
- **Guard behavior:**
  - Enforced on :submit, :approve, :receive
  - Requires po.vendorId exists and vendor party roles includes "vendor"
  - Error codes: VENDOR_ROLE_MISSING (400), VENDOR_REQUIRED (400; defensive—create-from-suggestion requires vendorId)
- **Lifecycle reminder:**
  - submit → approve → receive (approve returns 409 if not submitted)
- **Runbook:**
  - node ops/smoke/smoke.mjs smoke:vendor-guard-enforced

## Sprint XXXVIII — PO Close/Cancel Gates + Receive Blocked Status Guards (2025-12-25)

- **Close gate:**
  - Only status "fulfilled" can close
  - Non-fulfilled PO: 409 "Only fulfilled can close"
  - After close: status becomes "closed"
  - Web UI: Close button hidden until PO is fulfilled; hint: "Close is available once PO is fulfilled."
- **Cancel gate:**
  - Only statuses "draft" or "submitted" can cancel
  - Other statuses: 409 "Only draft/submitted can cancel"
  - After cancel: status becomes "cancelled"
  - Web UI: Cancel button only visible for draft/submitted
- **Receive blocked statuses:**
  - Denied: ["cancelled", "closed", "canceled"]
  - Error code: PO_STATUS_NOT_RECEIVABLE (409)
  - Error shape: `{ code: "PO_STATUS_NOT_RECEIVABLE", status: poStatus }`
- **Web improvements:**
  - Activity tab now filterable by line via dropdown selector
  - Timestamp rendering: prefers createdAt, falls back to at, shows "(no timestamp)" if missing
- **New smokes:**
  - `node ops/smoke/smoke.mjs smoke:po-receive-after-close-guard` — validates receive blocked (409) after close
  - `node ops/smoke/smoke.mjs smoke:po-receive-after-cancel-guard` — validates receive blocked (409) after cancel

## Sprint XXXV — Web Purchasing Workflow Notes (2025-12-25)

**Scope:** Operator-friendly summary of web purchasing and status behavior.

- **PO Detail Actions & Gating:**
  - Submit: visible for statuses `draft` and `open`; server enforces exact gate.
  - Approve: visible for `submitted`.
  - Receive: visible for `approved`, `partially-received`.
  - Cancel: hidden only for `closed`, `cancelled`, `canceled` (server still validates).
  - Close: hidden only for `closed`, `cancelled`, `canceled` (server still validates).
  - Status normalization: UI maps hyphens/uppercase to underscored lowercase; fully received POs surface as `fulfilled` before `close`.

- **Receive Behavior:**
  - Per-line `deltaQty` input; remaining math uses `remaining = max(0, orderedQty - receivedQty)`.
  - Client-side validation prevents over-receive; server returns 409 `RECEIVE_EXCEEDS_REMAINING` with details when attempted.
  - Optional fields: `lot` and `locationId` per line; included only if provided.
  - Idempotency: requests include a unique idempotency key to prevent accidental double-receive.
  - Shortcuts: "Receive Remaining" per line and "Receive All Remaining" convenience button.

- **Backorders Workbench:**
  - Filters: quick filters for `soId` and `itemId` to narrow scope.
  - Grouped View: toggle groups by vendor with header showing vendor name, count, and total quantity; selection persists across groups.
  - Suggest PO Flow: bulk action calls `suggest-po`; if multi-vendor, the UI handles `drafts[]` and proceeds via `create-from-suggestion { drafts }`. Skipped requests show reasons (e.g., ZERO_QTY, MISSING_VENDOR).

**Runbook Snippets:**
```bash
# Typecheck web (apps/web)
cd apps/web && npm run typecheck

# Multi-vendor smoke (opt-in)
node ops/smoke/smoke.mjs smoke:close-the-loop-multi-vendor
```

## Sprint XXXIII — Web Backorders + Suggest PO + Purchase Orders (2025-12-25)

**Date:** 2025-12-25  
**Environment:** AWS API Gateway (https://ki8kgivz1f.execute-api.us-east-1.amazonaws.com)  
**Tenant:** DemoTenant  
**Smoke Results:** Existing `smoke:close-the-loop` validates full BO→PO→receive cycle ✅

**Scope:**
- Web Backorders: List/filter open backorders with bulk ignore and suggest-po workflow.
- Web Purchase Orders: List POs, detail view with status-gated actions (submit/approve/receive/cancel/close).
- Suggest-PO modal: Multi-vendor draft chooser for when suggest-po returns drafts[].
- Full vertical slice: SO shortage → backorders → suggest-po → create PO → approve → receive → inventory increase.

**Key Deliverables:**
- **New web routes:**
  - `/backorders` — BackordersListPage with status filter (open/ignored/converted), vendor filter, bulk actions (Ignore, Suggest PO), checkbox selection
  - `/purchase-orders` — PurchaseOrdersListPage with GET /objects/purchaseOrder, vendor name resolution, pagination
  - `/purchase-orders/:id` — PurchaseOrderDetailPage with status-gated actions, lines table with per-line deltaQty inputs, "Receive remaining" + "Receive all remaining" buttons
- **Components:**
  - `SuggestPoChooserModal.tsx` — Modal for multi-vendor draft selection (displays vendor name, line count, total qty)
  - API helpers: `lib/backorders.ts` (search, ignore, convert) and `lib/purchasing.ts` (suggestPo, create-from-suggestion, submit, approve, receive, cancel, close)
- **Workflow:**
  1. Backorders page: filter status=open → select backorders → Bulk "Suggest PO"
  2. If single vendor: create PO draft → navigate to /purchase-orders/:id
  3. If multi-vendor: open SuggestPoChooserModal → user picks draft → create PO → navigate to detail
  4. PO detail: Submit (draft→submitted) → Approve (submitted→approved) → Receive (set deltaQty per line) → inventory updated
  5. Receive uses idempotency key (`web-receive-${poId}-${Date.now()}`) to prevent accidental doubles
  6. 409 RECEIVE_EXCEEDS_REMAINING errors show helpful inline message
- **Skipped[] behavior:**
  - When suggest-po returns `skipped: [{backorderRequestId, reason}]`, display yellow warning banner with list of skipped backorders and reasons (ZERO_QTY, MISSING_VENDOR, IGNORED, NOT_FOUND)
  - Workflow continues for non-skipped backorders (draft/drafts created normally)

**Files Changed:**
- **Web (new):**
  - Pages: `BackordersListPage.tsx`, `PurchaseOrdersListPage.tsx`, `PurchaseOrderDetailPage.tsx`
  - Components: `SuggestPoChooserModal.tsx`
  - Libs: `lib/backorders.ts`, `lib/purchasing.ts`
- **Web (modified):**
  - `App.tsx` (added routes /backorders, /purchase-orders, /purchase-orders/:id)
  - `Layout.tsx` (added nav links for Backorders, Purchase Orders)

**Acceptance:**
- ✅ Can browse backorders list, filter by status/vendor, ignore individual or bulk
- ✅ Bulk "Suggest PO" handles single-vendor (auto-create + navigate) and multi-vendor (modal chooser)
- ✅ Skipped backorders display in warning banner with reasons
- ✅ Purchase Orders list shows ID, status, vendor name (resolved), created timestamp
- ✅ PO detail shows status-gated actions:
  - Draft: Submit
  - Submitted: Approve
  - Approved/Partially-Received: Receive (with deltaQty inputs per line, "Receive remaining", "Receive all remaining")
  - Draft/Submitted: Cancel
  - Approved/Partially-Received/Fulfilled: Close
- ✅ Receive action refetches PO and updates receivedQty, resets deltaQty inputs
- ✅ TypeScript: Web app passes typecheck (apps/web ✅)
- ✅ Vendor name resolution consistent across all pages (apiFetch /objects/party/{id})

**What's Next (Sprint XXXIV):**
- Polish: Add "Create PO" flow (seed with vendor/items, manual entry) on /purchase-orders page
- VendorGuardBanner on web PO detail (warn if vendor missing or lacks "vendor" role)
- Backorders auto-refresh after PO receive (detect fulfillment, remove from open list)
- Mobile: Sync PO receive history display with web patterns

---

### Multi-vendor smoke (opt-in)

- How to run:
  - `node ops/smoke/smoke.mjs smoke:close-the-loop-multi-vendor`
- What it validates:
  - `suggest-po` returns `drafts[]` for multiple vendors
  - `create-from-suggestion` with `{ drafts }` produces multiple POs
  - `receive` fully processes lines with correct quantities

Note: This flow is excluded from CI by default to avoid churn; run locally when needed.

## Sprint XXIX — Sales Orders Web + Smokes (2025-12-24)

**Date:** 2025-12-24  
**Environment:** AWS API Gateway (https://ki8kgivz1f.execute-api.us-east-1.amazonaws.com)  
**Tenant:** DemoTenant  
**Smoke Results:** Added 2 Sales Order flows; all CI smokes green ✅

**Scope:**
- Web Sales Orders v1: list/search/filter, detail with Submit/Commit (strict toggle), Reserve/Release/Fulfill/Close/Cancel, create/edit forms with partyId + line editor.
- Smokes: strict shortage (409, no BO) and non-strict backorder creation; wired into CI after existing flows.
- Docs: coverage updated for new Sales Orders smokes.

**Key Deliverables:**
- **Web pages:** SalesOrdersListPage (search + status filter + pagination), CreateSalesOrderPage, SalesOrderDetailPage (actions + refresh), EditSalesOrderPage, SalesOrderForm (reusable lines editor).
- **Routing/Nav:** App routes for /sales-orders (list/detail/create/edit); Layout nav link; Home quick link.
- **Smokes:** `smoke:salesOrders:commit-strict-shortage` (strict commit → 409, no backorder) and `smoke:salesOrders:commit-nonstrict-backorder` (non-strict commit → shortages[] + backorderRequest). Both added to ci-smokes.json.
- **Spec note:** MBapp-Modules.yaml documents web UI usage of /objects/salesOrder draft fields.

**Acceptance:**
- ✅ Web Sales Orders flow works against AWS: create draft, submit, commit (strict/non-strict), reserve/release, fulfill, close/cancel with refetch.
- ✅ New smokes pass locally and run in CI (AWS-only, bearer required, eventual-consistency retries baked in).
- ✅ Typechecks: api/web/mobile pass after changes.

**Runbook:**
```bash
# Web
cd apps/web && npm run typecheck

# Smokes (new ones)
node ops/smoke/smoke.mjs smoke:salesOrders:commit-strict-shortage
node ops/smoke/smoke.mjs smoke:salesOrders:commit-nonstrict-backorder

# CI set (includes new flows)
node ops/tools/run-ci-smokes.mjs
```

---

## Sprint XXVII — Products + Inventory Vertical Slice (2025-12-23)

**Date:** 2025-12-23  
**Environment:** AWS API Gateway (https://ki8kgivz1f.execute-api.us-east-1.amazonaws.com)  
**Tenant:** DemoTenant  
**Smoke Results:** 41 total (39 baseline + 2 new), 41 passed, 0 failed ✅

**Scope:**
- Products: Full CRUD on Web + Mobile (create/edit forms, list/detail with search + pagination).
- Inventory: Read-only views on Web + Mobile (list/detail with onHand stats + movements table).
- New smokes: `smoke:products:crud` (create → get → update → search) and `smoke:inventory:crud` (create → get → update → onhand).
- CI wiring: Both new smokes added to `ops/ci-smokes.json` flows.

**Key Deliverables:**
- **Web Products**: ProductForm (reusable component), ProductsListPage, ProductDetailPage, CreateProductPage, EditProductPage with search + pagination + inventory cross-link.
- **Web Inventory**: InventoryListPage (with productId filter support), InventoryDetailPage (with optional onHand fetch + movements table).
- **Mobile Products**: CreateProductScreen + EditProductScreen with type selector (good/service toggle), price field, preferredVendorId; integrated with ProductsListScreen ("Create" button) and ProductDetailScreen ("Edit" button).
- **Mobile navigation**: Added CreateProduct/EditProduct to RootStackParamList; registered screens in RootStack.
- **Smokes AWS-only**: `smoke:products:crud` validates create → get (with retry) → update (name+price) → search (with retry); `smoke:inventory:crud` validates create → get → update → onhand fetch.
- **Typecheck enforcement**: All three apps (api/web/mobile) pass `npm run typecheck` with zero errors.

**Files Changed:**
- **Web (new)**: `ProductForm.tsx`, `ProductsListPage.tsx`, `ProductDetailPage.tsx`, `CreateProductPage.tsx`, `EditProductPage.tsx`, `InventoryListPage.tsx`, `InventoryDetailPage.tsx`
- **Web (modified)**: `Layout.tsx` (Products + Inventory nav links), `App.tsx` (6 product/inventory routes)
- **Mobile (new)**: `CreateProductScreen.tsx`, `EditProductScreen.tsx`
- **Mobile (modified)**: `RootStack.tsx` (screen registration), `navigation/types.ts` (CreateProduct/EditProduct types), `ProductsListScreen.tsx` (Create button), `ProductDetailScreen.tsx` (Edit button)
- **Smokes**: `ops/smoke/smoke.mjs` (added smoke:products:crud + smoke:inventory:crud), `ops/ci-smokes.json` (flows updated)

**Acceptance:**
- ✅ Web Products CRUD works end-to-end (create/edit forms, list/search/pagination, detail view with inventory link).
- ✅ Web Inventory read-only works (list with productId filter, detail with onHand + movements).
- ✅ Mobile Products CRUD works (create/edit screens, navigation integration, type selector, price validation).
- ✅ smoke:products:crud passes (create → get → update → search with eventual-consistency retry).
- ✅ smoke:inventory:crud passes (create → get → update → onhand fetch).
- ✅ CI smokes: 41/41 pass (parties-crud, products-crud, inventory-crud, close-the-loop).
- ✅ TypeScript: All apps pass typecheck (api ✅, web ✅, mobile ✅).
- ✅ AWS-only enforcement: No localhost fallback, no hardcoded tokens.

**What's Next (Sprint XXVIII):**
- Close-the-loop surfaced on Web (SO detail shows BO links; PO detail shows receive history).
- Mobile: Inventory adjust UI (increment/decrement onHand with movement capture).
- Polish: Error boundaries, loading states, toast notifications on web.

---

## Sprint XXVI — Tier 1 Foundations: Web Client + AWS-Only Smokes (2025-12-23)

**Date:** 2025-12-23  
**Environment:** AWS API Gateway (https://ki8kgivz1f.execute-api.us-east-1.amazonaws.com)  
**Tenant:** DemoTenant  
**Smoke Results:** 39 total (38 baseline + 1 new), 39 passed, 0 failed ✅

**Scope:**
- Web app foundational CRUD: Parties list/search → detail → create → edit with bearer token UI.
- AWS-only smokes: removed localhost fallback, dev-login removed, require `MBAPP_BEARER` and `MBAPP_API_BASE` at startup.
- New smoke: `smoke:parties:crud` validates create → read → update → search with idempotency keys and eventual-consistency retry.

**Key Deliverables:**
- **Web client**: HttpProvider (http.ts) + AuthProvider + Layout with nav + token setter UI; Parties CRUD pages (PartiesListPage, PartyDetailPage, CreatePartyPage, EditPartyPage) using apiFetch.
- **Smokes AWS-only**: API base and bearer required; no localhost fallback; no dev-login fallback. Exits(2) with clear error if env missing.
- **New smoke:parties:crud**: create party → GET by id → update name → GET verify → search to find party (5 retries × 200ms for eventual consistency).
- **CI wiring**: smoke:parties:crud added to ops/ci-smokes.json before close-the-loop.

**Files Changed:**
- `apps/web/.env.sample` — AWS API Gateway defaults.
- `apps/web/src/lib/http.ts` — HTTP wrapper with bearer + tenant headers, error normalization.
- `apps/web/src/providers/AuthProvider.tsx` — Token context (localStorage + VITE_BEARER).
- `apps/web/src/components/Layout.tsx` — Nav links + token input UI.
- `apps/web/src/components/PartyForm.tsx` — Shared form for create/edit.
- `apps/web/src/pages/*.tsx` — Parties list/detail/create/edit pages.
- `apps/web/src/App.tsx`, `main.tsx` — Router wiring + AuthProvider wrapper.
- `ops/smoke/smoke.mjs` — AWS-only enforcement, new smoke:parties:crud test.
- `ops/ci-smokes.json` — Added smoke:parties:crud to flows.

**Acceptance:**
- ✅ Web parties CRUD works end-to-end against AWS (with bearer + tenant headers).
- ✅ smoke:parties:crud passes (create → get → update → search).
- ✅ Smokes fail fast if MBAPP_API_BASE or MBAPP_BEARER missing.
- ✅ No localhost fallback anywhere.
- ✅ npm run typecheck passes (apps/web).

---

## Sprint XXV Wrap – 2025-12-23 (38/38 Smoke Pass)

**Date:** 2025-12-23  
**Environment:** AWS API Gateway (https://ki8kgivz1f.execute-api.us-east-1.amazonaws.com)  
**Tenant:** DemoTenant  
**Smoke Results:** 38 total, 38 passed, 0 failed ✅

**Key Fixes:**
- **PO receive status:** Fully received POs now transition to `fulfilled` status (was `received`), aligning with po-close requirements
- **Over-receive validation:** `POST /purchasing/po/{id}:receive` now validates over-receive attempts BEFORE idempotency checks, returning 409 conflict with `RECEIVE_EXCEEDS_REMAINING` error code including detailed delta validation (lineId, ordered, received, remaining, attemptedDelta)
- **Idempotency behavior clarified:** Key-based and payload-signature idempotency keys are marked/applied ONLY on successful writes; failed operations (e.g., over-receive) are NOT cached and will re-validate on retry
- **Close-the-loop smoke flow:** Updated to seed vendor party at flow start, set `preferredVendorId` on product, so `so:commit` derives vendor for backorderRequests and `suggest-po` returns drafts without MISSING_VENDOR errors
- **Registrations feature flag:** `smoke:common:error-shapes` now explicitly sends `X-Feature-Registrations-Enabled: 0` header for 403 forbidden test, ensuring deterministic behavior regardless of AWS environment feature flag settings

**Files Changed:**
- `ops/smoke/smoke.mjs` — Updated smoke expectations (receive status, over-receive 409, vendor seeding, feature flag headers)
- `apps/api/src/purchasing/po-receive.ts` — Status naming fix (fulfilled), over-receive guard moved before payload-sig idempotency, enhanced 409 error details
- `apps/api/src/sales/so-commit.ts` — `preferredVendorId` derivation for backorderRequests (product.preferredVendorId → backorderRequest.preferredVendorId)
- `apps/api/src/common/responses.ts` — Added `conflictError()` helper matching error shape conventions

---

## Sprint XXV – Close-the-loop, Role-aware Pickers, Smoke Coverage

- PO receive supports both deltaQty and receivedQty for compatibility; status guard logic normalized
- Receiving writes inventory movements; /inventory/{itemId}/onhand derives from movements
- suggest-po populates PurchaseOrderLine.backorderRequestIds and marks requests as converted
- Receiving fulfills linked backorderRequests (status="fulfilled")
- VendorPicker/CustomerPicker role-aware autocomplete passes role hint through searchRegistry to findParties (role query param)
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
### ✅ Sprint XXII — Suggest-PO Hardening
- Backend: `POST /purchasing/suggest-po` now skips invalid backorders with `skipped[]` reasons (ZERO_QTY, MISSING_VENDOR/NOT_FOUND) and never emits vendor-less drafts.
- Mobile: Backorders list sends `preferredVendorId` as a server filter, adds Apply/Clear for vendor input, and shows a skipped summary after convert.
- Smokes: Added `smoke:purchasing:suggest-po-skips` to cover skipped reasons and vendor enforcement.

### ✅ Sprint XXIII — Backorders Vendor UX + Copy QoL
- **Backorders vendor filter:** VendorPicker autocomplete auto-applies on selection; Clear Vendor resets. Vendor search registry maps `vendor` → `party` to align with backend object search.
- **Long-press copy IDs:** Added long-press copy + "Copied" toast on ID fields across detail screens (Party, SalesOrder, PurchaseOrder, Product, Inventory, Registration, Reservation).
- **Toast kinds extended:** Toast now supports `info` and `warning` (in addition to `success`/`error`) to resolve typecheck and match UX needs.
- **Search dropdown reliability:** AutoCompleteField dropdown overlay layering improved (e.g., Android elevation/zIndex).

Files touched (high level):
- apps/mobile/src/screens/BackordersListScreen.tsx
- apps/mobile/src/features/_shared/searchRegistry.tsx
- apps/mobile/src/features/_shared/AutoCompleteField.tsx
- apps/mobile/src/features/_shared/Toast.tsx
- apps/mobile/src/screens/*DetailScreen.tsx (copy ID)

Tests:
- Mobile typecheck + tests green
- Manual smoke: vendor autocomplete suggestions visible + selectable; long-press copy works; toast kinds render

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
- **Idempotency behavior:**
  - **Dual-track:** Both `Idempotency-Key` header (key-based) and payload-signature (content-based).
  - **Key-based** idempotency is checked BEFORE validation (safe short-circuit for previously successful requests).
  - **Payload-signature** idempotency is checked AFTER validation (prevents caching invalid requests).
  - **Caching policy:** Idempotency keys are marked/applied ONLY on successful writes; failed operations (e.g., over-receive) are NOT cached.
  - **Over-receive validation:** Returns 409 conflict with `details.code = "RECEIVE_EXCEEDS_REMAINING"` including `{ lineId, ordered, received, remaining, attemptedDelta }`.
  - **Retry behavior:** Repeating an invalid over-receive with the same idempotency key will still return 409 (not cached success).
- Inventory movement writes normalized (`type/docType`, `action`, `at`, `refId`, `poLineId`, optional `lot/locationId`).
- Inventory create hardening: verb coercion and **reserve guard** (409 if qty > available).
- List APIs include optional `pageInfo`; mobile hook surfaces it without breaking `{ items, total? }`.
- Mobile PO detail screen: per-line Receive modal wired via centralized `poActions.receiveLine()`; toasts + disabled states aligned to shared pattern.
- **Mobile scan-to-receive + scan-to-fulfill:**
  - New `resolveScan()` utility (apps/mobile/src/lib/scanResolve.ts) prioritizes: inventory ID → EPC API lookup → QR format → error.
  - PO Detail: Scan-to-receive implemented in apps/mobile/src/screens/PurchaseOrderDetailScreen.tsx; pending-state Map keyed by lineId, +1 per scan, capped by remaining (`qty - receivedQty`); supports undo/clear; batch submit includes `Idempotency-Key` (`po:${id}#scan:${SMOKE_RUN_ID|timestamp}#lines:${count}`).
  - SO Detail: Scan-to-fulfill implemented in apps/mobile/src/screens/SalesOrderDetailScreen.tsx; same aggregation pattern (+1 per scan, cap by fulfillable remaining); batch submit includes `Idempotency-Key` (`so:${id}#scan:${SMOKE_RUN_ID|timestamp}#lines:${count}`).
  - `fulfillSalesOrder()` API accepts both `FulfillLine[]` and `{ lines: FulfillLine[] }` for backward compatibility; normalizes before POST.
  - Idempotency: All batch submits send `Idempotency-Key`; same key safely retries the same batch without double-apply; different runs produce different keys.
  - Scan line selection rule: When multiple SO/PO lines share the same itemId, scanning targets a line with remaining > 0 and prefers the line with the greatest remaining. Ties break deterministically by original order.
  - Idempotency key stability tip: During dev runs, setting `EXPO_PUBLIC_SMOKE_RUN_ID` (or `SMOKE_RUN_ID`) makes scan-batch `Idempotency-Key` stable for retries.

**Smokes (green)**
- `smoke:inventory:onhand`, `smoke:inventory:guards`, `smoke:inventory:onhand-batch`, `smoke:inventory:list-movements`
- `smoke:po:receive-line`, `smoke:po:receive-line-batch`
- `smoke:po:receive-line-idem-different-key` (new)
- `smoke:webish:purchaseOrders:list-detail-join` (new, web-style reliability test)

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
- **Backorders navigation**: SO detail header shows tappable "Backorders present" badge when `so.backorders.length > 0`; navigates to BackordersList and passes `soId` param for client-side filtering (v2 in Sprint XIX).
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

## ✅ Sprint XIX — BackordersList Deep-Link Filter by soId (2025-12-22)

**Theme:** Client-side filtering of BackordersList when navigating from SalesOrderDetailScreen, passing Sales Order context without backend changes.

**Mobile**
- **SO → BackordersList deep-link**: SO detail backorder badge/pill now passes `{ soId: so.id }` to BackordersList route; BackordersList reads `route.params?.soId` and applies client-side filter to show only backorders matching that soId.
- **Filter banner**: When soId is active, a non-invasive blue banner at top shows "Filtered to Sales Order: <id>" with a "Clear" pressable that navigates back to BackordersList without params (resetting to show all open backorders).
- **Preserved behavior**: Existing vendor filter and pagination remain unaffected; soId filter chains with vendor filter if both present.
- **Note:** Client-side filter only; backend list endpoint does not support `filter.soId` yet. When both filters applied, client receives full list and filters locally.

**Files Modified**
- Mobile: `apps/mobile/src/navigation/types.ts` (BackordersList param type)
- Mobile: `apps/mobile/src/screens/SalesOrderDetailScreen.tsx` (pass soId to nav)
- Mobile: `apps/mobile/src/screens/BackordersListScreen.tsx` (read soId, apply filter, show banner)

**Definition of Done**
- [x] Navigation param type updated (soId optional)
- [x] SalesOrderDetailScreen passes soId on badge/button press
- [x] BackordersListScreen reads and filters by soId
- [x] Filter banner shown when soId present; Clear button resets
- [x] Existing vendor filter and pagination work with soId
- [x] Typecheck passes

---

## ✅ Sprint XXI — Backorders Worklist Filters + Deep-Link Polish (Tier 1) (2025-12-23)

**Theme:** Extend BackordersList to support multi-filter deep-linking (soId, itemId, status, preferredVendorId) and enable per-line navigation from SalesOrderDetailScreen.

**Mobile**
- **Navigation param expansion**: BackordersList now accepts `{ soId?, itemId?, status?, preferredVendorId? }` (all optional, backward compatible).
- **Server-side filter with defaults**: BackordersListScreen reads all route params and builds server-side filter:
  ```ts
  const filter = {
    status: status ?? "open",  // Default to "open" if not specified
    ...(soId ? { soId } : {}),
    ...(itemId ? { itemId } : {}),
    ...(preferredVendorId ? { preferredVendorId } : {}),
  };
  ```
  - **Removed `q: "open"`** — now exclusively using `filter.status="open"` on backend
  - Vendor text filter remains client-side only (optional refinement, not sent to server)
- **Multi-filter banner**: Displays all active filters in one readable line:
  ```
  Filters: status=open · soId=... · itemId=... · vendor=...
  ```
  - Shows only when any filter is active (soId || itemId || status !== "open" || preferredVendorId)
  - **Clear All** button resets all params via `setParams()` (no navigation stack duplication)
- **Per-line deep-link**: SalesOrderDetailScreen backorder badge now tappable when qty > 0
  - Pressing badge navigates to BackordersList filtered by both `soId` + `itemId`
  - BadgeComponent updated to accept optional `onPress` prop and render as Pressable when provided
  - Non-pressable (View) when qty == 0 (no deep-link)

**Backend** (unchanged from Sprint XX, reused)
- Filter parsing and application already support arbitrary `filter.*` params
- `filter.status`, `filter.itemId`, `filter.preferredVendorId` all handled via generic exact-match AND logic

**Files Modified**
- Mobile: `apps/mobile/src/navigation/types.ts` (extend BackordersList param type)
- Mobile: `apps/mobile/src/screens/BackordersListScreen.tsx` (read all params, build server-side filter, update banner)
- Mobile: `apps/mobile/src/features/backorders/BackorderBadges.tsx` (add onPress prop to BackorderLineBadge)
- Mobile: `apps/mobile/src/screens/SalesOrderDetailScreen.tsx` (deep-link navigation from line badge)

**Definition of Done**
- [x] BackordersList route param type extended to include itemId, status, preferredVendorId
- [x] BackordersListScreen reads all route params and builds server-side filter with status default
- [x] Removed `q: "open"`; now exclusively using `filter.status="open"` on backend
- [x] Multi-filter banner displays all active filters; Clear All resets all params via setParams()
- [x] BackorderLineBadge accepts optional onPress prop; renders as Pressable when provided
- [x] SalesOrderDetailScreen deep-links to BackordersList with soId + itemId when line badge tapped (qty > 0)
- [x] Vendor text filter remains client-side only (not sent to server)
- [x] Typecheck passes on all modified files

---

## ✅ Sprint XX — Server-Side filter.soId Support + Pagination-Aware Cursor (2025-12-23)

**Theme:** Move soId filtering from mobile client to backend, enabling server-side efficiency and enabling pagination correctness when filtering causes mid-page early exit.

**Backend**
- **Filter parsing**: `/objects/{type}` GET endpoint now parses `filter.soId`, `filter.itemId`, `filter.status`, `filter.preferredVendorId` query parameters (any `filter.*` key-value pairs).
- **Pagination-aware filtering loop**: Rewrote `listObjects()` in repo.ts to fetch paginated batches from DynamoDB, apply filters + q-search on each batch, and **use last-returned-item's PK/SK as next cursor** (not Dynamo's LastEvaluatedKey). This prevents skipping items when filtering causes early exit from a DynamoDB page.
- **Cursor format**: Still base64-encoded JSON; now stores `{ tenantId, type#id }` to resume from correct position.
- **Spec documentation**: OpenAPI spec updated to document filter.* parameters and pagination behavior.

**Mobile**
- **Integration**: BackordersListScreen now passes `filter: { soId }` directly to `useObjects()` hook (which already supported filter param via URLSearchParams).
- **Removed client-side filter**: soId filtering loop in BackordersListScreen eliminated; all filtering now server-side.
- **UX unchanged**: Filter banner, Clear button, vendor filter all preserved; only backend now handles soId filtering.

**Files Modified**
- Backend: `apps/api/src/objects/list.ts` (parse filter.* query params; lines 20–31)
- Backend: `apps/api/src/objects/repo.ts` (rewrite listObjects pagination-aware loop; lines 145–245)
- Mobile: `apps/mobile/src/screens/BackordersListScreen.tsx` (use filter param in useObjects; remove client-side filtering)
- Spec: `spec/MBapp-Modules.yaml` (document filter.* params in /objects/{type} GET endpoint)

**Key Design Decision: Pagination Cursor**
When filtering causes `collected >= limit` before reaching DynamoDB's `LastEvaluatedKey`, we set the next cursor's `ExclusiveStartKey` to the last-returned-item's `{ tenantId, type#id }` rather than Dynamo's `LastEvaluatedKey`. On next request, DynamoDB resumes from `ExclusiveStartKey` (which is exclusive, so first item on next page is the one after our last returned item). This ensures:
1. No duplicate items across pages
2. No skipped items between pages
3. Correct pagination with filters applied

**Smoke Test Added**
- New test `smoke:objects:list-filter-soId` validates:
  1. Seeds Sales Order with 2 lines that exceed on-hand, triggering backorder requests
  2. Fetches `/objects/backorderRequest?filter.soId={soId}&limit=1` (first page)
  3. Verifies all returned items match soId filter
  4. If pagination cursor exists, fetches page 2 and re-verifies filter applied
  5. Ensures no mid-page skip or duplicate items

**Definition of Done**
- [x] Filter query params parsed and passed to repo
- [x] listObjects rewritten with pagination-aware loop
- [x] Cursor stores last-returned-item PK/SK, not Dynamo's LastEvaluatedKey
- [x] Mobile integration updated (filter param passed, client-side loop removed)
- [x] Spec updated to document filter.* params
- [x] Smoke test added and passes
- [x] Typecheck passes on all modified files

---

## ✅ Sprint II — Results (2025-10-24)

**Theme:** Vendor guardrails, receive idempotency, movement filters, and event stubs — with smoke coverage and DX flags.

**Backend**
- **Vendor guard (submit/approve/receive):** enforced via `featureVendorGuardEnabled` (env in prod, header override in dev/CI). Validates `purchaseOrder.vendorId` points to a **Party** with role `vendor` using `getObjectById({ tenantId, type:"party", id })`.
- **Receive handler hardening:** `/purchasing/po/{id}:receive`
  - Uses shared `getPurchaseOrder` / `updatePurchaseOrder` so status transitions match submit/approve.
  - **Idempotency:** (1) key ledger `Idempotency-Key`; (2) payload-signature hash of canonical `lines[]` to prevent double-apply across different keys.
  - **Guards:** only `approved | partially-received`; 409 on over-receive per line.
  - **Movements shape:** writes `docType:"inventoryMovement"`, `action:"receive"`, `refId` (po id), `poLineId`, optional `lot`/`locationId`, `at`, `createdAt`/`updatedAt`.
  - **Events:** integrated `maybeDispatch` with **simulate** header (`X-Feature-Events-Simulate`) returning `_dev.emitted: true` in responses when exercised by smokes.
- **Movements list:** `GET /inventory/{id}/movements` now supports additive query filters `refId` and `poLineId` (filtered after the pk/sk query), returns optional `pageInfo` alongside legacy `next`.
  - Query scans tenant-partitioned movement rows and paginates internally until it collects N matches for the requested `itemId` (tenants may have many movements for other items).
  - Smokes request a larger limit (e.g., `limit=50`) to reduce paging pressure and flakiness.
  - Future ideal: add a DynamoDB GSI keyed by `(tenantId, itemId)` for `inventoryMovement` rows to make item movement queries O(1) without paging.
  - Tier 2 hardening: add DynamoDB GSI keyed by `(tenantId, itemId)` for `inventoryMovement` to enable direct item movement queries (avoid tenant scan/pagination); include a backfill strategy for existing movement rows.

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
