# MBapp Development Playbook — Parties‑First, Contract‑First, Vertical Slices
_Compiled for: feat/sprint-100825_

This playbook turns the Roadmap v10.0, Relationships, Backend Guide, Frontend Guide, and Working doc into an execution plan that guarantees every roadmap feature is actually built, tested, and shippable.

## Core Principles
1) **Contract‑first**: `MBapp-Modules.yaml` (spec) is the single source of truth → generate backend & mobile/web types each slice.
2) **Parties‑first**: Parties + Roles + Links underpin SO/PO redesign, Events/Regs, Resources/Resv. Stabilize this domain before rebuilding orders.
3) **Vertical slices**: For each epic, ship a thin but complete path: Spec → Backend handlers/guards/idempotency → Smokes/Seeds → Frontend lists/detail → Views/Workspaces → RBAC checks → CI.
4) **Shared rails**: One design system, one line editor, one role‑filtered Party Picker, one status guard helper, one MoneyTotals, one idempotency helper, one on‑focus hydration hook.
5) **Always‑green**: Every slice adds seeds + smokes wired in CI. Never leave red.

## Foundation (Week 0 → 1)
- Identity & Tenancy: confirm headers (`X-Tenant-Id`, idempotency keys) and RBAC roles per Backend Guide.
- **Parties Domain** (blocking for all):
  - Entities: Party (person|org), PartyRole (customer, vendor, employee, trainer, owner, lessor, lessee, etc.), PartyLink (party↔party typed links), PartyAddress, PartyContact.
  - APIs: list/search parties (role‑filtered), create/update, assign roles, link/unlink.
  - Pickers: role‑filtered Party Picker (customer/vendor/employee, etc.).
  - Seeds + smokes: CRUD + role assignment + search.
- Shared Rails:
  - `ui/PartyPicker`, `ui/StatusBadge`, `ui/LineEditor`, `useRefetchOnFocus`, Money helpers.
  - Workspaces scaffold: list filters, saved views, column sets, RBAC visibility.

### SPRINT TEMPLATE
## DoD — Housekeeping (No-Regret Prep for Future Automation)
- Keep **Idempotency-Key** / **X-Request-Id** flowing end-to-end (client → API → logs → response).
- Ensure **createdAt / updatedAt** are set on every persisted object we touch.
- Prefer **verb endpoints** for actions (e.g., `/po/{id}:receive`, `/so/{id}:commit`) so steps remain composable.
- Leave **disabled `emitEvent(...)` stubs** at key lifecycle points (create/submit/approve/receive) for painless orchestration later.
- Maintain **stable status enums** across PO/SO/Reservations (append new values; avoid renames).


## Tier Execution Model (repeat per epic)
For each epic **E**:
1. **Spec**: Update schemas + paths + enums in `MBapp-Modules.yaml` (status guards, idempotency fields). Commit.
2. **Types**: Regenerate backend & mobile types.
3. **Backend**: Implement repo + handlers + guards + idempotency + events.
4. **Seeds/Smokes**: Add `ops/smoke/seed` and `ops/smoke/smoke.mjs smoke:<E>:*` covering happy path + guardrails.
5. **Frontend**: 
   - Lists with filters + role pickers
   - Detail screen with shared line editor & status actions
   - Workspace views (Saved filters/columns) for the module
6. **RBAC**: Gate routes, actions, and views on role/role‑map.
7. **CI**: Wire slice smokes into GitHub Actions.

## Recommended Slice Order (v10.0 aligned)
1. **Parties & Roles** (foundation) → role‑filtered pickers shipped.
2. **Products & Inventory Core**: products, items, counters (on‑hand/reserved/available), movements; seeds + guardrails for over‑commit/over‑fulfill.
3. **SO/PO Redesign (Parties‑aware)**:
   - SO: customer as Party(role=customer), sales rep as Party(role=employee), ship‑to PartyAddress.
   - PO: vendor as Party(role=vendor), buyer as employee party; receive → movements.
   - Status rails, idempotency, totals, explosion (BOM) as needed.
   - Smokes: reserve/commit/fulfill; submit/approve/receive; guardrails.
4. **Events & Registrations v1**: event capacity guards; registrant Party(role=attendee); payments optional scaffolding.
5. **Resources & Reservations v1**: resource types (stall, track slot, equipment); reserver Party; conflicts guard.
6. **Workspaces & Views Enhancements**: saved filters, role‑scoped views per module.
7. **Scanning & EPC** (if in Tier 1/2 scope): stock counts, pick/pack/receive flows.
8. **Leasing/Labor** (as per Roadmap): Party roles (lessor/lessee, employee/contractor); timesheets or contract terms.

## CI & Smokes
- Each slice contributes:
  - `tools/seed/<slice>.ts`
  - `ops/smoke.mjs smoke:<slice>:happy|guards|idempotency`
- GitHub Actions jobs: `spec`, `api`, `mobile`, with smoke matrix per slice.

**Note:** CI runs only the flows listed in `ops/ci-smokes.json` (currently: registrations:crud, registrations:filters, reservations:conflicts). Additional smoke flows may exist in `ops/smoke/smoke.mjs` but are not included in CI by default.

## Definition of Done (per slice)
- Spec updated + tagged
- Types re‑generated & committed
- Handlers + guards + idempotency implemented
- Seeds + smokes (happy + guardrails) pass locally and in CI
- Lists + detail screens + workspaces usable
- RBAC enforced
- Docs updated (Roadmap, Working)

## Branching & Checkpoints
- Create `feat/sprint<LETTER>-MBAPP`.
- Merge per-slice via PRs:
- Tag after each slice: `v10.0-slice-parties`, etc.

---

### Immediate TODO (today)
- [ ] Create `feat/sprint-100825` from current branch.
- [ ] Lock **Parties** spec and generate types.
- [ ] Scaffold Party APIs + seeds + smokes; ship PartyPicker in mobile/web.
- [ ] Wire Parties smokes into CI.