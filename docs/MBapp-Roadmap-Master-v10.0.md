# MBapp — Master Roadmap (Tiers 1 → 10)
_Updated October 14, 2025 12:50_

This is the **living**, presentation‑ready roadmap for MBapp. It consolidates and supersedes prior versions (v3.2, v3.3, v4.0, v5.0).  
Each Tier uses the same structure so we can later expand any Phase into a detailed sprint plan.

---

## Legend
**Structure per Phase:** 🎯 Objective · 🧱 Schemas · 🔄 Flows · ⚙️ Guards · 💻 UI/UX · 🧪 Smokes · 🕓 Sprints · 🏁 Outcome

---

# 🧰 Tier 1 — Core Platform & Modules (Phases 1.0–1.3)

### 1.0 Foundations
- 🎯 Normalize object model and client API; seed shared utilities.
- 🧱 Schemas: ObjectBase; Party (person|animal|organization) + PartyRole; Product; Inventory; SalesOrder; PurchaseOrder.
- 🔄 Flows: SO/PO draft→submit; inventory movements compute on‑hand.
- ⚙️ Guards: status gates; required fields; tenancy headers.
- 💻 UI/UX: base lists/details; shared pickers; client.ts baseline.
- 🧪 Smokes: `smoke:salesOrder:flow`, `smoke:purchaseOrder:flow`.
- 🕓 Sprints: 1.
- 🏁 Outcome: stable foundation and APIs.

### 1.1 Shared Line Editors
- 🎯 Adopt `_key/CID` + normalize→toPatchLines→re‑normalize across modules.
- 🧱 Schemas: SO/PO `lines[]` with id‑less create semantics.
- 🔄 Flows: in‑place edit, remove, save‑in‑place.
- ⚙️ Guards: idempotency keys for actions.
- 💻 UI/UX: SO/PO detail screens using shared editor.
- 🧪 Smokes: edit‑in‑place, remove, save‑in‑place.
- 🕓 Sprints: 1.
- 🏁 Outcome: reliable, consistent line editing.

### 1.2 Commerce Core
- 🎯 Consistent totals, tax, pricing; inventory search & reports.
- 🧪 Smokes: backorder, reserve, fulfill, goods‑receipt.
- 🕓 Sprints: 1.

### 1.3 Guardrails
- 🎯 Over‑commit/over‑fulfill prevention; cancel/close rules.
- 🕓 Sprints: 0.5.
- 🏁 Outcome: production safety nets.

---

# 🐎 Tier 2 — Operations: Events, Resources, Animals, Auctions (Phases 2.0–2.6)

### 2.0 Events & Registrations v1
- 🎯 Mobile wizard; capacity & duplicate checks; fee rules.
- 🧱 Schemas: Event (+EventLine), Registration.
- 🧪 Smokes: `registrations:edit-in-place`, `events:capacity-guard`.
- 🕓 Sprints: 1–2.

### 2.1 Resources & Reservations v1
- 🎯 Conflict detection; per‑resource day grid.
- 🧱 Schemas: Resource, Reservation.
- 🧪 Smokes: `reservations:conflict-guard`, edit‑in‑place.
- 🕓 Sprints: 1.

### 2.2 Scheduling Foundations
- 🎯 Venue/Facility; blackout; ride‑time slots; double‑book detector.
- 🕓 Sprints: 1–2.

### 2.3 Auctions v1
- 🎯 Lots, catalog, live/online bidding, settlements, bidder board.
- 🧱 Schemas: Auction, Lot, Bid, Settlement.
- 🕓 Sprints: 1–2.

### 2.4 Animals v1 + Breeding Stub
- 🎯 Health, breed, insurance attrs; breeding plan scaffolds.
- 🧱 Schemas: Animal, HealthRecord (basic), BreedingPlan.
- 🕓 Sprints: 1.

### 2.5 Displays & Boards
- 🎯 Ring grid, on‑deck, leaderboards, auction presentation boards.
- 🕓 Sprints: 0.5–1.

### 2.6 Commerce Enhancers
- 🎯 Packages/discounts tied to events; quick POS add‑ons.
- 🕓 Sprints: 0.5–1.
- 🏁 Outcome: end‑to‑end ops ready for finance posting.

---

# 💰 Tier 3 — Finance & Accounting (Phases 3.0–3.2)

### 3.0 Accounting Core
- 🎯 Double‑entry ledger; posting rules; cost centers; revenue share.
- 🧱 Schemas: Account, JournalEntry/Line, LedgerBalance, PostingRule, RevenueShareRule/Entry.
- 🔄 Flows: post on operational finalizations (SO fulfill, PO receive, Auction settle…).
- 💻 UI/UX: Chart, Journal browser, TB/P&L/BS, Posting tester.
- 🧪 Smokes: `acct:post-*`, `acct:balance-check`, `acct:trial-balance`.
- 🕓 Sprints: 2.

