
# 🧭 MBapp Roadmap vNext — Equestrian Operations Platform
*Executive & Technical Master Plan • Modern Gold Conference Deck*

---

## 🔝 Dual Summaries

### Executive Overview (Board-Ready)
- **Vision:** One platform to run equestrian events & operations — entries, stabling, inventory, orders, billing, scheduling, scoring, results, and analytics — with mobile-first workflows and AI assistance.
- **Top Initiatives (next 12 months):**
  1) **Sales Order Release & Backorder** (complete the order lifecycle)  
  2) **Views & Workspaces** (cross-module dashboards)  
  3) **Scanner/RFID** (receive/pick/count with EPC)  
  4) **Help Desk & Tutorials** (in‑app onboarding & support)  
  5) **Management & Projects** (task boards, timelines, automation)
- **Outcomes:** Faster field ops, fewer stockouts, auditable finances, happier exhibitors & staff.

### Technical Leadership Summary
- **Stack:** AWS API Gateway/Lambda/DynamoDB • React Native (Expo) • React Query • OpenAPI codegen • EventBridge • Idempotent smokes.
- **Themes:** Type-safe contracts, modular objects, spec‑driven codegen, CI smokes, integration hub, AI rail embedded across phases.
- **Now shipping:** SO release/backorder, orgs+events link, stabling v1, scorecards v1 scaffolds, message center v1.

---

## ⚙️ Core Platform (Foundation – ✅ Stable)
- AWS serverless, Objects CRUD, RBAC, audit fields, idempotency keys, OCC counters.  
- Mobile shell (Expo RN), shared hooks, focus/refetch, offline queue (scanner soon).  
- DevOps: GH Actions, PowerShell ops, smoke framework, seeders.

---

## 🧩 Core Business Operations (✅ Mostly Complete)
- **Products & Inventory (✅):** defaultItemId, BOM/bundles, counters `{onHand,reserved,available}`, ledger, locations.
- **Purchase Orders (✅):** draft→approved→received→closed; idempotent receive; returns.
- **Sales Orders (⚙️):** commit, reserve, release, fulfill; **backorder rollups**; BOPIS.  
- **Reporting (⚙️):** `/reports/so-summary` prototype; CSV/PDF export engine (shared).

---

## 🏇 Event & Competition — Phases 1 → 10

### Phase 1 — Foundations & Ops (Active)
- **Organizations (🚧):** sanctioning bodies/clubs; contacts, prefs, notes; link to Events.  
- **Events v2 (✅):** planned → scheduled → open → closed → archived.  
- **Classes/Divisions & Rules (🚧):** reusable catalog (code, fee, rule refs).  
- **Scorecards v1 (🚧):** template JSON; judge entry; CSV/PDF export.  
- **Stabling v1 (🚧):** stall inventory/assignments; bedding add‑ons.  
- **Message Center v1 (🚧):** push + SMS segments (event/ring/role).
- **Resources v1 (✅):** rings/equipment availability & reservations.

### Phase 2 — Scheduling & Field Ops
- **Venues & Facilities:** arenas, barns, warm‑ups; capacity; blackout/maintenance.  
- **Scheduling v1:** per‑ring grids; ride‑time assignment; conflicts (horse/rider/judge).  
- **Officials & Judges:** profiles, certifications, availability, scoring permissions.  
- **Transportation/Logistics:** trailer slots, arrival windows, dock/gate ops.  
- **Work Orders/Maintenance:** issues, assignment, SLA, parts/labor logs.

### Phase 3 — Entry, Access & Commerce
- **Ticketing & Badging:** public tickets; exhibitor/coach/owner passes; QR/NFC zones.  
- **Food & Beverage Ops (v1):** menus, time windows, pre‑orders, runner tickets, routes, comps.  
- **Merchandise POS (v1):** items, price lists, taxes, inventory decrement, refunds/exchanges.  
- **E‑Sign / Forms:** waivers, health certs, Coggins, consents; templated + per‑event.  
- **Packages & Discounts:** bundles (stall + classes), early‑bird, member/org pricing.

### Phase 4 — Finance & Admin (Expanded)
- **Billing/Invoicing:** entries, stalls, add‑ons, penalties, refunds; split bills.  
- **Payments (AR/AP):** Stripe/Square; refunds; vendor/judge payouts; reconciliation.  
- **Account Administration Suite:** tenant plans & billing; users & roles; audit center; API keys & webhooks; subscription switch.  
- **Compliance & Audit:** RBAC refinements, export logs for sanctioning bodies.

### Phase 5 — Results & Publishing (+ Help Desk & Tutorials)
- **Scorecards v2:** multi‑judge, tie‑breaks, validations, audit trail.  
- **Live Results:** leaderboards, splits, corrections with audit, publish controls.  
- **Calendars:** long‑range + live ops; iCal feeds; conflict overlays.  
- **Help Desk & Tutorials (new):** contextual coachmarks & tours; inline help drawer; in‑app tickets with logs; release notes panel.

### Phase 6 — People & Relationships (+ Bulk Data)
- **Riders/Owners/Trainers (CRM+):** memberships, affiliations, flags.  
- **Horses:** passport, medical notes, eligibility, class/stall history.  
- **Volunteers & Staffing:** roles, shifts, credentialing, comms.  
- **Bulk Data Loading (new):** CSV/Excel importers; field‑mapping wizard; dry‑run; partial accepts; rollback; presets.

