# MBapp Master Roadmap — v2.0
_Last updated: October 14, 2025_

> **Includes:** Tier 1 Foundations (Phases 1.0 – 1.2) + Tier 2 Phase 2.0 Animals v1  
> Marks the official start of Tier 2 (Operations).

---

## 🧱 Tier 1 — Foundations (Phases 1.0 – 1.2)
*(Finalized in v1.3 — see Foundations summary)*

### **Phase 1.0 — Core Platform Architecture**
Universal schemas (Party, Role, Link, Venue, Resource) + auth core + UI kit.  
CI smokes verified multi‑tenant backbone.

### **Phase 1.1 — Unified Module Baseline**
Standardized Events, Registrations, Reservations, Classes, Scorecards with shared UI and guard logic.

### **Phase 1.2 — Core Commerce Baseline**
Products → Inventory → PO/SO → Movements → Accounting hooks with shared line editor patterns.  
Guardrails prevent negative inventory. Smokes green.

✅ **Outcome:** Stable foundation for Tier 2 expansion.

---

## 🐎 Tier 2 — Operations (Phases 2.0 – 2.3)

---

# **Phase 2.0 — Animals v1**
_Tier 2 | Sprints 6–7_

### 🎯 Objective
Introduce comprehensive animal management: health, performance, ownership, and integration with stabling, breeding, and sales.  
Each animal is a Party (kind = `animal`) linked to people and organizations via `PartyLink`.

### 🧱 Schemas
| Schema | Purpose | Key Fields |
|--|--|--|
| `AnimalProfile` | Core record for each horse / animal | `name`, `breed`, `sex`, `dob`, `color`, `registryNo`, `microchip`, `status: active|rehab|retired|deceased` |
| `AnimalHealthRecord` | Medical visits, vaccinations, injuries | `animalId`, `vetId`, `type`, `date`, `treatment`, `notes` |
| `AnimalPerformanceResult` | Show or event results | `animalId`, `eventId`, `classId`, `placing`, `score`, `riderId` |
| `AnimalOwnershipTransfer` | Tracks ownership history | `animalId`, `fromPartyId`, `toPartyId`, `transferDate`, `price?`, `billOfSale?` |

### 🔄 Core Flows
1. **Intake:** create AnimalProfile → assign current owner PartyLink.  
2. **Health Management:** add/update HealthRecords → vet Party association.  
3. **Performance:** log results linked to Events / Classes.  
4. **Ownership Change:** generate OwnershipTransfer → archive old link → create new.  
5. **Deactivation:** mark animal `retired` / `deceased` → lock future transactions.

### ⚙️ Guards & Validation
- Unique animal per registryNo / microchip.  
- Cannot transfer ownership to self.  
- Archived animals cannot enter events or reservations.  
- Health records require licensed vet role.  
- Performance entries require existing Event + Class.  

### 💻 UI / UX
- **AnimalDetailScreen:** tabs → Profile | Health | Performance | Ownership History.  
- Inline PartySelectors (owner, vet, trainer).  
- Photo upload + registry attachments (S3).  
- Quick‑actions: “Transfer Ownership”, “Add Health Record”, “Add Performance Result”.

### 🧪 Smokes
| Smoke | Description |
|--|--|
| `smoke:animals:create` | Create animal + assign owner PartyLink |
| `smoke:animals:health` | Add HealthRecord and verify vet association |
| `smoke:animals:performance` | Link performance result to Event/Class |
| `smoke:animals:transfer` | Execute OwnershipTransfer and verify link swap |
| `smoke:animals:retire` | Archive animal → validate no future registrations |

### 🔗 Dependencies
- Requires: Tier 1 (Party/Link schemas).  
- Feeds: Breeding (Phase 2.1), Event Platform (2.2), Auctions (2.3), Accounting (3.0 Journal entries for sales).

### 🕓 Sprints 6–7
| Sprint | Goal | Deliverables |
|--|--|--|
| 6 | Implement schemas + API | CRUD + validations for Animal entities |
| 7 | Integrate UI + smokes | Detail/List screens + photo uploads + guard tests |

### 🏁 Outcome
Animals are first‑class citizens in MBapp, linkable to people, events, and commerce.  
Foundation for Breeding (2.1) and Event operations (2.2).

---

**Next:** Phase 2.1 — Breeding & Reproduction Management

---
**MBapp Master Roadmap v2.0 (October 14, 2025)**


# **Phase 2.1 — Breeding & Reproduction Management**
_Tier 2 — Operations | Sprints 8–9_

---
## 🎯 Objective
Deliver a complete end‑to‑end **breeding workflow** for horses (and extensible to other livestock): contracts, bookings, collections, shipments, inseminations, pregnancy checks, and foaling — with **lineage tracking**, **resource scheduling**, **inventory usage**, and **billing hooks**.

This phase builds directly on **2.0 Animals** and the foundation schemas from **Tier 1**.

---
## 🧱 Schemas

