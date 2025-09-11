# Cross-Module Design Vision — Sales, Inventory, Purchasing, Ticketing, Badging
_Last updated: 2025-09-10 14:23 UTC_


## Principles
1) **Single source of truth per domain** (Products, Inventory, Purchasing, Sales, Events, Accounts).  
2) **Modules share capabilities** via clear APIs and **domain events** (no hidden coupling).  
3) **Scan-first UX** on mobile; every barcode/QR path is an **intent** (see Scan Intents).  
4) **Multi-tenant + RBAC** everywhere; per-action permissions possible (`perms[]`).  
5) **Nonprod first**: ship thin vertical slices behind feature flags and grow.

---

## Domains & responsibilities
### Catalog (Products & Services)
- **Purpose:** central list of sellable items (SKUs) and service codes used by **Sales**, **Inventory**, **Events** (merch), and **Services** (billable tasks).
- **Entity:** `Product` = { id, sku, name, type: "good"|"service", uom, price, taxCode?, tags{} }
- **API:** `GET/POST/PUT /products`, `GET /products?sku=`, `GET /priceLists` (later)

### Inventory
- **Purpose:** track **stock** of goods by **Location** (warehouse, trailer, event booth).  
- **Entities:**  
  - `Location` = { id, name, kind: "warehouse"|"booth"|"truck"|"room" }  
  - `StockItem` (denormalized per location) = { productId, locationId, onHand, reserved, lot? }  
  - `Movement` = { id, productId, from?, to?, qty, reason, refType?, refId?, at }  
- **API:** `/inventory/locations`, `/inventory/stock`, `/inventory/movements`
- **Events:** `inventory.received`, `inventory.moved`, `inventory.reserved`, `inventory.released`

### Purchasing
- **Purpose:** internal users **buy** stock to sell or consume.  
- **Entities:**  
  - `Vendor` = { id, name, contact }  
  - `PurchaseOrder` = { id, status: "draft"|"sent"|"received"|"closed", vendorId, lines[], totals }  
  - `POLine` = { productId, qty, cost, lot? }  
  - `Receipt` = { id, poId, lines[], at, by }  
- **API:** `/purchasing/vendors`, `/purchasing/po`, `/purchasing/po/{id}/receive`
- **Events:** `po.created`, `po.received` → emits `inventory.received`

### Sales (shared by many modules)
- **Purpose:** convert demand into **orders/invoices/payments** across channels (event POS, services, boarding).  
- **Entities:**  
  - `Order` = { id, channel: "event"|"service"|"boarding"|"pos", customerId?, lines[], status }  
  - `Invoice` = { id, orderId?, lines[], total, status: "draft"|"sent"|"paid" }  
  - `Payment` = { id, invoiceId, amount, method, status }  
- **API:** `/sales/orders`, `/sales/invoices`, `/sales/payments`
- **Events:** `order.created`, `invoice.issued`, `invoice.paid`, `refund.issued`
- **Cross-module:**  
  - **Events** sell **tickets/merch** → creates `Order` and **reserves** inventory.  
  - **Services** generate billable lines → post to `Order/Invoice`.  
  ̶-̶ ̶*̶B̶o̶a̶r̶d̶i̶n̶g̶/̶T̶r̶a̶i̶n̶i̶n̶g̶*̶ ̶c̶r̶e̶a̶t̶e̶s̶ ̶r̶e̶c̶u̶r̶r̶i̶n̶g̶ ̶o̶r̶ ̶a̶d̶-̶h̶o̶c̶ ̶c̶h̶a̶r̶g̶e̶s̶.̶
  - **Boarding/Training** creates recurring or ad‑hoc charges.

### Events & Ticketing
- **Purpose:** manage events; sell and validate **tickets/passes**.  
- **Entities:** `Event`, `TicketType`, `Ticket` = { id, eventId, holderId?, barcode, status }  
- **API:** `/events`, `/events/{id}/tickets`, `/tickets/{id}/validate`
- **Events:** `ticket.issued`, `ticket.scanned`, `ticket.revoked`

### Badging (Employees/Staff IDs)
- **Purpose:** issue and scan **staff badges** (QR/NFC) for **access and time**.  
- **Entities:** `Badge` = { id, employeeId, code, status }, `TimeEntry` = { id, employeeId, inAt, outAt? }  
- **API:** `/badges`, `/badges/scan`, `/time/clock`
- **Events:** `badge.issued`, `badge.scanned`, `time.clockedIn`, `time.clockedOut`

### External modules
- **Eventing** (for eventers): schedules, entries/reservations, services, streams, concierge chat.  
- **Boarding/Training** (for long‑term clients): horses under care, services, invoices, documents, messaging.

### Admin & Accounts
- **Admin:** roles, modules, metadata (allowed values), feature flags.  
- **Accounts:** user profile, documents (incl. Drive links), reservations.

---

## Shared scans = shared intents
- **One Scan screen** handles intents (see `Scan-Intents-Catalog.md`).  
- Examples: `add-to-order`, `receive-po`, `ticket-validate`, `badge-clock`, `inventory-move`.

---

## Associations (objects ↔ objects)
- Start with **embedded `links[]`** on objects; promote to dedicated table only if needed.  
- UI: “Linked Items” on Object Detail; Add/Remove link actions.

---

## Google Drive linking (optional)
- OAuth file picker; store refs on objects: `{ provider:"gdrive", fileId, url, title, mimeType }`.

---

## AI layers (optional)
- **Help Desk:** internal troubleshooting guide (RAG over our docs + telemetry).  
- **Concierge:** event‑mode assistant for eventers (venue/schedule context).

---

## Environments & flags
- `EXPO_PUBLIC_ENV=nonprod|prod`
- `features.catalog`, `features.inventory`, `features.purchasing`, `features.sales`, `features.ticketing`, `features.badging`, `features.associations`, `features.driveLinks`, `features.aiHelpDesk`, `features.aiConcierge`