### 3.1 Billing (AR/AP)
- 🎯 Invoices/Bills/Payments/Refunds/Statements.
- 🧱 Schemas: Invoice, Bill, Credit, Payment, Refund, StatementRun.
- 💻 UI/UX: AR/AP consoles; Cash App; Statements.
- 🧪 Smokes: invoice from SO; refunds; AP cycle.
- 🕓 Sprints: 2.

### 3.2 Expense Management
- 🎯 Expense reports, reimbursements, budgets, feed imports.
- 🧱 Schemas: ExpenseReport/Line, Reimbursement, Budget, FeedImport.
- 🧪 Smokes: expense lifecycle; import; budget thresholds.
- 🕓 Sprints: 1–2.
- 🏁 Outcome: finance backbone complete.

---

# 🔧 Tier 3.3 — Optimizations & Milestones (M1–M6)
- 🎯 Telemetry, audit tlog, UX normalization, multi‑currency prep, AI hooks.
- Milestones: **M1 Foundation · M2 Ops · M3 Finance · M4 Optimize · M5 Integrations/BI · M6 AI**.

---

# 💼 Tier 4 — Integrations & Reporting (Phases 4.0–4.5)

### 4.0 Accounting Syncs (Xero/QBO/NetSuite) — Sprints 22–23
- 🧱 ConnectorAccountMap, SyncEnvelope, SyncCursor, SyncError, WebhookReceipt.
- 🔄 Outbound journals/invoices/bills/payments; inbound webhooks; backfill & reconcile.
- 💻 Connectors wizard; Sync monitor; Reconciliation report.
- 🧪 `int:acct-outbound`, `int:acct-inbound`, `int:acct-reconcile`.

### 4.1 Commerce & Payments (Shopify/Stripe/Square/PayPal) — Sprints 24–25
- 🧱 StorefrontLink, OrderImport, PaymentIntent, DisputeCase.
- 🔄 Catalog sync; order import→SO/POS; capture/refund; disputes.
- 💻 Storefront manager; Payment console; Order inbox.
- 🧪 `int:shopify-catalog`, `int:stripe-capture`, `int:order-import`.

### 4.2 CRM & Messaging (HubSpot/Salesforce/Twilio/Mailchimp) — Sprints 26–27
- 🧱 CrmContactLink, CrmDealLink, Campaign, MessageLog.
- 🔄 Party/Deal sync; campaigns; engagement metrics.
- 💻 Segment builder; Campaign manager; Engagement dashboard.
- 🧪 `int:crm-sync`, `int:campaign-send`, `int:deal-link`.

### 4.3 Logistics & Shipping (UPS/FedEx/USPS/Transport) — Sprints 28–29
- 🧱 ShipmentOrder, ReturnAuth, TransportJob.
- 🔄 Labels, tracking, returns; transport scheduling; driver app.
- 💻 Ship Desk; Transport Scheduler; Driver App.
- 🧪 `int:ship-label`, `int:ship-tracking`, `int:transport-job`.

### 4.4 Analytics & BI (Warehouse + Dashboards + Exports) — Sprints 30–31
- 🧱 DataExportJob; logical BI Star (facts: sales/inventory/events/auction; dims: date/party/product/resource/event/animal).
- 🔄 Nightly ETL; dashboards; ad‑hoc exports.
- 💻 Analytics Hub; Exports.
- 🧪 `int:etl`, `int:bi-dash`, `int:export`.

### 4.5 Data Pipeline & Observability — Sprint 32
- 🧱 PipelineRun; DataContract.
- 🔄 Observability, SLA/alerts, replay, schema drift enforcement.
- 💻 Pipeline monitor; Contract registry.
- 🧪 `int:pipeline-replay`, `int:contract-enforce`.
- 🏁 Outcome: reliable integrations and analytics backbone.

---

# 🤖 Tier 5 — AI & Automation (Phases 5.0–5.5)

### 5.0 Predictive Forecasting — Sprints 33–34
- 🧱 ForecastModel, ForecastRun, ForecastResult, **AIDataContract** (ties to Tier 4 contracts).
- 🔄 Nightly ETL→runs→Signals→dashboards.
- 💻 Forecast Board.
- 🧪 `ai:forecast-run`, `ai:forecast-drift`.

### 5.1 Scheduling Optimization — Sprints 35–36
- 🧱 OptimizationRequest, OptimizedSchedule.
- 🔄 Constraints + forecasts → schedule; steward override.
- 💻 Scheduler Console.
- 🧪 `ai:schedule-meets-constraints`.