| Schema | Purpose | Key Fields |
|---|---|---|
| **BreedingContract** | Legal/financial agreement for a pairing or season | `stallionId`, `mareId?`, `seasonYear`, `terms` (studFee, chuteFee, collectionFee, liveFoalGuarantee?), `status: draft|active|completed|cancelled`, `billingPolicy`, `notes` |
| **CollectionEvent** | Stallion semen collection | `stallionId`, `ts`, `method: natural|AV`, `techId`, `volume`, `motility%`, `morph%`, `extender`, `doseCount`, `notes` |
| **SemenBatch** | Identified batch of doses from a collection | `collectionId`, `batchCode`, `doseQty`, `uom`, `storage: fresh|chilled|frozen`, `locationId?` (cryotank), `expiresAt?` |
| **Shipment** | Shipment of semen doses | `batchId`, `fromVenueId`, `toVenueId`, `carrier`, `tracking`, `packedAt`, `arrivedAt?`, `condition`, `status: packed|in_transit|delivered|lost|damaged` |
| **Insemination** | Use of semen on a mare | `mareId`, `batchId?`, `stallionId`, `ts`, `techId`, `site: uterine|deepHorn`, `doseUsed`, `notes` |
| **PregnancyCheck** | Result of ultrasound/check | `mareId`, `inseminationId?`, `ts`, `result: positive|negative|resorb|unknown`, `daysPostOv`, `vetId`, `notes` |
| **FoalingRecord** | Birth record and foal creation | `mareId`, `stallionId`, `dueDate?`, `foaledAt`, `sex`, `color?`, `complications?`, `vetId?`, `foalPartyId` (auto‑created) |
| **LineageLink** | Graph link of sire/dam → foal | `foalId`, `sireId`, `damId`, `confidence: confirmed|declared` |
| **ReproBooking** | Scheduling of resources needed | `resourceId` (breeding shed, lab, cryotank), `partyId?`, `startsAt`, `endsAt`, `bookingType: collection|insemination|check`, `status` |
| **ReproSupplyUsage** | Inventory usage tied to events | `itemId`, `qty`, `uom`, `usedOn: collection|insemination|check`, `refId` |

> Storage & supplies leverage existing **Resource** (e.g., `cryotank`) and **Inventory** schemas.

---
## 🔄 Core Flows

1) **Contract → Booking**
- Create **BreedingContract** (stallion, optional mare, season terms).  
- Book **ReproBooking** for collection or insemination (resources: shed, lab, tank).

2) **Collection → Batch → Shipment**
- Record **CollectionEvent**; auto‑create **SemenBatch** with dose count.  
- Optionally **Ship** doses (fresh/chilled/frozen) to destination venue; track status.

3) **Insemination → Pregnancy Checks**
- Use **SemenBatch** doses (decrement inventory) during **Insemination**.  
- Schedule **PregnancyCheck** (e.g., 14/28/45 day scans). Capture results.

4) **Foaling → Foal Party Creation**
- On **FoalingRecord**, auto‑create **Party(kind=animal)** for **foal**, link **Lineage** (sire/dam).  
- Optionally generate **Registration packet** for breed registry submission (export PDF).

5) **Billing Hooks**
- Apply **stud/chute/collection/shipping/boarding** fees per **BreedingContract.billingPolicy**.  
- Create **draft AR Invoice** (Phase 3.1 Billing) or **JournalEntry** (Phase 3.0 Accounting) stubs.

---
## ⚙️ Guards & Validation

- **Contract status gates:** only `active` contracts can create bookings.  
- **Dose accounting:** **SemenBatch** dose usage cannot go negative; shipment reconciliation required.  
- **Chain integrity:** Insemination requires either `batchId` or `stallionId` (record intent); pregnancy checks must reference a mare and occur after insemination date.  
- **Foaling:** cannot create FoalingRecord without a positive pregnancy or manual admin override; auto‑creates foal Party with required minimal fields.  
- **Lineage:** `LineageLink` must reference existing sire/dam/foal Parties and prevent circular references.  
- **Compliance:** configurable retention & masking for sensitive medical data.

---
## 💻 UI / UX

- **BreedingContractDetail**: terms, fees, parties (stallion, mare owners), status, billing policy; actions → *Activate*, *Complete*, *Cancel*.  
- **Collection & Insemination Wizards**: step‑through capture (resource, staff/tech, supplies, measurements).  
- **Mare Timeline**: visualize heats, inseminations, checks, due date; notifications.  
- **Stallion Profile Enhancements**: collection history, quality metrics, progeny.  
- **Foaling Flow**: quick create → foal Party + lineage links → optional photo/ID.  
- **Resource Calendar**: breeding shed / lab / cryotank bookings (per‑resource day view).

---
## 📦 Inventory & Resource Integration

- **Inventory usage** captured via **ReproSupplyUsage** and posted as **InventoryMovement(kind=adjust/use)**.  
- **Cryotank** modeled as **Resource**; **SemenBatch.locationId** points to tank/slot.  
- **Shipping** integrates with carrier API later (Phase 4.0 Integrations).

---
## 🧪 Smokes

