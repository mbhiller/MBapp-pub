Sprint III — Theme: Views & Workspaces v1 + Event plumbing options

---

## Sprint X — Closeout (Parties read-only + dev seed)

- Parties module tile gated by permission `parties:read`.
- PartyListScreen: search, optional role filter, error banner, tap-to-detail.
- PartyDetailScreen: read-only detail with error banner + retry.
- Party label/roleFlags typing fixed; PartyPicker/PartySelectorModal no longer rely on `.name`.
- __DEV__ seed party button for testing (uses `/objects/party`, aligns optional `partyRole`).
- Verification command: `cd apps/mobile && npm run typecheck`.
- Manual QA: seed a party, refresh list (search + role filter), open detail (error banner/retry paths).

---

## Sprint XI — Registrations Enabled + Parties UX

- Registrations:
  - Mobile `FEATURE_REGISTRATIONS_ENABLED` now respects `EXPO_PUBLIC_FEATURE_REGISTRATIONS_ENABLED` (removed `__DEV__` forced false).
  - Registrations tile visible when enabled; backend `/registrations` returns 200.
  - Related registrations shown on EventDetail and PartyDetail when enabled.
  - __DEV__ Seed Registration button added; CI runs registrations smokes via `ops/ci-smokes.json`.

- Parties:
  - __DEV__ Seed Party also creates `partyRole` (customer/vendor) to match smoke canonical seeding.
  - PartyListScreen: created/updated timestamp, NEW badge for recent items, newest-first sort, fixed client-side role filter — easier to spot newly seeded parties.

Verification
- `cd apps/mobile && npm run typecheck`
- `node ops/tools/run-ci-smokes.mjs`

