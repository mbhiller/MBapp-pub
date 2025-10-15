# MBapp-Relationships.md — Canonical Entity Relationships (Aligned to Tier 1 Foundations)

> Living ERD-in-prose for MBapp. This document is **source-level** guidance for schemas, keys/GSIs, and cross-module navigation.
> It aligns to the Tier 1 roadmap and the spec (MBapp-Modules.yaml).

---

## 1. Identity Model (Tier 1 Core)

### 1.1 Canonical Identity
- **Party** is the single identity record.
  - `kind ∈ { person, organization, animal }`
  - Contact & profile fields live here (name, email, phones, addresses).
- **PartyRole** expresses how a party participates:
  - `customer, vendor, employee, registrant, participant, booker, guest, owner, rider, judge, event_staff, bidder, lessor, lessee, other`
  - A Party may hold **multiple roles** at once (e.g., an org can be both *customer* and *vendor*).
- **PartyLink** creates graph relationships between Parties:
  - `employs, owns, member_of, handles, affiliate, parent, subsidiary, manages, caretaker_of`

### 1.2 Identity Normalization Strategy
- **One Party per real-world entity.** Roles are additive; avoid separate identity objects.
- **Wrappers (optional only):** If `Customer/Vendor/Employee` convenience objects exist, they **must** include `partyId` (Party remains source of truth). Prefer role-filtered views over wrappers.

### 1.3 Natural Keys & Uniqueness
- Use **UNIQ#** items to enforce uniqueness for natural keys (email, registry numbers, external IDs).
- Deduping flows: creating a Party with conflicting natural key should propose linking to the existing Party.

---

## 2. Commercial Foundations

### 2.1 Orders & Counterparties
- **SalesOrder.customerId → Party.id** where Party has **PartyRole=customer**.
- **PurchaseOrder.vendorId → Party.id** where Party has **PartyRole=vendor**.
- Guardrails validate roles at write-time; pickers filter by role at read-time.

### 2.2 Products & Inventory
- **Product** defines what is sold/purchased; may reference default `itemId`.
- **InventoryItem** is the stock-keeping instance referenced by SO/PO lines.
- **InventoryCounters** aggregate `onHand, reserved, available` and mutate via Receipts (PO) and Fulfillments (SO).

### 2.3 Customer/Vendor Account Profiles (optional but recommended)
- **CustomerAccount** (per Party): terms, credit limit, price list, tax flags, default bill/ship-to.
- **VendorAccount** (per Party): terms, remit-to, 1099 flag, default expense/COGS accounts.
- Orders pull defaults from these profiles; orders store denormalized copies for audit.

---

## 3. Events, Registrations, Resources, Reservations

### 3.1 Events & Registrations
- **Event** 1→many **EventLine** (divisions/classes).
- **Registration** links a Party (and optionally an Animal Party) to an Event/EventLine.
- Registration fees and rules tie back to Products (for price) and to CustomerAccount (for terms/price list), when applicable.

### 3.2 Resources & Reservations
- **Resource** (arena, stall, room, equipment) can be booked via **Reservation**.
- Conflict logic considers `(resourceId, startsAt, endsAt)`; day/week calendar views query by time windows.

---

## 4. Employees, Assignments, Labor, Payroll (Tier 1 Core)

### 4.1 Employee Identity
- **Party(kind=person) + PartyRole=employee** denotes an employee.
- **EmployeeProfile** (1:1 with Party) stores employment type, scope (generic/event_only), pay type, std rate, GL defaults, default cost center.

### 4.2 Event Staffing
- **EventStaffAssignment** links an employee to an Event with role, shift, optional rate override, and `costCategory ∈ { direct_labor, overhead }`.
- Used to plan and attribute event labor; drives COGS/Opex classification.

### 4.3 Timesheets & Posting
- **LaborEntry** records worked time/cost. If `eventId` present (and/or `costCategory=direct_labor`), postings go to **COGS**; otherwise **Opex**.
- **PayrollBatch** groups approved LaborEntries for a period; posting occurs when batch status=posted.

---

## 5. Auctions (Buyer/Seller Roles & Tenant Participation)

