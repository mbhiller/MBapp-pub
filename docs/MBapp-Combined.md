# MBapp — Updated Docs (Aligned)

> Drop-in replacements for the four project docs, aligned to our current implementation and the new **Events + Reservations** requirements.

---

## File: MBapp-Master.md

# MBapp — Master Systems Doc (nonprod)

_Last updated: 2025-09-11 19:30 UTC._

We are intentionally running **lean** during this sprint: Hub shows the core 3 modules (**Products**, **Objects**, **Tenants**) and **Scan** is available everywhere. Role/module gating is reintroduced in a light form via `RolesProvider` (client) and per-module required roles (registry).

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
- **Mobile env:** `EXPO_PUBLIC_ENV=nonprod` • `EXPO_PUBLIC_API_BASE=https://ki8kgivz1f.execute-api.us-east-1.amazonaws.com` • `EXPO_PUBLIC_TENANT_ID=DemoTenant`
- **Toolchain (recommended)**
  - **React:** `19.1.x` (web + mobile) — **ensure React matches renderer**
  - **TypeScript:** `5.5.x` (hoisted at workspace root)
  - **@types/react:** `^19.1` (hoisted; avoid root `overrides` that conflict)

---

## Scope for this sprint slice (catalog-first, scan-first)
- **Hub** (lean): Products, Objects, Tenants; plus header **Scan** button on all primary screens.
- **Catalog / Products**: list + detail; create (mode `new`) and update (by `id`).
- **Objects**: list + detail; “Scan to Attach EPC” button from detail opens Scan with `attachTo`.
- **Scan**: single screen, launched from headers or with `attachTo` from Object Detail; default intent `navigate`.
- **Tenants**: visible from headers and Hub (placeholder list).
- **Events (new requirement)**: add **Registrations & Reservations** slice — see below.

---

## Monorepo layout (relevant parts)
```
apps/
  api/
    src/
      index.ts               # Route switch — HANDLER: dist/index.handler
      objects/               # Canonical object handlers (get, create, update, list, search)
      products/              # Thin alias to objects/product (optional)
      events/                # events + reservations (new)
      common/
        ddb.ts, responses.ts, env.ts
    ops/
      Publish-ObjectsLambda-EsbuildOnly.ps1
      Setup-ProductsRoutes.ps1
  mobile/
    App.tsx                  # RolesProvider + NavigationContainer + RootStack
    src/
      navigation/
        RootStack.tsx
        types.ts
      screens/
        ModuleHubScreen.tsx
        ProductsListScreen.tsx
        ProductDetailScreen.tsx
        ObjectsListScreen.tsx
        ObjectDetailScreen.tsx
        TenantsScreen.tsx
        ScanScreen.tsx
      features/
        products/api.ts      # /products client (GET/POST/PUT/list) with tolerant normalizer
        tenants/...
        events/api.ts        # (placeholder)
      providers/RolesProvider.tsx
```

---

## Backend (Objects API + Products alias)

### Environment
- **Lambda:** `mbapp-nonprod-objects` (Node 20, CommonJS)
- **DynamoDB:** table `mbapp_objects`
- **Indexes:**
  - **GSI1 (existing)**: `gsi1pk = tenant|type`, `gsi1sk = updatedAt` (string)
  - **GSI2 (optional)**: `gsi2pk = tenant|type`, `gsi2sk = name_lc` (for name-sorted lists)

### Headers
- Multi-tenant header required on all API calls: `x-tenant-id: DemoTenant`

### Canonical Object routes
- **Create:** `POST /objects/{type}`
- **Read:** `GET /objects/{type}/{id}` and legacy `GET /objects/{id}`
- **Update:** `PUT /objects/{type}/{id}`
- **List:** `GET /objects/{type}` (supports `limit`, `cursor`, `sort`, `order`)
- **Search:** `GET /objects/search` (supports `type`, `sku`, `q`)

### Products alias routes (public client surface)
- `POST /products` → `POST /objects/product` (accepts flat or `{ core: {...} }`)
- `PUT /products/{id}` → `PUT /objects/product/{id}`
- `GET /products/{id}` → `GET /objects/product/{id}`
- `GET /products?sku=&q=&limit=&cursor=` → list/search

### Product canonical fields (persisted **top-level**)
```
{ id, tenant, type: "product",
  name, name_lc,
  sku, price,
  uom?, taxCode?,
  kind?: "good"|"service",
  createdAt, updatedAt }
```
- **SKU uniqueness per tenant** enforced via a token item: `pk=UNIQ#<tenant>#product#SKU#<sku_lc>, sk=UNIQ` (TransactWrite on create and on SKU change).

---

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

---

## Ops — build, publish, and route wiring

### Publish Lambda (esbuild only)
`apps/api/ops/Publish-ObjectsLambda-EsbuildOnly.ps1`

### Wire `/products` routes
`apps/api/ops/Setup-ProductsRoutes.ps1`

---