Context
- Treat previous chats as stale. Use ONLY attached files for this sprint.
- Repo: C:\Users\bryan\MBapp-pub
- Target branch: feat/tier1-sprint-III
- Smoke runner: ops/smoke/smoke.mjs (seeds in ops/smoke/seed/*)
- Mobile app: Expo React Native
- API app: apps/api/src

Scope (no code yet)
- Goals:
  - V1 “Views”: API + minimal UI to save/search/update/delete list views (entity type, filters, sort, columns).
  - “Workspaces” landing UI to browse/launch saved views.
  - Event dispatcher options (feature-flagged): keep noop default; optionally emit to EventBridge/SNS.
- Out of scope:
  - Data migrations (we will not create GSI in this sprint).
  - Complex query builders; we’ll support key/value filters first.

Deliverables I expect (sequence)
1) Terminology & scope confirmation.
2) File request list (EXACT paths) for:
   - API: `apps/api/src/views/*` (new), any shared repos you intend to reuse, events dispatcher hook point.
   - Frontend: hooks/components/screens to host Views & Workspaces UX; routing entry points.
   - Smokes: updates to `ops/smoke/smoke.mjs`.
3) Per-file change plan (surgical, minimal).
4) Smoke plan: flow names + assertions.
5) After I approve: drop-in code PRs.

Guardrails
- Use feature flags:
  - `FEATURE_VIEWS_ENABLED` (default: false)
  - `FEATURE_EVENT_DISPATCH_ENABLED` (default: false)
  - `FEATURE_EVENT_DISPATCH_SIMULATE` (default: false)
- Mirror existing patterns: `/objects/*` style for storage; `flags.ts` header overrides in dev only.
- Do not change purchase order flows in this sprint.

Environment & Flags (confirm before coding)
- FEATURE_VIEWS_ENABLED=<default false>
- FEATURE_EVENT_DISPATCH_ENABLED=<default false>
- FEATURE_EVENT_DISPATCH_SIMULATE=<default false>
- MBAPP_USE_GSI1=<default false> (design stub only this sprint)

Smokes & Commands
- New flows:
  - `smoke:views:crud` — create a view, list/search views, update name/filters, delete view.
  - `smoke:workspaces:list` — list views for the workspace hub (expects at least 1).
  - `smoke:events:enabled-noop` — ensure dispatcher toggles on w/ simulate path, no external.
- I’ll run with:
  - `node ops/smoke/smoke.mjs smoke:views:crud`
  - `node ops/smoke/smoke.mjs smoke:workspaces:list`
  - `node ops/smoke/smoke.mjs smoke:events:enabled-noop`

Files attached now
- (You will attach after kickoff approval): current `flags.ts`, `events/dispatcher.ts`, `ops/smoke/smoke.mjs`, any frontend routing files.

Before coding, respond with:
- (A) Scope confirmation
- (B) File gaps (exact paths you still need)
- (C) Per-file change plan
- (D) Smoke plan (flows + assertions)

---

Sprint V — Theme: Resources/Reservations (Option 2 foundation)

Context
- Branch: `feat/tier1-sprint-V-option2-reservations`
- Repo: C:\Users\bryan\MBapp-pub
- Smoke runner: ops/smoke/smoke.mjs (new flows for reservations)
- API app: apps/api/src (uses existing generic /objects/* CRUD)

Scope
- Goals:
  - Add **Resource** and **Reservation** objects (both stored in generic objects table).
  - Leverage existing generic `/objects/:type` CRUD routes for create/read/update/delete.
  - Add TWO custom endpoints:
    - `POST /reservations:check-conflicts` — validate time slot availability.
    - `GET /resources/{id}/availability?from=ISO&to=ISO` — list busy periods.
  - Enforce overlap detection on reservation create/update: return **409 Conflict** with code="conflict".
  - Feature flag: `FEATURE_RESERVATIONS_ENABLED` (default: false, dev header override).
  - RBAC: `resource:read|write`, `reservation:read|write` permissions.
- Out of scope:
  - Reservation actions (cancel, start, end) — foundation only.
  - Mobile UI beyond read-only preview.
  - Complex calendar/scheduling UI.

Overlap Rule
- Two time slots overlap if: `(aStart < bEnd) && (bStart < aEnd)`.
- On overlap: throw 409 with `{ code: "conflict", message: string, details: { conflicts: [...] } }`.

Feature Flag & RBAC
- Flag: `FEATURE_RESERVATIONS_ENABLED` (env: `FEATURE_RESERVATIONS_ENABLED`, header: `X-Feature-Reservations-Enabled`).
- Permissions:
  - `resource:read` — list/get resources
  - `resource:write` — create/update/delete resources
  - `reservation:read` — list/get reservations
  - `reservation:write` — create/update/delete reservations (checked for overlap on write)

Deliverables (in order)

---

## Sprint VI — Reservations Write UI (Option A) (Completed 2025-12-21)

**Context**
- Branch: `feat/tier1-sprint-VI-reservations-write`
- Mobile-focused: Create/Edit reservation screens with conflict handling.

**Scope**
- Mobile screens: `CreateReservationScreen`, `EditReservationScreen`.
- Form fields: resourceId (ResourcePicker), startsAt, endsAt, status.
- Validation: ISO datetime format, startsAt < endsAt.
- Conflict handling: 409 → show error message + conflict list with "View" actions.
- Feature flag: `EXPO_PUBLIC_FEATURE_RESERVATIONS_ENABLED` (default: false).

**Deliverables**
- ✅ Create/Edit screens with ResourcePicker.
- ✅ 409 conflict enrichment in `reservations/api.ts`.
- ✅ Flag-gated Create/Edit entry points.
- ✅ Mobile typecheck passes.

**How to Enable**
```
EXPO_PUBLIC_FEATURE_RESERVATIONS_ENABLED=true
```

---

## Sprint VII — Availability-First Reservation UX (Completed 2025-12-21)

**Context**
- Branch: `feat/tier1-sprint-VII-reservations-availability`
- Mobile enhancement: show busy blocks, suggest next available slot, add list filters.
- Smoke: validate availability endpoint reflects created reservations.

**Scope (Mobile-focused)**
- Goals:
  - Display **busy blocks** (reservations) on Create/Edit screens for selected resource.
  - Offer **"Use next available slot"** button when conflict occurs.
  - Add **resourceId** and **status** filters to ReservationsList.
  - Enhance smoke to validate availability endpoint includes created reservation.
- Out of scope:
  - Calendar/timeline visualization (basic list only).
  - Advanced scheduling (e.g., recurring, recurring patterns).

**Deliverables**
- ✅ `getResourceAvailability()` in `apps/mobile/src/features/reservations/api.ts`.
- ✅ Availability display (14-day window) on Create/Edit screens.
- ✅ "Use next available slot" button with intelligent suggestion algorithm.
- ✅ ResourceId and status filters on ReservationsList (client-side composition).
- ✅ Smoke test extended: `smoke:reservations:conflicts` validates availability endpoint.
- ✅ Mobile typecheck passes.

**How to Verify**
```bash
# Mobile typecheck
cd apps/mobile
npm run typecheck

# Smoke test with availability assertion
node ops/smoke/smoke.mjs smoke:reservations:conflicts
```

---
1. Spec updates: add Resource/Reservation schemas, custom endpoints with 409 responses, flag annotations.
2. API implementation:
   - Flag definition in `apps/api/src/flags.ts`.
   - Overlap validation hook in `apps/api/src/objects/create.ts` and `update.ts`.
   - `apps/api/src/reservations/check-conflicts.ts` handler.
   - `apps/api/src/resources/availability.ts` handler.
   - Routing in `apps/api/src/index.ts`.
3. Smoke tests: new flows in `ops/smoke/smoke.mjs`.
4. Smokes passing: `smoke:reservations:crud`, `smoke:reservations:conflicts`, `smoke:resources:availability`.
5. Mobile app: read-only preview (defer write UI to Sprint VI).

Acceptance Criteria
- ✅ Spec compiles (YAML valid, OpenAPI 3.0.3).
- ✅ TypeScript types generated from spec.
- ✅ Generic CRUD for resources & reservations via `/objects/:type` works.
- ✅ `POST /reservations:check-conflicts` returns 200 (no conflict) or 409 (conflict).
- ✅ `GET /resources/{id}/availability` returns busy periods in requested range.
- ✅ Overlap detection prevents conflicting reservations on create/update (409).
- ✅ Feature flag gates endpoints in PROD; dev header override in non-prod.
- ✅ RBAC permissions enforced (`resource:*`, `reservation:*`).
- ✅ All smoke flows passing (CRUD, conflicts, availability).
- ✅ Mobile reads reservations, does not allow write (button disabled if flag off).

---

## Sprint VIII — ModuleHub Fail-Closed + Resources/Registrations UX Baseline (Completed 2025-12-21)

**Context**
- Mobile: coherent module recipe for Resources (anchor), Registrations, and Reservations alignment.
- Hub: fail-closed when policy unavailable.

**Scope**
- **ModuleHub:** Fail-closed on missing `/auth/policy` → banner + no tiles.
- **Resources module:** Read-only tile + list/detail screens with pagination, error banners.
- **Registrations module:** Detail screen added; list rows tap to detail; error banners.
- **Reservations alignment:** ResourcePicker empty state includes "Go to Resources" CTA; existing availability/suggestion/conflict tap-to-detail unchanged.

**Deliverables**
- ✅ ModuleHub visibleModules() returns [] when policy null/unavailable; banner shown.
- ✅ Resources tile + list/detail (name/type/status/timestamps).
- ✅ Registrations detail screen (eventId/partyId/division/class/created/updated).
- ✅ Registrations list rows navigate to detail.
- ✅ All screens show error banners on fetch failures.
- ✅ ResourcePicker shows "Go to Resources" button on empty state.
- ✅ Mobile typecheck passes.

**How to Verify**
```bash
cd apps/mobile && npm run typecheck
```

**Manual QA**
- Open hub → Ensure policy fetch succeeds, resources/registrations/reservations tiles appear.
- Resources list → View, scroll (pagination), tap row → detail with fields.
- Registrations list → View, tap row → detail with fields; test error banner (offline).
- Reservations create → Select resource (picker) → Empty state shows "Go to Resources" button.
- Availability display, next-available slot button, conflict tap-to-detail all work as before.

---

## Sprint IX — Events (Read-Only) + Registrations Linkage (Completed 2025-12-21)

**Context**
- Mobile: add Events module to hub; EventDetail includes Registrations related section (client-side filtered by eventId).
- Registrations fetch gated behind FEATURE_REGISTRATIONS_ENABLED flag (dev default off, prod env-controlled).

**Scope**
- **Events module:** Tile + list screen (pagination, search, error banner) + detail screen (fields + Registrations subsection).
- **EventDetail-Registrations linkage:** Client-side filter by eventId; if registrations feature disabled, show "disabled" message (not error banner).
- **Dev tooling:** __DEV__ seed button on EventsList for fast event creation (name/status/location/startsAt/endsAt).

**Deliverables**
- ✅ Events tile on ModuleHub (permission gated `event:read`).
- ✅ EventsListScreen: pagination (limit/next), search (q), error banner, tap row → EventDetail.
- ✅ EventDetailScreen: event fields + Registrations section (filtered client-side, tappable to RegistrationDetail).
- ✅ Registrations section disabled message when FEATURE_REGISTRATIONS_ENABLED = false.
- ✅ Registrations module entry gated with enabled() feature flag (removed from hub if flag off).
- ✅ __DEV__ seed button on EventsList (creates test event with now to now+2h time window).
- ✅ Mobile typecheck passes.

**How to Verify**
```bash
cd apps/mobile && npm run typecheck
```

**Manual QA**
- Open hub → Events tile visible (if event:read permission).
- Events list → Search works, pagination works, tap row → detail.
- EventDetail → Event fields displayed; Registrations section shows linked registrations (if feature enabled) or "disabled" message (if feature off).
- (Dev) Seed button on EventsList creates test event, resets search, reloads list.