- **Auction** 1→many **Lot**; Parties place **Bid**s (role `bidder`). Winning bids settle to **Settlement** (AR/AP entries).
- The hosting business (tenant) may also act as a **buyer** or **seller**:
  - Your organization is a Party (kind=organization) and may hold roles `bidder, customer, vendor`.
  - Related-party checks (see §7) may flag self or affiliated transactions.
- Settlement postings follow normal AR/AP rules; optional auto-offset for self AR/AP is supported (see TenantProfile settings).

---

## 6. Leasing (Facility, Stalls, Rooms, Equipment)

### 6.1 Lease Agreements
- **LeaseAgreement** relates a **lessorPartyId** and **lesseePartyId** over a list of **resourceIds** (arenas, stall blocks, rooms, equipment) with a **term** and **charges**:
  - Charges include code (BASE_RENT, UTILITIES, CLEANING), amount/currency, frequency (once, weekly, monthly, …), dueDay, optional taxCode and GL account, and optional escalation%/year.
  - Security deposit tracked with received date.

### 6.2 Billing
- **LeaseBillingRun** executes on a period, selects active leases, and generates Invoices or Bills according to role (lessor → AR/Revenue; lessee → AP/Expense or Prepaid/Accrual).

### 6.3 Role Encoding
- The same Party may hold roles `lessor` and/or `lessee` depending on the lease instance; identity is not duplicated.
- Facilities leased to third parties or to ourselves (intercompany) are both modeled here.

---

## 7. Tenant as Counterparty & Related-Party Handling

- **TenantProfile.primaryPartyId** identifies “us” (the operator) as a Party.
- **RelatedPartyRule** defines relationships to self/affiliates (self, subsidiary, parent, affiliate, owner, officer, director, key_employee, other) and flags/approval needs:
  - `alertOnTransact`, `requireApproval`, `autoOffsetARAP`.
- **Self/affiliated transactions** (auctions, leases, sales/purchases) can be flagged and optionally auto-offset via an intercompany clearing entry to prevent dangling AR/AP to ourselves.

---

## 8. Keys & Indexing Patterns (DynamoDB)

- **UNIQ#** items for natural keys (email, registry, externalId).
- **Listing by type:** `GSI1: tenantId#type` → list all of a given type.
- **Foreign-key lookups:** `GSI2: tenantId#fkName#fkValue` (e.g., by `partyId`, `eventId`, `resourceId`).
- **Time windows:** reservations & leases use time-range queries on `(resourceId, startsAt, endsAt)`; auctions use event windows.
- **Status queues:** prefix sort-keys by status (`draft/active/approved/posted/closed`) for operational dashboards.

---

## 9. UI/Navigation Conventions

- **Pickers** are role-filtered views of Parties (e.g., Customers=role:customer; Vendors=role:vendor; Employees=role:employee; Bidders=role:bidder; Lessors/Lessee as needed).
- **Chips/Badges** show active roles on Party rows (“Acme Co. — customer, vendor”). Inline action “+ add role” attaches a new PartyRole.
- **Event detail** includes a **Staff** tab (assignments) and **Bids/Lots** when auctions are active.
- **Leases** live under Facilities/Resources; billing runs show generated documents and posting results.
- **Timesheets/Payroll** flows: My Entries, Approvals, Batches.

---

## 10. Legacy/Wrappers (if present)

If `Client/Vendor/Employee` objects exist for convenience:
- They **must contain `partyId`** and treat Party as canonical for identity fields.
- They should be considered **views/profiles**, not separate identities.
- New modules should prefer **Party + PartyRole** directly.

---

## 11. Posting Rule Highlights (where relationships matter)

- **SO/PO finalizations**: mutate InventoryCounters and post revenue/COGS or expense.
- **Labor**: `eventId` → COGS:DirectLabor; otherwise Opex:Wages.
- **Auctions**: Settlement → AR/AP, fees; optional self AR/AP offset.
- **Leases**: Invoices (lessor) → Rental Revenue; Bills (lessee) → Rental Expense/Prepaid/Accrual based on timing.