| Smoke | What it Verifies |
|---|---|
| `smoke:breeding:contract-flow` | Create → activate contract → book events |
| `smoke:breeding:collection` | Collection creates batch, dose counts valid, supplies decremented |
| `smoke:breeding:shipment` | Ship batch, update status, reconcile doses on delivery |
| `smoke:breeding:insemination` | Use batch dose, guard against negatives |
| `smoke:breeding:preg-checks` | Schedule & record outcomes (positive/negative) |
| `smoke:breeding:foaling` | Create foaling record → foal party + lineage links |
| `smoke:breeding:audit` | Tlog/trace present for all critical changes |

---
## 🔗 Dependencies

- **Requires:** Phase 1.x (Party/Resource/Inventory), Phase 2.0 (Animals).  
- **Feeds:** Phase 2.2 (Event Platform — scheduling), Phase 2.3 (Auctions — foal/youngstock), Phase 3.x (Accounting/Billing).

---
## 🕓 Sprints 8–9

| Sprint | Focus | Deliverables |
|---|---|---|
| **8** | Schemas & API | CRUD for contracts, collection, batch, shipment, insemination, checks, foaling |
| **9** | UI & Smokes | Wizards, timelines, resource calendar, dose & billing validations |

---
## 🏁 Outcome
A production‑ready **breeding pipeline** with **lineage**, **inventory usage**, **resource bookings**, and **billing hooks**.  
Positions MBapp to monetize stud services, manage compliance, and create enduring performance line data for analytics.


# **Phase 2.2 — Event Platform & Live Operations**
_Tier 2 — Operations | Sprints 10–12_

---
## 🎯 Objective
Deliver a **production-grade live/hybrid event stack**: **Ticketing & Attendees**, **Badging & Access Control (QR/RFID)**, **Streaming & Live Production (OBS/WebRTC)**, **Sessions & Scheduling Grid**, **Vendor Booths**, and **Onsite Commerce** — with **lightweight telemetry hooks** so analytics are trivial to layer on in later tiers.

**Design rule:** capture clean **event logs** and **counters** everywhere (scans, views, purchases) with low overhead now, so analytics can be added without refactors.

---
## 🧱 Schemas

### A) Ticketing & Attendees
- **TicketType**  
  `eventId`, `name`, `price`, `currency`, `admissionRules` (zones, days), `salesWindow` (start/end), `refundPolicy`, `maxPerOrder?`, `status: draft|active|archived`

- **Purchase**  
  `eventId`, `partyId` (buyer), `items[]` (`sku`|`ticketTypeId`|`merchId`, qty, unitPrice), `totals`, `paymentRef`, `paymentStatus: pending|authorized|captured|refunded|void`, `syncState`

- **Ticket**  
  `ticketTypeId`, `attendeeId` (Party), `purchaseId`, `status: issued|void|refunded`, `barcode`, `qrData`, `rfidTagId?`, `zones[]`, `issuedAt`

- **AttendeeProfile**  
  `partyId`, `eventId`, `email?`, `phone?`, `preferences?`, `emergencyContact?`

### B) Badging & Access
- **BadgeTemplate**  
  `eventId`, `name`, `fields[]` (name, role, org, QR code, photo), `layout` (w,h,positions), `encoding: qr|rfid`

- **Badge**  
  `templateId`, `holderPartyId`, `eventId`, `role: attendee|exhibitor|staff|judge|media`, `rfidTagId?`, `printedAt?`, `status: active|revoked`

- **AccessZone**  
  `eventId`, `code`, `name`, `gates[]`, `rules` (roles or ticket zones allowed)

- **ScanEvent**  
  `eventId`, `gate`, `who` (ticketId|badgeId|rfid), `ts`, `result: allow|deny`, `reason?`, `zone`

### C) Streaming & Live Production
- **Stream**  
  `eventId`, `sessionId?`, `source: obs|webrtc|rtmp`, `ingestUrl?`, `playbackUrl?`, `status: idle|live|ended`, `cdn: cloudfront|mux|custom`, `notes?`

- **OverlayConfig**  
  `eventId`, `sessionId?`, `widgets` (class info, rider card, sponsor banners, lower-thirds), `theme?`

- **Recording**  
  `eventId`, `sessionId?`, `assetUrl`, `durationSec?`, `publishedAt?`, `acl` (public|ticketHolders|private)

### D) Scheduling & Sessions
- **Session**  
  `eventId`, `venueId?`, `resourceId?`, `name`, `startsAt`, `endsAt`, `divisionId?`, `classIds[]?`, `status: scheduled|live|paused|ended`, `capacity?`

- **RunOrder**  
  `sessionId`, `entries[]` (`partyId` rider, `animalId`, order, scratches[]), `notes?`

### E) Vendors & Booths
- **Booth**  
  `eventId`, `resourceId` (maps to a Resource), `mapCoords?`, `power?`, `water?`

- **VendorApplication**  
  `eventId`, `vendorPartyId`, `requestedBoothType`, `notes`, `status: submitted|approved|rejected|withdrawn`

- **VendorContract**  
  `eventId`, `vendorPartyId`, `boothId`, `fees[]` (amount, description), `status: draft|signed|cancelled`, `documents[]`

### F) Onsite Commerce (Event Hub)
- Uses existing **Purchase** (items include `merchId` / `sku`) + POS endpoints.  
- **POSRegister** (optional): `eventId`, `code`, `status`, `cashDrawerId?`