## Mobile test plan
1) **Products**: create → detail → update → list reflects fields.
2) **Scan**: object deep-link (`mbapp/object-v1`) → Object Detail.
3) **Events** (later): list events; create a reservation; verify availability blocks double-book.

---

## Change log
- **2025-09-11:** Persist `sku/price` at top-level; add `uom`, `taxCode`, `kind` fields; SKU uniqueness; optional name GSI; Events & Reservations slice added.


---

## File: Purchasing-Inventory-API.md

# Purchasing & Inventory — Entities & APIs (Aligned)

_Last updated: 2025-09-11 19:30 UTC._

## Catalog (Products)
**Product**
```
{ id, sku, name, kind: "good"|"service", uom, price, taxCode?,
  tenant, createdAt, updatedAt }
```
- Persist fields **top-level** (no client normalizers required).
- **Uniq SKU per tenant** via token item (TransactWrite).

**API**
- `GET /products?sku=&q=&limit=&cursor=` — list & search (exact `sku`, contains `q` on `name_lc`).
- `GET /products/{id}` — read.
- `POST /products` — create (accepts flat or `{ core:{...} }`).
- `PUT /products/{id}` — update.

**Indexes**
- `gsi1` (updated): `gsi1pk = tenant|product`, `gsi1sk = updatedAt` (string)
- `gsi2` (optional): `gsi2pk = tenant|product`, `gsi2sk = name_lc` (name sort)

---

## Inventory
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

---

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

---

## Events & Reservations (integration points)
- **Events booth merch** pulls `Products` (kind:`good`) for POS; reservations may reserve **rooms/stalls** as **Locations** for the event.
- **Reservations** can **reserve Inventory capacity** (optional) or just book a **Resource** independent of stock (e.g., stall). Use `refType/refId` on Movement for traceability when stock is involved.


---

## File: Cross-Module-Design-Vision.md

# Cross-Module Design Vision — Sales, Inventory, Purchasing, Ticketing, Badging, Events

_Last updated: 2025-09-11 19:30 UTC._

## Principles
1) **Single source of truth per domain** (Products, Inventory, Purchasing, Sales, Events, Accounts).
2) **Modules share capabilities** via clear APIs and **domain events** (no hidden coupling).
3) **Scan-first UX** on mobile; every barcode/QR path is an **intent** (see Scan Intents).
4) **Multi-tenant + RBAC** everywhere; per-action permissions possible (`perms[]`).
5) **Nonprod first**: ship thin vertical slices behind feature flags and grow.

---

## Domains & responsibilities
### Catalog (Products & Services)
- **Entity:** `Product` = { id, sku, name, kind:"good"|"service", uom, price, taxCode?, tags{} }
- **API:** `GET/POST/PUT /products`, `GET /products?sku=`, `GET /priceLists` (later)

### Inventory
- **Entities:** `Location`, `StockItem`, `Movement`
- **API:** `/inventory/locations`, `/inventory/stock`, `/inventory/movements`
- **Events:** `inventory.received`, `inventory.moved`, `inventory.reserved`, `inventory.released`

### Purchasing
- **Entities:** `Vendor`, `PurchaseOrder`, `POLine`, `Receipt`
- **API:** `/purchasing/vendors`, `/purchasing/po`, `/purchasing/po/{id}/receive`
- **Events:** `po.created`, `po.received` → emits `inventory.received`

### Sales (shared by many modules)
- **Entities:** `Order`, `Invoice`, `Payment`
- **API:** `/sales/orders`, `/sales/invoices`, `/sales/payments`
- **Cross-module:** events sell **tickets/merch**; services/boarding create billable lines.

### Events & Reservations (new)
- **Purpose:** manage events and allow **registrations** + **resource reservations** (rooms, RV, parking, stalls, other objects).
- **Entities:** `Event`, `ResourceType`, `Resource`, `Reservation`, `Registration`
- **API:** `/events`, `/events/{id}/registrations`, `/resources`, `/reservations`, `/availability`
- **Events:** `event.created`, `registration.created`, `reservation.held|confirmed|canceled`
- **Scanning:** `ticket-validate`, `reserve-resource`, `check-in`, `assign-stall`

### Badging
- **Entities:** `Badge`, `TimeEntry`
- **API:** `/badges`, `/badges/scan`, `/time/clock`

---

## Shared scans = shared intents
- **One Scan screen** handles intents (see Scan Intents Catalog).

## Associations (objects ↔ objects)
- Use embedded `links[]` first; promote to dedicated table only if needed.

---

## Environments & flags
- `EXPO_PUBLIC_ENV=nonprod|prod`
- Feature flags: `features.catalog`, `features.inventory`, `features.purchasing`, `features.sales`, `features.ticketing`, `features.badging`, `features.events`, `features.reservations`


---

## File: Scan-Intents-Catalog.md

# Scan Intents Catalog (v1.1)

_Last updated: 2025-09-11 19:30 UTC._

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

## UI affordances
- Top pill shows current context (e.g., “Reserving Stall for Event X”)
- Multi-scan toggle for bulk actions
- Haptics + toasts on success/failure
- `navigation.replace(...)` when flow completes

