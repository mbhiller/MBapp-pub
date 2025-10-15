# MBapp-Relationships.md
_Stand-alone entity & relationship reference — Generated October 14, 2025 16:15_

This document defines **entities** and **relationships** across MBapp. It is schema-agnostic (works with OpenAPI or code-first) and multi-tenant by design.

---

## 1. Principles
1. **Party-first**: Every human, animal, or organization is a _Party_. Roles (customer, vendor, employee, etc.) are applied to Parties.
2. **Composable roles**: A Party can hold multiple roles simultaneously (e.g., an Organization can be both a Vendor and a Client).
3. **Traceable transactions**: Operational documents (Orders, Registrations, Reservations, Lots/Bids) link forward to **Billing** and **Accounting** artifacts.
4. **Immutable ledger**: Inventory movements and journal postings are append-only; derived balances are computed.
5. **Tenant isolation**: All entities store `tenantId`, `createdAt`, `updatedAt`; no cross-tenant joins.
6. **Metadata is first-class**: `metadata` stores optional, typed ext fields for analytics or soft links.

---

## 2. Core Party Model

### 2.1 Entities
| Entity | Purpose | Required Keys | Notes |
|---|---|---|---|
| **Party** | Root identity record. | `id`, `type`, `tenantId`, `createdAt` | `type` ∈ `person | animal | organization`. |
| **Person** | Human participant. | `partyId`, `name` | Staff, riders, buyers, consignors, volunteers. |
| **Animal** | Animal (horse etc.). | `partyId`, `name` | Breed, registry no., DOB, health & performance. |
| **Organization** | Business/association. | `partyId`, `name` | May own resources, host events, employ staff. |
| **PartyRole** | Role assignment(s). | `partyId`, `role` | `role` ∈ `client, vendor, employee, organizer, consignor, bidder, judge, trainer, owner, breeder` etc. |
| **PartyLink** | Soft link between Parties. | `fromPartyId`, `toPartyId`, `kind` | Ownership, guardianship, membership, sponsorship. |

### 2.2 Typical Role Patterns
- **Client** (Person or Org): places Sales Orders, makes Reservations, registers for Events.
- **Vendor** (Org or Person): provides goods/services on Purchase Orders; receives Bills.
- **Employee** (Person): submits Expenses; performs operational actions.
- **Owner** (Party) ↔ **Animal** (Party): ownership recorded via PartyLink(kind=`owns`).

---

## 3. Events & Participation

### 3.1 Entities
| Entity | Purpose | Key Relationships |
|---|---|---|
| **Event** | Show/clinic/competition. | `organizerId`→Organization; 0..N **EventLines** (classes/divisions). |
| **EventLine** | Class/Division entry. | Linked by `eventId`; optional `capacity`, `fee`. |
| **Registration** | A Party (and optional Animal) enters an EventLine. | `eventId`, `clientId`, optional `animalId`, `qty`, `status`. |
| **Scorecard** | Templated scoring sheet. | `eventId`, `classId`; stores judge entries. |

### 3.2 Rules & Notes
- Capacity and duplicate checks on `Registration`.
- Event status gates: `draft → scheduled → open → closed → completed|cancelled`.
- Later, results publish to **Displays** and **Analytics**.

---

## 4. Resources & Reservations

### 4.1 Entities
| Entity | Purpose | Key Relationships |
|---|---|---|
| **Resource** | Stall, RV pad, arena, equipment, etc. | `resourceType` (stall|rv|arena|equipment|other). |
| **Reservation** | Time-bound booking of a Resource. | `resourceId`, `clientId`, optional `eventId`; status lifecycle. |

### 4.2 Constraints
- Conflict detection based on `(resourceId, timeRange)`.
- Optional linkage to Event (e.g., show stall during event window).
- Pricing via `rate/price` fields or derived from Packages.

---

## 5. Auctions

### 5.1 Entities
| Entity | Purpose | Key Relationships |
|---|---|---|
| **Auction** | Live/online auction container. | `organizerId` (Organization). |
| **Lot** | Catalog entry on auction. | May reference `animalId` or `productId`; has reserve, order. |
| **Bid** | Bid placed by a Party. | `partyId` (bidder), `lotId`, amount, timestamps. |
| **Settlement** | Final sale details. | Produces **SalesOrder/Invoice** and **JournalEntries**. |

### 5.2 Notes
- Supports bidder verification (KYC-lite), deposits, and fees.
- Streaming and **DisplayFeed** integration for bidder board and live status.

---

## 6. Products, Inventory & Orders

### 6.1 Entities
| Entity | Purpose | Key Relationships |
|---|---|---|
| **Product** | Catalog item (good or service). | References `defaultItemId` (InventoryItem). |
| **InventoryItem** | Stock unit. | Optional `productId`; tracked in `movements`. |
| **InventoryMovement** | Delta for on-hand quantities. | Source: `PO receive`, `SO fulfill`, `adjust`. |
| **SalesOrder (SO)** | Customer order & lines. | `customerId`→Party; lines reference `itemId`. |
| **PurchaseOrder (PO)** | Vendor order & lines. | `vendorId`→Party; lines reference `itemId`. |
| **GoodsReceipt** | Receiving against PO. | Produces `InventoryMovement` (+ ledger). |
| **SalesFulfillment** | Fulfilling SO. | Produces `InventoryMovement` (+ ledger). |

### 6.2 Line Editing
- Shared `_key / CID` approach with `normalize → toPatchLines → re-normalize`.
- Id-less create semantics in update endpoints; delete by omission or explicit remove.

---

## 7. Finance & Billing

