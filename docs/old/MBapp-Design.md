# MBapp — Combined Design (Updated 2025‑09‑16)

> **Goal:** Keep the app minimal, fast, and easy to extend. This update reflects the **actual code** in `apps/api`, `apps/mobile`, and `apps/web` you shared, and resolves small drift between the doc and the current implementation.

---
## 0) Design Vision
### Principles
1) **Single source of truth per domain** (Products, Inventory, Purchasing, Sales, Events, Accounts).
2) **Modules share capabilities** via clear APIs and **domain events** (no hidden coupling).
3) **Scan-first UX** on mobile; every barcode/QR path is an **intent** (see Scan Intents).
4) **Multi-tenant + RBAC** everywhere; per-action permissions possible (`perms[]`).
5) **Nonprod first**: ship thin vertical slices behind feature flags and grow.


### Domains & responsibilities
#### Catalog (Products & Services)
- **Entity:** `Product` = { id, sku, name, kind:"good"|"service", uom, price, taxCode?, tags{} }
- **API:** `GET/POST/PUT /products`, `GET /products?sku=`, `GET /priceLists` (later)

#### Inventory
- **Entities:** `Location`, `StockItem`, `Movement`
- **API:** `/inventory/locations`, `/inventory/stock`, `/inventory/movements`
- **Events:** `inventory.received`, `inventory.moved`, `inventory.reserved`, `inventory.released`

#### Purchasing
- **Entities:** `Vendor`, `PurchaseOrder`, `POLine`, `Receipt`
- **API:** `/purchasing/vendors`, `/purchasing/po`, `/purchasing/po/{id}/receive`
- **Events:** `po.created`, `po.received` → emits `inventory.received`

#### Sales (shared by many modules)
- **Entities:** `Order`, `Invoice`, `Payment`
- **API:** `/sales/orders`, `/sales/invoices`, `/sales/payments`
- **Cross-module:** events sell **tickets/merch**; services/boarding create billable lines.

#### Events & Reservations (new)
- **Purpose:** manage events and allow **registrations** + **resource reservations** (rooms, RV, parking, stalls, other objects).
- **Entities:** `Event`, `ResourceType`, `Resource`, `Reservation`, `Registration`
- **API:** `/events`, `/events/{id}/registrations`, `/resources`, `/reservations`, `/availability`
- **Events:** `event.created`, `registration.created`, `reservation.held|confirmed|canceled`
- **Scanning:** `ticket-validate`, `reserve-resource`, `check-in`, `assign-stall`

#### Badging
- **Entities:** `Badge`, `TimeEntry`
- **API:** `/badges`, `/badges/scan`, `/time/clock`

### Shared scans = shared intents
- **One Scan screen** handles intents (see Scan Intents Catalog).

### Associations (objects ↔ objects)
- Use embedded `links[]` first; promote to dedicated table only if needed.

### Environments & flags
- `EXPO_PUBLIC_ENV=nonprod|prod`
- Feature flags: `features.catalog`, `features.inventory`, `features.purchasing`, `features.sales`, `features.ticketing`, `features.badging`, `features.events`, `features.reservations`


## Events & Reservations (new slice)

**Goal:** users can **register** for scheduled events and **reserve** resources (Rooms, RV spaces, Parking, Stalls, or other Objects).
  ### Entities
  - **Event** `{ id, name, startsAt, endsAt, venueId?, status, createdAt, updatedAt }`
  - **ResourceType** `{ id, name, kind: "room"|"stall"|"rv"|"parking"|"other" }`
  - **Resource** `{ id, typeId, name, venueId?, tags{} }`
  - **Reservation** `{ id, eventId, resourceId, accountId, status: "held"|"confirmed"|"canceled", from, to, qty?, notes? }`
  - **Registration** `{ id, eventId, accountId, status: "pending"|"confirmed"|"canceled", createdAt }`

  ### APIs
  - `/events` `GET/POST/PUT`
  - `/events/{id}/registrations` `GET/POST/PUT`
  - `/resources` `GET/POST/PUT` (filter by typeId/kind)
  - `/reservations` `GET/POST/PUT` (supports `eventId`, `resourceId`, `accountId`)
  - `/availability` `GET` (check resource availability by range; returns time windows)

  ### Keys
  - Keep a **per-domain** PK/SK pattern to avoid cross-domain coupling. For example:
    - **Events:** `PK=TENANT#<t>#EVENT#<id>`, `SK=METADATA`
    - **Resources:** `PK=TENANT#<t>#RESOURCE#<id>`, `SK=METADATA`
    - **Reservations:** `PK=TENANT#<t>#RESV#<eventId>`, `SK=<resourceId>#<from>` (time-sorted)
    - **Registrations:** `PK=TENANT#<t>#REG#<eventId>`, `SK=<accountId>`

  ### Reservation constraints
  - **Atomicity:** use **TransactWrite** to assert availability when confirming reservations.
  - **Idempotency:** accept `Idempotency-Key` header for create to prevent double-booking on retries.
  - **Events:** emit `reservation.held`, `reservation.confirmed`, `reservation.canceled`.
  