### G) Telemetry (Lightweight; for Analytics Later)
- **EventLog**  
  `ts`, `actor` (partyId or deviceId), `eventType` (scan.allow, scan.deny, ticket.issued, stream.start, stream.view, purchase.capture), `refType/refId`, `metadata`

- **Counter**  
  `eventId`, `kind` (gate.entry, stream.viewers, sales.total), `period` (min/5min/hour/day), `value`, `asOf`

> These are intentionally simple so we can aggregate efficiently later without schema churn.

---
## 🔄 Core Flows

1) **Ticket Sale → Issue → Gate Scan**  
   - Buyer completes **Purchase**; **Ticket(s)** issued with zones.  
   - At gate, **ScanEvent** checks zones/role and logs allow/deny.  
   - **EventLog** records issuance and scans; **Counter** increments gate entries.

2) **Staff/Exhibitor Badging**  
   - Generate **Badge** from **BadgeTemplate**, assign zones based on role.  
   - Print/encode QR/RFID; revoke on loss or role change.

3) **Streaming**  
   - Create **Stream** per session; set ingest/playback URLs (OBS/WebRTC).  
   - Live overlays updated via **OverlayConfig**; **Recording** saved and ACL’ed.  
   - **EventLog** for stream start/stop; **Counter** for concurrent viewers (5‑min buckets).

4) **Sessions & Run Order**  
   - Build **Session** grid (resource/time); attach **RunOrder** (rider/animal).  
   - Update in real time (scratches, delays); optional push notifications.  
   - Post‑event: publish **Recording** and **Scorecard** links.

5) **Vendors & Booths**  
   - Intake **VendorApplication** → approve/sign **VendorContract** → assign **Booth** (Resource).  
   - Fees → **Purchase** (and later **Invoice**).  
   - Day‑of support: badge access and settlement exports.

6) **Onsite Commerce**  
   - POS sale → **Purchase.capture** → inventory decrement → (later) AR posting.  
   - Supports offline queue for spotty connectivity; idempotent capture on reconnect.

---
## ⚙️ Guards & Validation

- **Ticket type windows** enforced (no sales outside `salesWindow`).  
- **Zone access**: `ScanEvent` MUST check role/zone rules; optional anti‑passback.  
- **Streaming control**: only authorized staff can start/stop live streams.  
- **Session conflicts**: resource double‑booking prevented; attendee/animal double‑book warnings.  
- **Vendor contracts** must be `signed` before booth occupancy.  
- **Purchases** idempotent with `Idempotency-Key`; refunds generate reversal logs.

---
## 💻 UI / UX

- **EventHub Dashboard**: live KPIs (entries, viewers, sales), quick actions, alerts.  
- **Gate App**: fast QR/RFID scanning (online/offline), large allow/deny UI, rate‑limited.  
- **Streaming Console**: shows ingest, status, overlays, and recording controls.  
- **Session Grid**: per‑ring/day view; drag‑drop moderation; run‑order management.  
- **Vendor Console**: applications, contracts, booth map, fee posting and settlement.  
- **POS**: compact quick‑sell interface, receipt printing, partial refunds.

> All screens emit **EventLog** and update **Counter** silently for analytics later.

---
## 🧪 Smokes

| Smoke | Verifies |
|---|---|
| `smoke:events:ticketing-flow` | Purchase → ticket issue → gate allow/deny → logs |
| `smoke:events:badging` | Badge print/encode → zone access → revoke |
| `smoke:events:streaming` | Stream start/stop → overlay update → recording |
| `smoke:events:scheduling` | Build/publish schedule → update conflicts |
| `smoke:events:vendors` | Application → contract → booth assign → fee posting |
| `smoke:events:pos` | POS sale → inventory decrement → idempotent capture |
| `smoke:events:telemetry` | EventLog & Counter aggregation buckets roll up |

---
## 🔗 Dependencies

- **Requires:** Tier 1 (Party/Venue/Resource/Inventory), Phase 1.1 (Events), Phase 1.2 (Commerce).  
- **Feeds:** Tier 3 (Billing/Accounting), Tier 4 (Integrations: CDN, payments), Tier 5 (AI/Insights).

---
## 🕓 Sprints 10–12

| Sprint | Focus | Deliverables |
|---|---|---|
| **10** | Ticketing/Badging | Schemas, issue/scan flows, zone guards, basic dashboards |
| **11** | Streaming/Sessions | OBS/WebRTC integration, overlays, schedule grid, recordings |
| **12** | Vendors/POS/Telemetry | Booths & contracts, POS capture + inventory, EventLog/Counter |

---
## 🏁 Outcome
MBapp’s **Event Platform** is live‑ready with ticketing, access, streaming, vendor ops, and onsite commerce.  
Every critical action **emits telemetry** (logs & counters) so future analytics/AI can be layered on **without changing core flows**.


# **Phase 2.3 — Commerce & Auctions**
_Tier 2 — Operations | Sprints 13–14_

---
## 🎯 Objective
Deliver unified **commerce flows** for merchandising and food & beverage, plus a **live/online auction platform** tightly integrated with inventory, animals, events, and finance. Settlement posts into Sales/Billing and ultimately Accounting.

