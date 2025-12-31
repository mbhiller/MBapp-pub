# MBapp – Repo Instructions

## How we work
- **Context:** Copilot only receives Prompt 0 (read-only investigation) and EDIT MODE prompts (E1…En). Prompts must be self-contained; no chat history is preserved.
- Follow the cadence:
	- **Prompt 0:** Read-only investigation (no edits, gather findings)
	- Propose labeled edit prompts (E1…En)
	- **EDIT MODE (E1…En):** Implement + run relevant checks (typecheck/smokes) + cleanup + docs
- Default to small, reviewable patches.
- **Branch creation (Step 1):** User creates branch before E1; Copilot implements changes on that branch.
- **Definition of Done (before PR):**
	- ✅ All edits implemented per spec
	- ✅ Typecheck passes (apps/web + apps/mobile + apps/api as relevant)
	- ✅ Smoke tests pass (if API/contract changes)
	- ✅ Docs updated (MBapp-Status.md, MBapp-Foundations.md as relevant)
	- ✅ No regressions (existing features still work)
- **After spec changes:** Run verification sequence:
	- `npm run spec:lint` (validate YAML)
	- `npm run spec:bundle` (generate openapi.json)
	- `npm run spec:types:api` (regenerate API types)
	- `npm run spec:types:mobile` (regenerate mobile types)

## Safety + correctness
- Never change tenant/auth behavior without validating with smokes.
- Prefer server as source of truth; UI prechecks are advisory.
- When changing data shapes, update smokes/tests or docs accordingly.

## Code standards
- Match existing patterns in the repo (API handlers, web pages, mobile patterns).
- Keep changes minimal and localized; avoid refactors unless requested.
- Add caching where repeated API/DB reads would be wasteful.

## Outputs
- When proposing changes: provide exact file paths and “Apply Patch” vs “Replace File”.
- When reporting findings: cite file/line numbers and paste the key snippet.

## Scope
- Do NOT impose edit-path restrictions unless the user explicitly states them in chat.
- Treat old sprint notes in spec/docs as archival, not constraints.
- Conflict rule: If these instructions or any repo docs conflict with the user’s latest message in chat, follow the user’s latest message.

## Defaults
- Contract-first: edit `spec/MBapp-Modules.yaml` before code.
- Feature flags default OFF; allow dev header overrides only.
- No schema-breaking migrations; keep diffs surgical.