## Purchasing & Inventory — Entities & APIs
  ## Inventory
  **Inventory:** not a first‑class alias yet. The server happily serves `type=inventory` through the generic objects routes; the mobile app already uses that. If/when inventory movements/locations are added, we can introduce `/inventory/*` facades without breaking clients.
  
  **Location**
  ```
  { id, name, kind: "warehouse"|"booth"|"truck"|"room"|"stall"|"rv"|"parking", tenant }
  ```
  **StockItem** (per location)
  ```
  { productId, locationId, onHand, reserved, lot?, tenant }
  ```
  **Movement**
  ```
  { id, productId, from?, to?, qty, reason, refType?, refId?, at, tenant }
  ```

  **API**
  - `GET/POST/PUT /inventory/locations`
  - `GET/POST/PUT /inventory/stock`
  - `GET/POST /inventory/movements`

  **Events**
  - `inventory.received`, `inventory.moved`, `inventory.reserved`, `inventory.released`

## Purchasing
  **Vendor** `{ id, name, contact?, tenant }`
  **PO**
  ```
    { id, status: "draft"|"sent"|"received"|"closed", vendorId, lines: [ { productId, qty, cost, lot? } ], totals, tenant }
  ```
  **Receipt** `{ id, poId, lines[], at, by, tenant }`

  **API**
  - `GET/POST/PUT /purchasing/vendors`
  - `GET/POST/PUT /purchasing/po`
  - `POST /purchasing/po/{id}/receive`

  **Receive semantics**
  - Atomically **upsert StockItem** and **append Movement** via TransactWrite.
  - Emit `po.received` + `inventory.received`.

## Scanning
  ## Future intents in the doc (e.g., `reserve-resource`, `assign-stall`, `check-in`) are still planned; UI stubs can be added after Events/Registrations stabilize.
  - `t = "mbapp/object-v1"`  
  - Required fields: `type`, `id`  
  - On scan (`intent: "navigate"`): app routes to the appropriate detail screen.  
  - On scan (`intent: "attach-epc"` + `attachTo`): placeholder alert in this sprint (no write).
  ## Common payloads
  - **MBapp Object QR (JSON)**
    `{ "t":"mbapp/object-v1", "id":"...", "type":"...", "href":"/objects/<type>/<id>" }`
  - **Ticket QR** `{ "t":"mbapp/ticket-v1", "id":"t_<...>", "eventId":"e_<...>" }`
  - **Badge QR** `{ "t":"mbapp/badge-v1", "id":"b_<...>", "employeeId":"emp_<...>" }`
  - **PO QR** `{ "t":"mbapp/po-v1", "id":"po_<...>" }`
  - **Reservation QR (new)** `{ "t":"mbapp/resv-v1", "id":"r_<...>", "eventId":"e_<...>", "resourceId":"res_<...>" }`
  - **Resource QR (new)** `{ "t":"mbapp/resource-v1", "id":"res_<...>", "kind":"stall|room|rv|parking|other" }`
  - **SKU/UPC** plain barcode text; map to `Product` via `/products?upc=` (later)

  ## Intents
  - `navigate` → open Object Detail for `{id,type}`
  - `attach-epc` (requires `attachTo`) → set `tags.rfidEpc` on the target
  - `link` (requires `attachTo`) → link source object to scanned object
  - `add-to-order` (optional `orderId`) → add scanned SKU to an order
  - `receive-po` (requires `poId` or PO QR) → receive items; tally progress
  - `inventory-move` (`fromId`,`toId`) → create stock movement
  - `ticket-validate` → validate ticket; show green/red result
  - `badge-clock` → clock in/out based on last state
  - `add-to-service` (`serviceOrderId?`) → add line to a work order
  - **`reserve-resource` (new)** → select resource/time, hold or confirm reservation
  - **`assign-stall` (new)** → link a stall resource to an object (e.g., horse) for an event
  - **`check-in` (new)** → confirm arrival against a reservation or registration

---

## Quick callouts
- **Repo:** `github.com/mbhiller/MBapp-pub`
- **Main branch:** `main` (always releasable)
- **Current sprint branch:** `feature/sprint-2025-09-11`
- **API Base:** `https://ki8kgivz1f.execute-api.us-east-1.amazonaws.com`
- **Tenant ID:** `DemoTenant`
- **AWS (nonprod):** API ID `ki8kgivz1f` • Lambda `mbapp-nonprod-objects` • DynamoDB `mbapp_objects` • GSI `byId`
- **HTTP API Integration ID (mbapp-nonprod-objects):** `tdnoorp`
- **Lambda handler path:** `dist/index.handler` (Node 20, CommonJS)
- **Dynamo Table**: `mbapp_objects` with `gsi1` (updatedAt) and optional `gsi2` (name_lc)
- **Mobile env:** `EXPO_PUBLIC_ENV=nonprod` • `EXPO_PUBLIC_API_BASE=https://ki8kgivz1f.execute-api.us-east-1.amazonaws.com` • `EXPO_PUBLIC_TENANT_ID=DemoTenant`
- **Toolchain (recommended)**
- **React:** `19.1.x` (web + mobile) — **ensure React matches renderer**
- **TypeScript:** `5.5.x` (hoisted at workspace root)
- **@types/react:** `^19.1` (hoisted; avoid root `overrides` that conflict)
- **Indexes:**
- **GSI1 (existing)**: `gsi1pk = tenant|type`, `gsi1sk = updatedAt` (string)
- **GSI2 (optional)**: `gsi2pk = tenant|type`, `gsi2sk = name_lc` (for name-sorted lists)- **Primary key:** `pk = id`, `sk = "{{tenant}}|{{type}}"`  
- **GSI1:** `gsi1pk = "{{tenant}}|{{type}}"`, `gsi1sk = "createdAt#ISO#id#<id>"` (supports newest‑first).  
- **SKU uniqueness (products):** token item under `pk="UNIQ#{{tenant}}#product#SKU#{{skuLc}}"` ensures per‑tenant uniqueness.  