---
## 🧱 Schemas

### A) Merchandising & F&B
- **MerchCatalogItem**: `sku`, `name`, `price`, `taxCode?`, `inventoryItemId?`, `category`, `status`
- **MenuItem** (F&B): `code`, `name`, `price`, `taxCode?`, `prepType`, `status`
- **POSOrder**: `eventId?`, `registerId?`, `partyId?`, `lines[] (sku|menuItemId, qty, unitPrice, taxRate?)`, `totals`, `paymentRef`, `paymentStatus`, `status: draft|captured|refunded|void`
- **POSRegister**: `eventId?`, `code`, `status`, `cashDrawerId?`

> POSOrder maps to **Purchase** (Phase 2.2) for a single, consistent payment/receipt model.

### B) Auction
- **AuctionSession**: `eventId?`, `venueId?`, `resourceId?`, `startsAt`, `endsAt`, `status: scheduled|live|ended|settled`, `catalogPublishedAt?`, `streamId?`
- **AuctionLot**: `sessionId`, `lotNo`, `title`, `animalId?` or `sku?`, `reservePrice?`, `estLow?`, `estHigh?`, `consignorId?`, `photos[]`, `status: pending|open|sold|passed|withdrawn`
- **AuctionRegistration**: `sessionId`, `partyId` (bidder), `status: pending|approved|blocked`, `deposit?`, `paddleNo?`
- **AuctionBid**: `lotId`, `bidderId`, `amount`, `ts`, `isAbsentee?`, `isPhone?`, `accepted: true|false`, `winning?`
- **AuctionSettlement**: `lotId`, `finalPrice`, `buyerId`, `fees[] (buyerPrem, salesTax, transport, board)`, `payMethod`, `status: pending|paid|defaulted`, `documents[]`

### C) Ownership & Transfer (Animals)
- **OwnershipTransfer** (reuse Phase 2.0): `animalId`, `fromPartyId`, `toPartyId`, `transferDate`, `price?`, `billOfSale?`
- Link AuctionSettlement → OwnershipTransfer when an animal is sold.

---
## 🔄 Core Flows

### 1) POS (Merch & F&B)
1. Create **POSOrder** with lines → calculate totals and tax.  
2. Capture payment (card/cash) → `status=captured`.  
3. If lines reference `inventoryItemId`, decrement on fulfillment.  
4. Map POSOrder → **Purchase** record (Phase 2.2) for unified receipts.  
5. Later: post to **AR/Accounting** (Tier 3).

### 2) Auction (Live/Online/Hybrid)
1. **Catalog**: create **AuctionSession**, add **AuctionLot** (animals or goods). Publish catalog.  
2. **Registration**: approve bidders; assign paddle numbers; handle deposits.  
3. **Bidding**: take bids (live clerk + online). `AuctionBid.accepted` drives current price.  
4. **Hammer**: mark **lot sold** (or passed). Determine **finalPrice**.  
5. **Settlement**: create **AuctionSettlement** with buyer fees, tax, transport.  
6. **Transfer** (animal lots): auto-create **OwnershipTransfer** (2.0) to update animal owner.  
7. **Posting**: generate **SalesOrder/Invoice** stubs to feed Tier 3.

### 3) Online Live
- Integrate **Stream** (2.2) into AuctionSession; expose bid overlay.  
- Online bidders use secure sockets; clerking reconciles with floor bids.  
- Latency mitigation: bid windows, staggered increments.

---
## ⚙️ Guards & Validation

- **POS**: idempotent captures (`Idempotency-Key`), refunds create reversal entries, inventory cannot go negative.  
- **Auction**: bidder must be `approved`; bids must exceed current + increment; cannot sell below reserve unless admin override.  
- **Settlement**: must be `paid` before OwnershipTransfer finalizes (configurable).  
- **Compliance**: KYC thresholds (configurable); audit trail (tlog) on hammer and settlement.

---
## 💻 UI / UX

- **POS**: quick-sell keypad, barcode scan, receipt print, offline queue with safe replays.  
- **Auction Clerk Console**: lot progression, bid stack, reserve status, hammer, undo/void, settlement shortcut.  
- **Bidder App**: live bid buttons with increments, max/auto-bid, lot watchlist, balance due.  
- **Catalog Manager**: photo/video, animal profile link, estimated ranges, consignor details.  
- **Settlement Screen**: fees, tax, transport add-ons with previews of invoice & ownership transfer.

---
## 🧪 Smokes

| Smoke | Verifies |
|---|---|
| `smoke:pos:order-flow` | Create → capture → inventory decrement → refund |
| `smoke:auction:catalog` | Create session, lots, publish catalog |
| `smoke:auction:bidding` | Register bidder, place bids w/ rules & increments |
| `smoke:auction:settlement` | Hammer → settlement fees → SO/Invoice stub |
| `smoke:auction:transfer` | Settlement paid → OwnershipTransfer generated |
| `smoke:auction:stream` | Stream linked to session; bid overlay events |

---
## 🔗 Dependencies