### Phase 7 — Maps, Alerts & Safety
- **Maps & Wayfinding:** Mapbox overlays; stalls/rings/vendors; closures; navigation.  
- **Message Center v2:** templates, schedules, rate‑limits, auto‑alerts.  
- **Incident & Safety:** reports, triage, restricted visibility, follow‑ups.

### Phase 8 — Analytics & Integrations
- **Dashboards:** entries, revenue, capacity, no‑shows, productivity.  
- **Integrations:** Shopify/Woo/Square Online (catalog, orders, inventory, fulfillment); QBO/Xero; Twilio/SendGrid/Firebase; Mapbox; S3/Drive; Vimeo/YouTube.

### Phase 9 — Unified Ops (Views, Workspaces & Scanner)
- **Saved Views:** per module filters/columns; user/team/tenant scopes.  
- **Workspaces:** drag‑and‑drop dashboards mixing cards (Inventory, Events, Orders, Horses…).  
- **Cross‑module filters:** “Horses at Event X with open invoices & feed deliveries today.”  
- **Scanner/RFID:** EPC registry; contextual actions (receive, pick, count, assign stall, check‑in); offline queue; device profiles (Zebra/Socket).

### Phase 10 — Management & Projects
- **Task Boards & Projects:** Kanban, Gantt; tasks linked to objects; comments/mentions; attachments; templates; time tracking.  
- **Automation Rules:** “When PO received → close task”; “If stall vacated → create cleaning task.”  
- **Bridges:** Slack/Teams; Calendar; Jira/Trello optional.

---

## 🔌 Integrations — E‑Commerce Matrix (Shopify/Woo/Square Online)
- **Catalog:** two‑way products/variants; metafields for cross‑ids; collections/tags.  
- **Inventory:** per‑location optional; PO receive/count push; webhook pull (`inventory_levels/update`).  
- **Orders:** create/paid/fulfilled/refund; BOPIS/pickup; preorders/backorders.  
- **Fulfillment:** tracking numbers; partials; multi‑shipments.  
- **Customers:** CRM merge rules; duplicate detection.  
- **Discounts/Taxes:** codes/automatic; venue tax overrides.  
- **Returns:** RMAs; restock rules.  
- **Subscriptions:** recurring packages → recurring SOs.  
- **Ops:** OAuth, HMAC, rate limits, DLQ/replay, observability.

---

## 🧠 Cross‑Cutting Layers

### AI Assistants & Chatbots (embedded rail, not a late phase)
- **In‑app assistant:** context‑aware help; “explain this field”; open screens; generate drafts.  
- **Ops chatbot:** team channels; task integration; Message Center handoff.  
- **Client/public bot:** website widget; FAQs; entries; payments; CRM updates.  
- **Voice assistant (mobile):** “Check bedding in Barn 3” → counters/alerts.  
- **AI supervisor:** daily digests; smoke results; anomaly flags.  
- **Infra:** `/ai/assist`, `/ai/summary`, `/ai/chat`; context broker; knowledge index; redaction & safety.

### Document Scanning & OCR
- Mobile/web capture; auto‑OCR; classify (vet cert vs contract); auto‑tag; link to objects; full‑text search; audit bundles.  
- **Integrations:** Textract/Vision; embeddings for search.

### Developer & Admin Tools
- API playground; CLI ops; tenant sandbox resets; feature flags; migrations toggles; System Admin Console (usage, jobs, smoke rates, webhook DLQ).

---

## 📊 Role Fit (Web vs Mobile)
| Capability | Web (Back-Office) | Mobile (Field) | Both |
|---|---|---|---|
| Views & Workspaces | ✅ build/share | ✅ consume | ✅ |
| Scanner/RFID | – | ✅ primary | – |
| Help Desk & Tutorials | ✅ author KB | ✅ coachmarks, tickets | ✅ |
| Bulk Data Loading | ✅ imports | – | – |
| Projects/Tasks | ✅ manage | ✅ execute | ✅ |

---

## 🧪 Smokes (Highlights)
- **SO:** over‑commit/fulfill guards; **release** round‑trip; **commit‑backorder** and **reserve‑backfill**.  
- **PO:** idempotent receive; partials; returns; cancel/close edges.  
- **Inventory:** counters integrity; cycle count idempotency.  
- **Integrations:** HMAC verify; replay; rate‑limit handling.  
- **AI:** grounding checks; redaction; safe fallback.

---

## 📌 Object & Endpoint Index (New/Updated)
- `View`, `Workspace`, `ScanEvent`, `HelpArticle`, `ImporterJob`, `Task`, `Project`.  
- `/sales/so/{id}:release` • `/sales/so/{id}:reserve|fulfill|commit`  
- `/inventory/{itemId}/onhand` • `/import/{type}:dryrun|commit`  
- `/views`, `/workspaces` • `/scanner/events` • `/help/articles` • `/help/tickets`  
- `/ai/assist`, `/ai/summary`, `/ai/chat`

---

## 🗓️ Timeline (High-Level)
- **Q4 2025:** SO release/backorder; Orgs↔Events; Scorecards v1 scaffolds; Stabling v1; Message Center v1.  
- **Q1 2026:** Scheduling v1; Officials/Judges; Work Orders; Bulk Import v1.  
- **Q2 2026:** Commerce (Tickets, POS, F&B); Finance/Admin suite; Help Desk & Tutorials.  
- **Q3 2026:** Live Results; Calendars; Views/Workspaces v1; Scanner v1.  
- **Q4 2026:** Management & Projects v1; AI Assistants across modules; Integrations scale‑out.

---

*Legend: ✅ Done • ⚙️ Active • 🚧 Planned/In Progress • 🧪 Smoke/Test*
