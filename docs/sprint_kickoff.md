Sprint III — Theme: Views & Workspaces v1 + Event plumbing options

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