- **Requires:** Tier 1 (Products/Inventory/SO-PO), Phase 2.2 (Event Platform Stream & Purchase).  
- **Feeds:** Tier 3 (Accounting, Billing), Tier 5 (pricing analytics).

---
## 🕓 Sprints 13–14

| Sprint | Focus | Deliverables |
|---|---|---|
| **13** | POS & Merch/F&B | POSOrder + capture + inventory hooks + smokes |
| **14** | Auction end-to-end | Session → bids → hammer → settlement → transfer + smokes |

---
## 🏁 Outcome
A unified **Commerce layer** that supports day-of-event sales (merch, F&B) and **Auctions** (live/online), tied tightly to inventory, animals, and finance.  
This unlocks Tier 3 (Accounting, Billing, Expense) with real revenue sources and verifiable audit trails.


## 📺 Display & Presentation Boards (Applies to 2.2 Event Platform and 2.3 Auctions)
_Last updated: October 14, 2025_

**Goal:** Provide configurable boards for in-venue and online viewers across event types: rings (on-deck/now/next), leaderboards, class/rider cards, schedules, vendor promos, and auction bidder boards.

### 🧱 Schemas
- **DisplayScreen** — `eventId`, `name`, `kind: audience|backstage|auction|remote`, `resolution`, `placement`, `status`, `feedId?`
- **DisplayFeed** — `eventId`, `source: streamId|sessionId|lotId|custom`, `layoutId`, `refreshMs`, `overlays[]`, `isPublic`
- **DisplayLayout** — `name`, `regions[] (id,x,y,w,h)`, `widgets[] (regionId,type: video|image|text|schedule|leaderboard|runorder|lot|bid|scoreboard|ticker, props)`
- **LotDisplayState** — `lotId`, `currentBid`, `increment`, `leadingBidder?`, `timeLeftMs`, `status: pending|open|lastCall|sold|passed`
- **LeaderboardState** — `sessionId|classId`, `rows[] (rank, party/animal, score, time, penalties)`
- **RunOrderState** — `sessionId`, `now`, `onDeck`, `upNext[]`
- **BidTick** — `lotId`, `bidderId?`, `amount`, `accepted`, `deltaMsFromPrev`, `ts`
- **AntiSnipingRule** — `sessionId`, `extendIfBidInsideMs`, `extendByMs`, `hardStopAt?`

> These reference existing **Stream**, **Session**, **RunOrder**, **Scorecard**, **AuctionSession**, **AuctionLot**, and **AuctionBid**.

### 🔄 Core Flows
1) **Ring Boards (Scheduling & On-Deck)**  
   - Feed = `Session` → Layout with regions: **video**, **RunOrder (now/on-deck/up-next)**, **sponsor ticker**.  
   - Stage changes emitted from steward tablet update **RunOrderState** instantly.
2) **Leaderboards & Results**  
   - **Scorecard** updates drive **LeaderboardState**; top-N display, ties, penalties.  
   - Post-class: auto-rotate results with sponsor banner.
3) **Auction Bidder Boards**  
   - Clerk sets active lot → **LotDisplayState** drives current bid, increment, timer, reserve/met.  
   - **BidTick** feeds animations and anti-sniping extension rules.
4) **Remote Viewer & Overflow**  
   - Public **DisplayFeed** exposes read-only JSON + HLS/MPD video for web/mobile screens.  
   - Offline fallback image + auto-reconnect.

### 🧪 Smokes
- `smoke:display:ring-board` — session feed → run order updates → on-deck board refresh.  
- `smoke:display:leaderboard` — scorecard updates → leaderboard render order correct.  
- `smoke:display:auction-board` — bids → LotDisplayState → anti-sniping → hammer.  
- `smoke:display:failover` — stream loss → fallback → auto-restore.

### ⚙️ Guards & UX
- Single **authoritative writer** for state (steward/clerk). Others read-only.  
- Idempotent updates keyed by `(sessionId|lotId, seq)` prevent flicker.  
- **Broadcast Safe** mode hides personal data on public feeds.  
- Accessible, high-contrast themes; color-blind safe badges.

### 💻 UI Components
- **Display Manager:** create layouts, assign feeds→screens, preview feeds.  
- **Steward Console:** run-order controls (advance, scratch), emits state updates.  
- **Clerk Console (Auction):** open/last call/hammer, reserve badge, extend timer, sponsor triggers.  
- **Viewer Web/App:** stream + widgets; QR for registration/payment when applicable.

### 🔗 Integration Points
- Pulls: **Stream**, **Session**, **RunOrder**, **Scorecard**, **AuctionLot/Bid**.  
- Emits: **EventLog** (`display.update`, `auction.hammer`, `bid.accepted`) and **Counter** (viewers).  
- Links to **Billing/Accounting** via sponsor placements and auction settlements.



# 💰 Tier 3 — Finance & Accounting (Phases 3.0–3.2)
_Last updated: October 14, 2025_

This tier turns MBapp into a full operational ledger: every operational flow (SO/PO, POS, Events, Reservations, Auctions, Breeding) posts **balanced double-entry** with **cost centers** and **third‑party revenue share** where applicable.

---

