# MBapp Development Cadence (copy/paste into a new chat)

**Navigation:** [Roadmap](MBapp-Roadmap.md) · [Status/Working](MBapp-Status.md) · [Foundations](MBapp-Foundations.md) · [Verification](smoke-coverage.md)  
**Last Updated:** 2026-01-10

---

## Quick Reference — Local Demo Setup

Before starting a sprint or feature work, set up a fresh local tenant with realistic demo data:

```bash
# 1. Wipe any existing data
npm run wipe:demo

# 2. Seed fresh dataset (parties, products, inventory, event, registrations, tickets)
npm run seed:demo

# 3. Web dev — login with dev@example.com (check script output for IDs)
npm run dev -w apps/web

# 4. Mobile dev (optional) — use same tenant ID for consistency
npm run expo:demo
```

**For Smoke Testing:**
```bash
# Seed SmokeTenant separately for isolated testing
npm run seed:smoke

# Run core smoke suite (~40% faster than full)
npm run smokes:run:core
```

Full details: [Demo Dataset Seeding](MBapp-Foundations.md#demo-dataset-seeding-deterministic-local-testing) (custom seeds, idempotency, output format, feature flags).

---

## Step 1 — C1: Create branch off main
- Branch: `<branch-name>`
- Start clean:
  - `git checkout main`
  - `git pull`
  - `git checkout -b <branch-name>`

---

## Step 2 — P0: Copilot read-only investigation (search/read only; no edits)
- Copilot does **search/read only** across code/spec/docs/smokes.
- You paste findings back here in **P0 structure** (bullets, file paths, key snippets).
- Goal: confirm current behavior, gaps, and the smallest safe vertical slice.

---

## Step 3 — ChatGPT response (after P0 is posted)
Note: Include documentation updates in each labeled edit prompt when behavior or workflows change.
### 3A) Sprint plan
- Vertical-slice goal
- Acceptance criteria
- Ordered deliverables (small → large, safest first)

### 3B) Copilot EDIT prompts (E1…En)
- Each prompt includes its label in the prompt text (e.g., `E3 (EDIT MODE): ...`).
- Each prompt includes the Definition of Done (below).
- Prompts are scoped tightly (explicit files / minimal surface area).
- deliver **EDIT MODE** prompts in the most efficient grouping for this sprint:
  - If changes are **tightly coupled** (need to land together), I’ll give you **E1…En as a batch** so you can run them in succession.
  - If changes are **independent / riskier**, I’ll give you **the next prompt only**, wait for results, then issue the next prompt (fast feedback loop).
- **Docs updates are required when relevant:** Every E-prompt must include a docs line item (minimum: update `docs/MBapp-Status.md` if behavior/workflow changed; plus any feature-area docs touched).
- **Foundations/contract changes must include docs:** If an EDIT modifies foundational patterns (shared utils, endpoint contracts, status guards), explicitly add docs updates to `docs/MBapp-Foundations.md` (preferred) and/or `docs/MBapp-Status.md` in the prompt.
- All prompts must be in fenced code blocks for copy/paste into Copilot.


### 3C) Commands (labeled run list)
- Provide a labeled command list for:
  - Typechecks
  - Smokes (targeted + CI list)
  - Spec scripts (when relevant)
- Include the **testing/deploy rules** (below) so we don’t run smokes against stale backend.

**Command formatting rules**
- All commands must be provided in fenced code blocks** for copy/paste.
- All commands must be PowerShell-compatible** (assume Windows terminal).
- If Copilot claims “typecheck is green,” it must actually run it** and paste the output (at least the command + last lines showing 0 errors).
**Command formatting rules**
- All commands must be provided in fenced code blocks** for copy/paste.
- All commands must be PowerShell-compatible** (assume Windows terminal).
- If Copilot claims "typecheck is green," it must actually run it** and paste the output (at least the command + last lines showing 0 errors).
- PR wrap content must be provided in a fenced code block** for copy/paste.
- Core suite currently 48 flows (see [smoke-coverage.md](smoke-coverage.md)); extended adds 24, all = 72.

---

## Manual Validation Checklists (DEV) — Quick Reference

### Web Operator Console (DEV Login)
1. Clear localStorage (open DevTools → Application → Storage → localStorage → delete all)
2. Reload web app
3. **Expect:** DevAuthBootstrap calls `POST /auth/dev-login` (see console.log)
4. **Expect:** `GET /auth/policy` returns policy with `"*": true` (admin)
5. Navigate to `/events/{eventId}/checkin` (Operator Console)
6. **Expect:** Page loads (no "missing-permission" error)

### Web Public/Unauthenticated Testing
1. Clear localStorage key `mbapp_bearer`, reload
   - OR set env `VITE_DEV_AUTH_DISABLED=true` before starting dev server
2. **Expect:** App boots without token; public pages (events list, my-checkin) are accessible
3. Authenticated pages redirect to `/not-authorized`

### Tenant Switching in DEV
- **Preferred:** Edit env vars (`VITE_TENANT`, `VITE_DEV_TENANT`, `VITE_MBAPP_PUBLIC_TENANT_ID`) and restart dev server
- **Quick (DEV-only):** Set localStorage key `mbapp.tenantOverride` to desired tenant ID and reload
  - Example: `localStorage.setItem('mbapp.tenantOverride', 'SmokeTenant')`
  - Clear with: `localStorage.removeItem('mbapp.tenantOverride')`

### 3D) PR wrap
- PR title
- Summary
- Test evidence (typecheck + smokes)
- Rollout notes
- Follow-ups

---

## Step 4 — Implementation (your job)
- Run E1…En in Copilot → fix-forward with ChatGPT as needed.
- Run typechecks → local smokes → CI smokes (per rules below).
- **Update docs as necessary** (minimum: `docs/MBapp-Status.md` if behavior/workflow changed).
- Cleanup + push + PR.


---

# Testing + Deploy Rules (authoritative)
### A) If **apps/api** changed OR spec changes affect backend behavior
- **You redeploy to AWS** before running smokes against `MBAPP_API_BASE`.
- Smokes are only valid after redeploy is confirmed.
- Copilot should not “own” deploy-sensitive smoke validation.

### B) If **only apps/web and/or apps/mobile** changed
- Copilot may run:
  - package typecheck(s)
  - targeted smokes + CI smokes
- Use SmokeTenant env/token as your normal workflow allows.

### C) Always capture evidence
- Paste final typecheck result (or last lines)
- Paste smoke PASS output (`[ci-smokes] ✔ all flows passed` or PASS JSON)

---

# Definition of Done (paste into every E-prompt + PR)
### ✅ Functional
- Feature behavior matches sprint acceptance criteria.
- No regressions in related flows (SO/PO/backorders/outbound as applicable).
- Errors are user-actionable (message + code/details where expected).

### ✅ Code Quality
- No TODOs left behind unless explicitly tracked (issue/link) and low-risk.
- No stray debug logs.
- No broad refactors outside sprint scope.

### ✅ Spec / Types / Docs
- If **spec** changed, run and commit results as appropriate:
  - `npm run spec:lint`
  - `npm run spec:bundle`
  - `npm run spec:types:api`
  - `npm run spec:types:mobile`
- Docs updated where behavior/flows changed (minimum: `docs/MBapp-Status.md`, plus any sprint doc if used).

### ✅ Telemetry & UX Instrumentation
- **Foundation-by-Accretion Rule:** New domain workflows or UX surface area must include telemetry.
  - **1–3 domain events** for new state transitions (e.g., `backorder_ignored`, `po_received`).
  - **1–3 UX events** for new screens or primary actions (e.g., `screen_viewed`, `button_clicked`).
  - **Error events** captured automatically via Sentry error boundaries + API error handlers.
- **Sentry context minimums (where applicable):**
  - Required tags: `tenantId`, `actorId` (if authenticated), `environment`, `platform`.
  - Required context: `objectType`/`objectId` (for domain errors), `route`/`screen` (for UX errors), `requestId` (for API errors).
- **Event envelope compliance:** Use standard TelemetryEvent shape (see [MBapp-Foundations.md](MBapp-Foundations.md#82-telemetry-contract-event-envelope)).
- **Guardrails:** No event sprawl (limit 3–5 events per feature); no PII in event properties; snake_case event names.

### ✅ Verification Evidence
- Relevant typecheck(s) executed and clean.
- Relevant smokes executed and passing.

### ✅ Git Hygiene
- `git diff` only contains intentional changes.
- Branch pushed, PR opened, CI green.
- PR includes: title, summary, test evidence, rollout notes, follow-ups.
