# MBapp Development Cadence (copy/paste into a new chat)

**Navigation:** [Roadmap](MBapp-Roadmap-Master-v10.0.md) · [Status/Working](MBapp-Working.md) · [Foundations](SPRINT_XXVI_FOUNDATIONS_REPORT.md) · [Verification](smoke-coverage.md)  
**Last Updated:** 2025-12-28

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
### 3A) Sprint plan
- Vertical-slice goal
- Acceptance criteria
- Ordered deliverables (small → large, safest first)

### 3B) Copilot EDIT prompts (E1…En)
- Each prompt includes its label in the prompt text (e.g., `E3 (EDIT MODE): ...`).
- Each prompt includes the **Definition of Done** (below).
- Prompts are scoped tightly (explicit files / minimal surface area).

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
- PR wrap content must be provided in a fenced code block** for copy/paste.

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
- Cleanup + docs updates + push + PR.

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
- Docs updated where behavior/flows changed (minimum: `docs/MBapp-Working.md`, plus any sprint doc if used).

### ✅ Verification Evidence
- Relevant typecheck(s) executed and clean.
- Relevant smokes executed and passing.

### ✅ Git Hygiene
- `git diff` only contains intentional changes.
- Branch pushed, PR opened, CI green.
- PR includes: title, summary, test evidence, rollout notes, follow-ups.
