# MBapp – Repo Instructions

## How we work
- Follow the cadence:
	- Prompt 0 read-only investigation (no edits)
	- Propose labeled edit prompts (E1…En)
	- Implement + run relevant checks (typecheck/smokes) + cleanup + docs + PR text
- Default to small, reviewable patches.

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
