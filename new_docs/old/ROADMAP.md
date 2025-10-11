# MBapp Roadmap (living)

## North Star
One objects core (OpenAPI-driven), role-based UX (internal & external), horse-events first, integrations-ready.

## Milestones
### A — Foundation (done/ongoing)
- RBAC policy endpoint + dev JWT
- Centralized spec: `spec/MBapp-Modules.yaml` → `openapi.yaml`
- User Views v1 scaffolding

### B — Horse Events Core (active)
- Judging & scorecard (Dressage v1)
- Participant Workspace (cross-module)
- Seed default Views (Inventory/Events/Products)

### C — Monetization & Media (next)
- Stripe payments (cards + refunds)
- Streaming (Mux or IVS) + entitlements
- VOD + basic analytics

### D — Ops: Purchasing & Sales (next)
- Purchase Orders + Receipts → inventoryEvent ledger
- Sales Orders + Fulfillment → ledger
- Attach docs (Drive) to PO/Fulfillment

## Always-On Streams
- Spec hygiene: update `spec/MBapp-Modules.yaml` first for any change
- CI: bundle spec + typegen on every PR
- ADRs for key decisions in `docs/adr/`
- Keep GitHub Project board “MBapp Dev” moving: Backlog → Next → In Progress → Review → Done

## Current Sprint (edit each sprint)
- Goal: Ship Dressage scorecard + seed Views
- Links:
  - Spec PR: (add)
  - App PRs: (add)
  - Board view: (add)