## **Phase 3.0 — Accounting Core**
_Tier 3 | Sprints 15–17_

### 🎯 Objective
Build a robust accounting substrate: **Chart of Accounts**, **Journal → Ledger**, **Posting Rules**, **Revenue Share**, **Cost Centers/Tags**, and core **financial statements**.

### 🧱 Schemas
- **Account** — `number`, `name`, `currency`, `accountType: asset|liability|revenue|expense|equity`, `status`
- **JournalEntry** — `id`, `ts`, `sourceType`, `sourceId`, `memo?`, `lines[]`, `postedBy`, `audit`
- **JournalEntryLine** — `accountId`, `debit`, `credit`, `partyId?`, `itemId?`, `taxCode?`, `costCenterType? (event|resource|animal|project)`, `costCenterId?`, `tags?[]`
- **LedgerBalance** — `accountId`, `period` (month), `currency`, `debit`, `credit`, `balance`
- **PostingRule** — `sourceType` (SO\|PO\|POS\|Auction\|Registration\|Reservation\|Breeding), `lineKind`, mapping → `{ debitAccountId, creditAccountId, taxAccountId? }`, `costCenterDerive?`
- **RevenueShareRule** — `sourceType`, `trigger: sale\|settlement\|payment`, `percent`, `minFee?`, `maxFee?`, `targetPartyId`, `accountId?`, `effectiveDates`, `notes?`
- **RevenueShareEntry** — `sourceType`, `sourceId`, `fromPartyId`, `toPartyId`, `percent`, `amount`, `status: pending\|approved\|paid`, `journalEntryId?`

### 🔄 Core Flows
1) **Operational Posting**  
   - On finalize events (e.g., **SO Fulfillment**, **PO Receive**, **POS Capture**, **Auction Settlement**, **Registration Confirm**, **Reservation Complete**), apply **PostingRules** to generate balanced **JournalEntry** with cost centers.  
   - Taxes posted to appropriate tax accounts (if configured).

2) **Third‑Party Revenue Share**  
   - When a transaction triggers revenue share: create **RevenueShareEntry** and a payable to the third party’s account.  
   - Disbursement later clears the payable and links `journalEntryId`.

3) **Period Close**  
   - Sum **LedgerBalance** by period; lock journals; produce **Trial Balance**.  
   - Generate **P&L** and **Balance Sheet** from account groups.

### ⚙️ Guards & Validation
- Journal must balance: `Σdebits == Σcredits`.  
- No postings to `archived` accounts; multi‑currency not mixed within a journal.  
- Idempotent posting via `(sourceType, sourceId)` key.  
- Cost center required when rule says so (e.g., event revenue).  
- Immutable journals after close; use reversing entries for corrections.

### 💻 UI / UX
- **Chart of Accounts** manager with account groups.  
- **Posting Rules** editor with test harness (preview JE from a sample source).  
- **Journal Browser** (filters by period, source, cost center, tag).  
- **Trial Balance / P&L / Balance Sheet** basic views + CSV export.

### 🧪 Smokes
- `smoke:acct:post-so` — SO fulfillment posts revenue/COGS correctly with cost center=event.  
- `smoke:acct:post-po` — PO receive posts inventory and accruals.  
- `smoke:acct:post-pos` — POS capture posts revenue, tax, and cash.  
- `smoke:acct:post-auction` — Settlement posts buyer premium, commission, and revenue share payable.  
- `smoke:acct:balance-check` — Journal balances per entry and per period.  
- `smoke:acct:trial-balance` — TB equals net of journals; statements render.

### 🔗 Dependencies
- Requires: Tier 1.2 (Core Commerce), Tier 2 (Events, Auctions, Animals baseline).  
- Feeds: Tier 3.1 (Billing AR/AP), Tier 3.2 (Expense), Tier 5 (AI).

### 🕓 Sprints 15–17
| Sprint | Focus | Deliverables |
|---|---|---|
| **15** | Chart & Journal | Accounts, JournalEntry API, basic statements |
| **16** | Posting Rules | SO/PO/POS/Registration/Reservation/Auction posting |
| **17** | Revenue Share + Close | RevenueShare + Trial Balance + Close/lock |

### 🏁 Outcome
A dependable double‑entry core with cost centers and third‑party revenue share, producing TB/P&L/BS and powering all downstream finance.

---

## **Phase 3.1 — Billing (AR/AP)**
_Tier 3 | Sprints 18–19_

### 🎯 Objective
Operationalize **Invoices, Bills, Credits, Payments, Refunds** with AR/AP aging, statements, reminders, and payment integration.

### 🧱 Schemas
- **Invoice** — `customerId`, `issueDate`, `dueDate`, `lines[] (itemId|desc, qty, unitPrice, taxRate?, revenueType)`, `totals`, `status: draft|issued|paid|void|refunded`, `journalEntryId?`, `costCenterType?`, `costCenterId?`
- **Bill** — `vendorId`, similar structure to Invoice, `status: draft|posted|paid|void`
- **CreditNote / DebitNote** — adjustments with references to Invoice/Bill.  
- **Payment** — `partyId`, `amount`, `method`, `ref`, `apply[] (invoiceId/billId, amount)`, `status`.  
- **Refund** — `paymentId`, `amount`, `status`.  
- **StatementRun** — `partyId`, `period`, `openingBalance`, `movements[]`, `closingBalance`.

