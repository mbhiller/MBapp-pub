# Sprint Kickoff Template

Use this template to start **every new sprint**. Copy, fill in placeholders, and paste into a fresh chat. It guides the assistant to confirm scope, request missing files, and only provide code **after** you approve the plan.

---


## Full Kickoff Brief (Zero Ambiguity)
```text
Sprint <N> — Theme: <concise headline>

Context
- Treat previous conversations/files as stale. Use ONLY what I attach here.
- Repo: C:\Users\bryan\MBapp-pub
- Target branch: feat/tier1-sprint-<N>
- Smoke runner: ops/smoke/smoke.mjs (seeds in ops/smoke/seed/*)
- Mobile app: Expo React Native
- API app: apps/api/src

Scope (no code yet)
- Goals:
  - <Goal 1>
  - <Goal 2>
  - <Goal 3>
- Out of scope:
  - <Anything we should avoid this sprint>

Deliverables I expect (sequence)
1) Terminology & scope confirmation (plain English).
2) File request list (EXACT paths). If a file doesn’t exist, ask for it.
3) Per-file change plan (surgical, minimal, drop-in; no guessing).
4) Smoke plan:
   - Flow names (e.g., smoke:po:vendor-guard, smoke:objects:pageInfo-present, …)
   - Assertions each flow will make (inputs/expected outputs)
5) After I approve: provide code as drop-in replacements or tiny patches that reference exact lines.

Guardrails (very important)
- Do NOT propose code until I confirm you have the current files.
- If you can’t fully read a file, STOP and ask me to paste it.
- Prefer feature flags for new validations/behaviors; confirm defaults before coding.
- Mirror our existing patterns (naming, exports, paths). No shims unless approved.

Environment & Flags (confirm before coding)
- FEATURE_ENFORCE_VENDOR_ROLE=<default?> (CI default true)
- FEATURE_EVENT_DISPATCH_ENABLED=<default?>
- FEATURE_EVENT_DISPATCH_SIMULATE=<default?>
- Any other flags you intend to read/write: list them and propose defaults.

Smokes & Commands
- Add flows under ops/smoke (match current style: returns { test, result, … }).
- Example commands I’ll run:
  - node ops/smoke/smoke.mjs smoke:flows:<name>
- Tell me any required seeds you’ll use in ops/smoke/seed/*.

Files attached now
- <List the exact files you’re attaching to this sprint>

Before coding, respond with:
- (A) Scope confirmation
- (B) File gaps (exact paths you still need)
- (C) Per-file change plan
- (D) Smoke plan (flows + assertions)
```

---

---

## Example — Fill‑In Sprint Shell
```text
Sprint II — Theme: Events + Guardrails + Pagination polish

Scope (no code yet)
- Goals:
  - Optional system events on PO receive (no‑op by default, simulatable in CI)
  - Vendor guardrails (flag‑controlled server checks; mirror mobile banner)
  - Pagination polish on views/workspaces lists + mobile pull‑to‑refresh reset
- Out of scope:
  - Domain Events (horse shows) module changes

Deliverables expected first (no code):
1) Confirm “system events” ≠ “Events (shows)”.
2) Request exact files:
   - API: po‑receive.ts, po‑submit.ts, po‑approve.ts, parties repo util, router index for views/workspaces
   - Mobile: useObjects.ts, PO/Inventory list screens, ReceiveHistorySheet.tsx, PO detail (Receive All)
   - Smokes: ops/smoke/smoke.mjs + any seeds used
   - Spec/docs: MBapp‑Modules.yaml, MBapp‑Working.md, MBapp‑Tree.md
3) Per‑file change plan (surgical, drop‑in).
4) Smoke plan: names + assertions.
```

---

## Tips
- Keep this kickoff at the top of every sprint chat.
- Attach the files immediately after the kickoff.
- If the assistant suggests code before confirming files, remind it: “No code until I approve the plan.”

