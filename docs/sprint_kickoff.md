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