### 5.2 Health & Genetics (Animals) — Sprints 37–38
- 🧱 HealthRecord, GeneticProfile, PredictiveOutcome.
- 🔄 Feature pipeline; outcome & care plan recs.
- 💻 Care Plan & pairing recs.
- 🧪 `ai:health-outcome`.

### 5.3 Anomaly Detection — Sprint 39
- 🧱 AnomalyRule, AnomalyEvent, ResolutionLog.
- 🔄 Stream → evaluate → triage desk.
- 💻 Anomaly Desk.
- 🧪 `ai:anomaly`.

### 5.4 AI Assistants & Insights — Sprints 40–41
- 🧱 ActionPlan, Insight.
- 🔄 Grounded Q&A; optional action plans with review.
- 💻 Ask MBapp; Propose Action dialog.
- 🧪 `ai:assistant`.

### 5.5 Recommendations & Continuous Learning — Sprints 42–43
- 🧱 Recommendation, RetrainJob.
- 🔄 Reco feeds; feedback; scheduled retrains via PipelineRun.
- 💻 Recommendations Hub.
- 🧪 `ai:reco`.
- 🏁 Outcome: production‑grade AI layer.

---

# 🧱 Tier 6 — Infrastructure, Security & Scalability (Phases 6.0–6.5)

### 6.0 CI/CD & IaC — Sprint 44
- 🎯 GitOps, environments, canary/blue‑green, rollbacks.
- 🧪 `infra:deploy-canary`, `infra:rollback`.

### 6.1 Observability & Cost — Sprint 45
- 🎯 OpenTelemetry traces, logs/metrics dashboards, cost telemetry.
- 🧪 `infra:trace-end2end`, `infra:cost-budget`.

### 6.2 Security & Secrets — Sprint 46
- 🎯 Secrets manager, KMS, key rotation, signed webhooks.
- 🧪 `infra:secret-rotate`, `infra:webhook-sign`.

### 6.3 RBAC/ABAC + SSO/MFA — Sprint 47
- 🎯 Policy engine; SAML/OIDC; MFA; audit log correlation.
- 🧪 `infra:auth-scope`, `infra:auditable-actions`.

### 6.4 DR/HA & Backups — Sprint 48
- 🎯 RPO/RTO targets; backup/restore drills; multi‑AZ/region.
- 🧪 `infra:backup-restore`, `infra:failover-sim`.

### 6.5 Performance & Scale — Sprint 49
- 🎯 Load tests; caching & CDN; perf budgets.
- 🧪 `infra:load90p95`, `infra:cdn-hit`.
- 🏁 Outcome: hardened, scalable platform.

---

# 🧩 Tier 7 — Developer Ecosystem & API Gateway (Phases 7.0–7.5)

### 7.0 Plugin Framework / SDK — Sprint 50
- 🎯 Typed hooks, lifecycle events, sandboxing.
- 🧪 `dev:plugin-sandbox`.

### 7.1 Webhooks 2.0 — Sprint 51
- 🎯 Signed, versioned, retry/backoff, replay UI.
- 🧪 `dev:webhook-replay`.

### 7.2 Custom Module Builder — Sprint 52
- 🎯 Schema‑driven lists/forms; permissions‑aware.
- 🧪 `dev:schema-render`.

### 7.3 Public API Gateway — Sprint 53
- 🎯 GraphQL + OpenAPI; rate limits; developer portal.
- 🧪 `dev:api-rate-limit`.

### 7.4 CLI & Dev Tools — Sprint 54
- 🎯 Project generator; smoke runners; local seeders.
- 🧪 `dev:cli-smokes`.

### 7.5 Marketplace (Preview) — Sprint 55
- 🎯 Partner modules; versioning; approvals; revenue share hooks.
- 🧪 `dev:market-install`.
- 🏁 Outcome: extensible ecosystem.

---

# 📱 Tier 8 — Mobile, Web & Device Integration (Phases 8.0–8.5)

### 8.0 Offline & Sync — Sprint 56
- 🎯 Conflict‑free replication; delta sync; background queues.
- 🧪 `device:offline-sync`.

### 8.1 Scanners & Cameras — Sprint 57
- 🎯 RFID/QR/Barcode; media capture; attachment flows.
- 🧪 `device:scan-pick`, `device:media-link`.

### 8.2 IoT Sensors — Sprint 58
- 🎯 Stall env sensors; anomaly alerts; telemetry storage.
- 🧪 `device:iot-telemetry`.

### 8.3 Wearables & Kiosks — Sprint 59
- 🎯 Check‑in/out; badge printing; kiosk UX.
- 🧪 `device:kiosk-checkin`.