### 7.1 Entities
| Entity | Purpose | Key Relationships |
|---|---|---|
| **Account** | Ledger account. | `accountType`: asset, liability, revenue, expense, equity. |
| **JournalEntry** | Double-entry posting. | Originates from operational docs (orders, receipts, fulfillments, settlements, invoices). |
| **Invoice / Bill / Payment / Refund** | AR/AP docs. | Linked to SO/PO; reconciles in ledger. |
| **ExpenseReport / Reimbursement** | Employee expenses. | Linked to Employee (Party). |
| **RevenueShareRule/Entry** | Third-party payouts. | Tied to Account & Party; from auction/consignment. |

### 7.2 Posting Triggers
- SO fulfillment, PO receipt, Auction settlement, Registration/Reservation charges.
- Billing documents post summaries; adjustments post through JournalEntry.

---

## 8. Messaging & Boards

### 8.1 Entities
| Entity | Purpose | Key Relationships |
|---|---|---|
| **Message** | Push/SMS/Email unit. | Optional `segment` or direct Party list. |
| **Campaign** | Group of messages. | Sends `Message` to audience. |
| **DisplayFeed** | Live feeds for boards. | Pulls from Event/Registration/Scorecard/Auction. |

---

## 9. Cross-Entity Relationship Table

| From | To | Cardinality | Join Key(s) | Notes |
|---|---|---|---|---|
| Party | PartyRole | 1:N | `partyId` | A party may have many roles. |
| Party | PartyLink | 1:N | `fromPartyId` | Ownership, guardianship, membership. |
| Organization | Resource | 1:N | `ownerId` | Optional explicit field or via PartyLink. |
| Organization | Event | 1:N | `organizerId` | Host relationship. |
| Event | EventLine | 1:N | `eventId` | Classes/divisions. |
| Event | Registration | 1:N | `eventId` | Entry records. |
| Registration | Party (Client) | N:1 | `clientId` | Who registered. |
| Registration | Party (Animal) | 0:1 | `animalId` | Optional. |
| Resource | Reservation | 1:N | `resourceId` | Bookings. |
| Reservation | Party (Client) | N:1 | `clientId` | Booker. |
| Reservation | Event | 0:1 | `eventId` | Optional tie to event. |
| Product | InventoryItem | 1:N | `productId` | SKU/stock linkage. |
| SalesOrder | Party (Client) | N:1 | `customerId` | Buyer. |
| PurchaseOrder | Party (Vendor) | N:1 | `vendorId` | Supplier. |
| GoodsReceipt | PurchaseOrder | N:1 | `poId` | Receiving. |
| SalesFulfillment | SalesOrder | N:1 | `soId` | Fulfillment. |
| Invoice | SalesOrder | 1:1 | `soId` | AR. |
| Bill | PurchaseOrder | 1:1 | `poId` | AP. |
| JournalEntry | Source Doc | N:1 | `sourceId`, `sourceType` | Posting provenance. |
| Auction | Lot | 1:N | `auctionId` | Catalog. |
| Lot | Animal or Product | 0:1 | `animalId` or `productId` | Auctioned item. |
| Bid | Lot | N:1 | `lotId` | Bidding. |
| Settlement | Invoice | 1:1 | `invoiceId` | Sale finalization. |

---

## 10. ASCII Relationship Diagram

```
                   ┌───────────────┐
                   │  Organization │
                   └─────┬─────────┘
                         │ hosts / owns
        employs          │                 owns
   ┌────────────┐   ┌────▼────┐       ┌────▼───────┐
   │  Employee  │   │  Event  │       │  Resource  │
   └────┬───────┘   └────┬────┘       └────┬───────┘
        │               has classes        │
        │           ┌────▼───────┐   ┌────▼───────────┐
        │           │ EventLine  │   │  Reservation   │◄── booked by ──┐
        │           └────┬───────┘   └───────────────┘                  │
        │                │                 ▲                              │
        │        registers                  │optional                     │
   ┌────▼────┐   ┌───────▼────────┐        │                              │
   │ Person  │──►│  Registration  │◄───────┘                              │
   └───┬─────┘   └────────────────┘                                       │
       │roles                                                              │
   ┌───▼──────┐      consigns / bids      ┌──────────────┐        places  │
   │  Client  │◄──────────────────────────│   Auction    │──────────────┐ │
   └───┬──────┘                           └──────┬───────┘              │ │
       │ buys                                 has │ lots                │ │
   ┌───▼──────────┐                    ┌─────────▼───────┐   ┌─────────▼───────┐
   │ SalesOrder   │   fulfill/receive  │      Lot       │   │      Bid        │
   └───┬──────────┘◄──────────────────►│  (Animal/Prod) │   └──────────────────┘
       │ invoice/JE                    └────────┬───────┘
   ┌───▼──────────┐   postings                 │ settlement
   │   Invoice    │◄───────────────────────────┘
   └───┬──────────┘
       │ posts
   ┌───▼──────────┐
   │ JournalEntry │──► Accounts
   └──────────────┘
```

---

## 11. Field Conventions
- `id`: ULID/UUID string; no cross-tenant reuse.
- `tenantId`: required on all records.
- `status`: constrained state machine per module.
- `metadata`: free-form JSON; prefer small, analytics-friendly shapes.
- Timestamps: `createdAt`, `updatedAt`, plus domain-specific (`startsAt`, `endsAt`, `ts`).

---

## 12. Integration Notes
- Upstream connectors (CRM, Commerce, Accounting) map to **Party** and **Order/Invoice**.
- Webhooks should include `{ tenantId, sourceType, sourceId, version }` for replay safety.
- Use idempotency keys on mutating endpoints that mirror external events.

---

## 13. Evolution
- Roles are extensible via `PartyRole.role` enums.
- New relationships should prefer **PartyLink** with `kind` taxonomy before adding hard foreign keys.
- Keep inventory & ledger append-only; compute balances via views.

---

**End of MBapp-Relationships.md**
