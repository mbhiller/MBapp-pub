# MBapp Roadmap Snapshot — Sprint III (Dec 2025)

## Tiers at a Glance

| Tier | Objective |
|:-----|:----------|
| **Tier 1** | Normalize object model & shared line editors; guardrails (status gates, required fields, idempotency). |
| **Tier 2** | Events/Registrations, Resources/Reservations, Scheduling, Auctions, Animals, Business Processes (config-driven). |
| **Tier 3** | Double-entry accounting, Billing (AR/AP), Expense management, finance backbone. |
| **Tier 4** | Accounting/Commerce/Payment integrations (Xero, Shopify, Stripe, HubSpot, Salesforce, Twilio). |

---

## Status

### ✅ Completed Phases
- **Tier 1.0 Foundations** (Sprint A–B)  
  Objects CRUD, Party/Product/SO/PO schemas, inventory counters & movements, dev-login.
- **Tier 1.1 Shared Line Editors** (Sprint D)  
  PO/SO redesign with unified statuses & actions; `_key`-based line editing; idempotency guards.
- **Tier 1.2 Commerce Core & Backorders** (Sprint E–I)  
  Backorder request flow, product reorder flags, multi-vendor PO suggestions, receive history, pagination, vendor guards.

### 🚧 In Progress
- **Tier 1.3 Guardrails** (partial)  
  Over-commit/over-fulfill guards in place; cancel/close rules enforced.

### 📋 Sprint III (Next)
- **Tier 1.3 Extensions**: Views v1 + Workspaces landing.
- **Event dispatcher plumbing**: noop or simulate; EventBridge/SNS ready (feature-flagged).

---

## This Sprint (Sprint III) Definition of Done

### Acceptance Tests (Smokes)
1. **`smoke:views:crud`**  
   Create view → List/search views → Update view name/filters → Delete view.  
   ✓ Type filtering, field projection, sort config storage.
   
2. **`smoke:workspaces:list`**  
   Retrieve workspace with ≥1 saved views.  
   ✓ Role-aware filtering (allowedViews, allowedWorkspaces via PartyRole).  
   ✓ Tile composition (viewId → view config).

3. **`smoke:events:enabled-noop`**  
   Toggle FEATURE_EVENT_DISPATCH_ENABLED on; confirm noop (no external publish).  
   ✓ With FEATURE_EVENT_DISPATCH_SIMULATE=true, confirm event is enqueued locally (simulate mode).  
   ✓ With simulate=false, confirm event is dropped (safe noop).

### Feature Flags (Default Off)
- `FEATURE_VIEWS_ENABLED` (env: `FEATURE_VIEWS_ENABLED`, header: `X-Feature-Views-Enabled`)  
  *Toggles Views endpoints & UI.* Dev header overrides in non-prod only.

- `FEATURE_EVENT_DISPATCH_ENABLED` (env: `FEATURE_EVENT_DISPATCH_ENABLED`, header: `X-Feature-Events-Enabled`)  
  *Toggles dispatcher; when true, events routed per FEATURE_EVENT_DISPATCH_SIMULATE.*

- `FEATURE_EVENT_DISPATCH_SIMULATE` (env: `FEATURE_EVENT_DISPATCH_SIMULATE`, header: `X-Feature-Events-Simulate`)  
  *When true + dispatcher enabled, events logged locally. When false, noop.*

- `MBAPP_USE_GSI1` (design stub, not implemented this sprint)

---

## Cross-Tier Dependencies & Risks

### Data Integrity
- **Risk:** Views reference outdated column names if schema changes mid-sprint → stored queries break.  
  *Mitigation:* Keep Views storage minimal; normalize column names in API response layer before storage.

- **Risk:** Event dispatcher publishes during transaction → external system state inconsistent if post-action fails.  
  *Mitigation:* Use outbox pattern (emit event only after transaction commit); feature-flag to noop until retry logic in place.

### Module Scope
- Views assume existing list/search endpoints (inventory, sales, purchasing, events, resources).  
  *Linked to:* Pagination work (Sprint I); pageInfo cursor support.

- Workspaces depend on PartyRole schema & allowedViews/allowedWorkspaces fields.  
  *Linked to:* Tier 1 identity model ([MBapp-Relationships.md](MBapp-Relationships.md)).

### UI/Mobile Hooks
- Mobile client needs canonical `useObjects` hook surfacing pageInfo (already done in Sprint I).  
- Workspace landing screen entry point TBD (may route from tab bar or app drawer).

---

## Next Checkpoints

After Sprint III passes, we update:

1. **[spec/MBapp-Modules.yaml](../spec/MBapp-Modules.yaml)**  
   - Views & Workspaces endpoint stabilization  
   - EventBridge/SNS connector schema stubs (v1 contract only; no impl yet)

2. **[docs/MBapp-Roadmap-Master-v10.0.md](MBapp-Roadmap-Master-v10.0.md)**  
   - Mark Tier 1.3 complete; update "Outcome" (production-ready core platform)  
   - Tier 2.0 kickoff (Events & Registrations v1 detail plan)

3. **[docs/MBapp-Working.md](MBapp-Working.md)**  
   - Sprint III results section: Views CRUD behavior, workspace role filtering, event dispatcher toggles  
   - Link to next sprint (Tier 2.0 Events & Registrations)

4. **[ops/smoke/smoke.mjs](../ops/smoke/smoke.mjs)**  
   - New smoke flows added to registry  
   - Seed data for Views test (e.g., sample saved views)

5. **[apps/api/src/views/list.ts](../apps/api/src/views/list.ts) & [workspaces/list.ts](../apps/api/src/workspaces/list.ts)**  
   - Ensure pagination & pageInfo consistency with inventory/objects API  
   - No breaking changes to existing list endpoints

---

## References

- **Spec:** [spec/MBapp-Modules.yaml](../spec/MBapp-Modules.yaml) (Views & Workspace schemas, endpoints)
- **Roadmap:** [docs/MBapp-Roadmap-Master-v10.0.md](MBapp-Roadmap-Master-v10.0.md#-tier-1--core-platform--modules-phases-10--13)  
- **Sprint planning:** [docs/sprint_kickoff.md](sprint_kickoff.md)
- **Tier 1 model:** [docs/MBapp-Relationships.md](MBapp-Relationships.md#1-identity-model-tier-1-core)
- **Flags config:** [apps/api/src/flags.ts](../apps/api/src/flags.ts)  
- **Recent history:** [docs/MBapp-Working.md](MBapp-Working.md) (Sprints A–I summaries)