### 8.4 Digital Signage & Boards — Sprint 60
- 🎯 Leaderboards, run‑order, bidder boards, streaming overlays.
- 🧪 `device:signage-feed`.

### 8.5 PWA/Web Parity — Sprint 61
- 🎯 Feature parity; caching; A11y/i18n.
- 🧪 `web:a11y`, `web:pwa-cache`.
- 🏁 Outcome: unified multi‑device experience.

---

# 🌐 Tier 9 — Ecosystem, Omnichannel & Multi‑Tenant (Phases 9.0–9.6)

### 9.0 Unified Omnichannel — Sprint 62
- 🎯 One cart/identity across events, auctions, eCom, POS.
- 🧪 `omni:cart-flow`.

### 9.1 Cross‑Module Commerce — Sprint 63
- 🎯 Registry linking (registration↔reservation↔order); upsells.
- 🧪 `omni:link-upsell`.

### 9.2 Org/Franchise Management — Sprint 64
- 🎯 Tenants, sub‑orgs, roles; data isolation.
- 🧪 `omni:tenant-isolation`.

### 9.3 Metering & Billing — Sprint 65
- 🎯 Usage meters; pricing plans; entitlements; invoices.
- 🧪 `omni:meter-accuracy`.

### 9.4 Cross‑Channel Analytics — Sprint 66
- 🎯 Channel attribution; cohort & funnel analytics.
- 🧪 `omni:cohort-funnel`.

### 9.5 Customer 360 — Sprint 67
- 🎯 Unified Party profile; engagement timeline; LTV.
- 🧪 `omni:party-360`.

### 9.6 White‑Labeling — Sprint 68
- 🎯 Theme packs; domain mapping; branding controls.
- 🧪 `omni:white-label`.
- 🏁 Outcome: one experience everywhere, enterprise‑ready.

---

# 🧠 Tier 10 — Globalization & Future Vision (Phases 10.0–10.5)

### 10.0 Multilingual & Locales — Sprint 69
- 🎯 i18n/RTL, timezones, number/date/currency formatting.
- 🧪 `global:i18n`.

### 10.1 Compliance & Data Rights — Sprint 70
- 🎯 GDPR/CCPA automation; retention; DSAR.
- 🧪 `global:dsar`.

### 10.2 Public APIs & Docs — Sprint 71
- 🎯 External dev portal; examples; SDKs.
- 🧪 `global:api-docs`.

### 10.3 Federated Insights — Sprint 72
- 🎯 Multi‑site rollups; benchmarking; privacy‑preserving joins.
- 🧪 `global:federated-agg`.

### 10.4 AI Copilots — Sprint 73
- 🎯 Role‑aware assistants across modules with human‑in‑the‑loop.
- 🧪 `global:copilot`.

### 10.5 Open Marketplace — Sprint 74
- 🎯 Third‑party apps, reviews, monetization.
- 🧪 `global:market-monetize`.
- 🏁 Outcome: global, open, intelligent platform.

---

## ✅ Next Steps
1) Use this roadmap as the **source** for detailed sprint plans (per Phase).  
2) Generate/maintain **MBapp-Working.md** (hybrid tracker with checklists, smokes, retro logs).  
3) Keep this doc living: update timestamps and mark phases as delivered.



### Tier 1 — Foundations (Aligned)

1. **Core Identity**
   - **Party** as canonical identity (`kind: person | organization | animal`).
   - **PartyRole** for `customer | vendor | employee | ...`.
   - **PartyLink** for graph relationships (`employs, owns, member_of, handles, parent, ...`).
   - **UNIQ#** natural keys (email, registry, externalId) and role-based search endpoints.
   - **Smokes:** identity create → role assign → SO/PO linked; UNIQ# dupe guard; link queries.

2. **Line Editors & Commerce Core**
   - Unified line editor contract for SO/PO; totals/tax/pricing; over-commit/over-fulfill guardrails.
   - **Smokes:** backorder/reserve/fulfill/GR, edit-in-place, cancel/close gates.

3. **Labor & Staffing Foundations**
   - **EmployeeProfile** (employmentType, scope, payType, stdRate, GL defaults).
   - **EventStaffAssignment** (role, shift, costCategory=direct_labor|overhead, rateOverride).
   - **LaborEntry** (timesheet; eventId→COGS else Opex), **PayrollBatch** (approve/post).
   - **Posting Rules:** post labor to COGS if tied to event direct labor, else to Opex.
   - **Smokes:** staff assignment → labor entries → payroll batch post → GL lines & balances.

4. **Tier 1 Done Criteria**
   - Identity & role search stable; SO/PO lines consistent; guardrails enforced.
   - Labor posting to GL proven via smokes; basic reports (inventory counts, order statuses).