### 🔄 Core Flows
1) **AR**  
   - Generate **Invoice** from SO/POS/Auction/Registration/Reservation; post JE via 3.0 rules.  
   - **Payments** apply to invoices (partial OK), update AR aging.  
   - **Refunds** reverse revenue and cash appropriately.

2) **AP**  
   - Create **Bill** from PO receive/service fees; **Payments** clear liabilities.  
   - **Credits** apply to bills; aging tracked similarly.

3) **Reminders & Statements**  
   - Dunning levels (gentle → stern); email/SMS templates.  
   - Periodic **StatementRun** for key accounts (organizers, vendors, consignors).

4) **Payment Integration Layer**  
   - Gateways (Stripe/Square) abstracted behind common API with idempotent capture and webhook reconciliation.  
   - Optional sync to Xero/QBO in Tier 4.

### ⚙️ Guards & Validation
- No apply more than outstanding balance.  
- Currency must match account currency.  
- Invoices cannot be edited after payment; use credit notes.  
- Payments reconciled against gateway events (webhooks) to prevent duplicates.

### 💻 UI / UX
- **AR Console**: invoice list, balances, quick “record payment”.  
- **AP Console**: bills, approvals, payment runs.  
- **Cash App Screen**: search invoices, scan receipt QR, apply payment.  
- **Statements & Dunning**: batch generate & send with templates.

### 🧪 Smokes
- `smoke:billing:invoice-from-so` — SO → Invoice → Payment → posting and aging.  
- `smoke:billing:refund` — Refund reverses revenue/cash correctly.  
- `smoke:billing:ap-flow` — Bill → Payment → ledger tie‑out.  
- `smoke:billing:statements` — StatementRun balances opening/closing.

### 🔗 Dependencies
- Requires: 3.0 core posting.  
- Feeds: Tier 4 integrations (Xero/QBO), Tier 5 analytics.

### 🕓 Sprints 18–19
| Sprint | Focus | Deliverables |
|---|---|---|
| **18** | AR Invoicing & Payments | Invoice API/UI + payments + aging |
| **19** | AP & Statements | Bills + payment runs + statements + dunning |

### 🏁 Outcome
End‑to‑end AR/AP with payments and statements, fully posting to the ledger and ready for external syncs.

---

## **Phase 3.2 — Expense Management**
_Tier 3 | Sprints 20–21_

### 🎯 Objective
Centralize **expenses**, approvals, allocations, and budgets with imports from bank/credit feeds; enable cost controls and margin reporting.

### 🧱 Schemas
- **ExpenseReport** — `submitterId`, `period`, `status: draft|submitted|approved|reimbursed`, `lines[]`
- **ExpenseLine** — `date`, `vendor?`, `desc`, `amount`, `tax?`, `receiptUrl?`, `allocation[] (costCenterType, costCenterId, percent|amount)`, `tags[]`
- **Reimbursement** — `reportId`, `amount`, `paidAt`, `method`
- **Budget** — `costCenterType`, `costCenterId`, `period`, `amount`
- **FeedImport** — bank/card import batches with mapping rules

### 🔄 Core Flows
1) **Capture → Approve → Post**  
   - Employee submits **ExpenseReport**; approver workflow; upon approval, post to ledger using allocations.  
2) **Imports**  
   - **FeedImport** ingests transactions; map to ExpenseLines; prevent duplicates via import hash.  
3) **Budgets & Alerts**  
   - Compare **actuals vs budget** at cost‑center level; alert thresholds.

### ⚙️ Guards & Validation
- Each **ExpenseLine** must allocate 100% (sum of allocation shares).  
- Duplicate feed entries blocked by checksum + amount/date matching.  
- Reimbursement cannot exceed approved total.

### 💻 UI / UX
- **Submitter App**: quick add with photo receipt OCR.  
- **Approver View**: batched approvals with policy flags.  
- **Budget Board**: heat map by event/resource/animal.

### 🧪 Smokes
- `smoke:expense:report-cycle` — submit → approve → post → reimburse.  
- `smoke:expense:import` — feed import → dedupe → mapping → post.  
- `smoke:expense:budget` — over‑budget alert on allocations.

### 🔗 Dependencies
- Requires: 3.0 posting, cost center tagging.  
- Feeds: Tier 5 analytics (profitability by segment).

### 🕓 Sprints 20–21
| Sprint | Focus | Deliverables |
|---|---|---|
| **20** | Reports & Imports | Expense reports, feed ingest, posting |
| **21** | Budgets & Reimburse | Budgets, approvals, reimbursements, alerts |

### 🏁 Outcome
Tight cost control with allocations down to horse/event/resource; budgets and imports create a complete picture of profitability without extra refactors.

---

## ✅ Tier 3 Outcome
A complete, auditable financial backbone: postings, AR/AP, and expenses — all **cost‑center aware** and **revenue‑share capable**. Ready for Tier 4 (Integrations & Reporting) and Tier 5 (AI & Automation).
