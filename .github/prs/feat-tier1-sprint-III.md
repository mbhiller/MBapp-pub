Title: Sprint III — Views/Workspaces v1 + Event simulate (noop) + Smokes

Body:
Scope:
- Spec: View + Workspace schemas and paths.
- API: /views (CRUD), /views/{id}, /workspaces (list).
- Events: simulate path returns `_dev: { emitted:true, provider:'noop' }`.
- Flags default OFF.

Smokes (all PASS):
- smoke:views:crud
- smoke:workspaces:list (returns empty items in v1)
- smoke:events:enabled-noop

Safety:
- No migrations, no external event sinks.
- Diffs are surgical; flags gated with dev-header overrides.

Next:
- Optional: Map saved Views into /workspaces in a later sprint.

Links:
- MBapp-Working results: docs/MBapp-Working.md
- Roadmap snapshot: docs/roadmap-snapshot.md

Labels: sprint-III, tier-1-foundation

Assign reviewer: @bryan
