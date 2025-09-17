# MBapp — Combined Design (Updated 2025‑09‑16)

> **Goal:** Keep the app minimal, fast, and easy to extend. This update reflects the **actual code** in `apps/api`, `apps/mobile`, and `apps/web` you shared, and resolves small drift between the doc and the current implementation.

---

## 1) Current Scope (as implemented)

**Back end (apps/api)**  
- Router consolidates **/objects** with clean aliases for **/products, /events, /registrations** (and supports legacy search-by-query).  
- **Tenancy:** All requests expect `x-tenant-id`. Fallbacks exist to env defaults for nonprod.  
- **Products** enforce **SKU uniqueness per tenant** via a token item in the same DynamoDB table.  
- **Sorting & Pagination:**  
  - List endpoints accept `limit` and `next` (base64-encoded cursor).  
  - Default sort: **desc** for `product` and `event` (newest first), **asc** otherwise.  
- **Error schema:** `{ error: string, message: string }` with 400/404/409/500 variants and CORS headers.

**Mobile (apps/mobile)**  
- Unified **objects client** (`src/api/client.ts`) used by features for **Products, Inventory, Events/Registrations**.  
- **Screens present:** Hub, Tenants, Scan (intents), Objects (list/detail), **Products (list/detail)**, **Inventory (list/detail)**, Events (list/detail), Registrations (list/detail).  
- **Navigation:** Strongly-typed `RootStackParamList` (fixes prior `navigation` TS errors).  
- **Scan intents v1.1:** supports `navigate` and scaffold for `attach-epc` (no-op alert for now).

**Web (apps/web)**  
- Minimal Vite app with a lightweight API layer. **Note:** a couple endpoints are still using legacy shapes (see Alignment Notes).

---

## 2) Canonical API (what to code against)

### 2.1 Headers
- `x-tenant-id: <TenantKey>` **(required)**  
  Nonprod default fallback exists, but clients should always send it.

### 2.2 Resources & Aliases

#### Products
- `POST /products` → create product (alias to `/objects/product`)  
- `GET  /products` → list products (alias to `/objects/product`)  
- `GET  /products/search?sku=<sku>&q=<nameSubstr>&limit=<n>&order=asc|desc` → search products  
- `GET  /products/:id` → get one (alias to `/objects/product/:id`)  
- `PUT  /products/:id` → update (alias to `/objects/product/:id`)

**Product shape (server response):**
```json
{
  "id": "uuid",
  "tenant": "DemoTenant",
  "type": "product",
  "name": "Salt Block",
  "sku": "SB-100",
  "price": 12.5,
  "uom": "each",
  "taxCode": "TX-A",
  "kind": "good",
  "createdAt": "ISO",
  "updatedAt": "ISO"
}
```

#### Events & Registrations
- `POST /events` → create event (→ `/objects/event`)  
- `GET  /events` → list events  
- `GET  /events/:id` → get  
- `PUT  /events/:id` → update  
- `GET  /events/:id/registrations` → list registrations for event (`type=registration&eventId=`)

- `POST /registrations` → create registration (→ `/objects/registration`)  
- `GET  /registrations` → list registrations  
- `GET  /registrations/:id` → get  
- `PUT  /registrations/:id` → update

#### Generic Objects (multi‑type bucket)
- `POST /objects/:type`  
- `GET  /objects/:type` → **list** with `limit`, `next`, optional `sort=asc|desc`, and type‑specific filters like `eventId` for registrations.  
- `GET  /objects/:type/:id`  
- `PUT  /objects/:type/:id`

**Legacy search (still supported for convenience):**
- `GET /objects?type=<t>&sku=<v>&q=<substr>&limit=<n>&order=asc|desc`

> **Inventory:** not a first‑class alias yet. The server happily serves `type=inventory` through the generic objects routes; the mobile app already uses that. If/when inventory movements/locations are added, we can introduce `/inventory/*` facades without breaking clients.

### 2.3 Query, Sort, and Pagination
- **List:** `limit` (default ≤ 25; max set by `MAX_LIST_LIMIT` env), `next` (cursor), `sort` (`asc|desc`, defaults vary by type).  
- **Search:** `type` (required), `sku` (exact, case‑insensitive), `q` (substring on normalized name), `order` (`asc|desc`).

### 2.4 Errors
```json
{
  "error": "BadRequest|NotFound|Conflict|Internal",
  "message": "human readable"
}
```

---

## 3) Mobile App Conventions (current)

- **API client:** `src/api/client.ts` exposes `list/get/create/update` for object types; feature APIs (e.g., products, inventory) are **thin wrappers**.  
- **State:** React Query with `queryClient` provider. Infinite lists use `next` cursors.  
- **Navigation:** All screens use `useNavigation<RootStackNav>()` props from `RootStackParamList`.  
- **Theme:** `ThemeProvider` supplies `ui/theme.ts` tokens; screens adhere to consistent paddings, cards, and headers.  
- **Scan intents:** `"mbapp/object-v1"` payloads route to detail screens; `attach-epc` is stubbed with an alert.  
- **Env:** `EXPO_PUBLIC_API_BASE`, `EXPO_PUBLIC_TENANT_ID` used by the client; a small `src/config.ts` also defines defaults for dev.

---

## 4) Alignment Notes (found during review)

1. **Web client endpoints (needs update):**  
   - Uses `/objects/:type/list?cursor=` and `/objects/search?tag=`; server implements `GET /objects/:type` with `next=` and the search expects `type`, optional `sku` or `q`.  
   - ✅ Action: Update `web/src/lib/api.ts` to the canonical shapes above.

2. **Inventory:**  
   - Mobile already treats `type=inventory` as a first‑class feature via the generic objects API.  
   - Server has **no specialized validation** for inventory fields (OK for MVP).  
   - ✅ Future: add `/inventory/*` aliases and movements/locations endpoints if/when required.

3. **Env duplication (mobile):**  
   - Both `src/config.ts` and `src/lib/config.ts` exist. Prefer `EXPO_PUBLIC_*` env and remove duplication later.

4. **Tenants API:**  
   - Web calls `/tenants`, but this router doesn’t define it. If you still want a Tenants list, we can either stub it or back it with a static source/S3 doc in nonprod.

5. **Idempotency-Key:**  
   - CORS allows the header, but the server doesn’t implement idempotent behavior yet. Safe to ignore for MVP.

---

## 5) QR / Scan Payloads

- `t = "mbapp/object-v1"`  
  - Required fields: `type`, `id`  
  - On scan (`intent: "navigate"`): app routes to the appropriate detail screen.  
  - On scan (`intent: "attach-epc"` + `attachTo`): placeholder alert in this sprint (no write).

> Future intents in the doc (e.g., `reserve-resource`, `assign-stall`, `check-in`) are still planned; UI stubs can be added after Events/Registrations stabilize.

---

## 6) Data Shapes (MVP, as implemented)

### Product (server canonical)
```ts
type Product = {
  id: string;
  tenant: string;
  type: "product";
  name?: string;
  sku?: string;
  price?: number;
  uom?: string;
  taxCode?: string;
  kind?: "good" | "service";
  createdAt: string;
  updatedAt?: string;
};
```

### Event
```ts
type Event = {
  id: string;
  tenant: string;
  type: "event";
  name?: string;
  startsAt?: string;
  endsAt?: string;
  status?: string;
  createdAt: string;
  updatedAt?: string;
};
```

### Registration
```ts
type Registration = {
  id: string;
  tenant: string;
  type: "registration";
  eventId: string;
  accountId?: string;
  status?: string; // default "pending"
  createdAt: string;
  updatedAt?: string;
};
```

### Inventory (client‑level shape used in mobile)
```ts
type InventoryItem = {
  id: string;
  type: "inventory";
  productId?: string;
  sku?: string;
  name?: string;
  qtyOnHand: number;
  uom?: string;
  cost?: number;
  location?: string;
  kind?: string;
  createdAt?: string;
  updatedAt?: string;
  metadata?: Record<string, unknown>;
};
```

---

## 7) Roadmap (immediately next)

1) **Web client endpoint alignment** (update to canonical `/objects/:type`, `next=`, and search `type/sku/q`).  
2) **Products & Inventory polish** (uniform toasts, disabled states, and error handling across list/detail).  
3) **Events/Registrations** (finish UI parity with Products, add scan deep-links to event/registration routes).  
4) **Optionally add `/inventory/*` aliases** (keep existing generic behavior; introduce movements later).  
5) **Tenants list** (re-introduce minimal endpoint or remove from web until needed).

---

## 8) Appendix — DynamoDB model notes

- **Primary key:** `pk = id`, `sk = "{{tenant}}|{{type}}"`  
- **GSI1:** `gsi1pk = "{{tenant}}|{{type}}"`, `gsi1sk = "createdAt#ISO#id#<id>"` (supports newest‑first).  
- **SKU uniqueness (products):** token item under `pk="UNIQ#{{tenant}}#product#SKU#{{skuLc}}"` ensures per‑tenant uniqueness.  
- **Name normalization:** server stores `name_lc` for simple substring search (nonprod scale).

---

**This document reflects the repo you shared on 2025‑09‑16 and is safe to commit to `docs/MBapp-Combined.md`.**

## Monorepo Layout

### api
```
  package.json
  tsconfig.json
  src/
    db.ts
    index.ts
    common/
      ddb.ts
      env.ts
      responses.ts
      roles.ts
    objects/
      create.ts
      get.ts
      list.ts
      listByType.ts
      search.ts
      searchByTag.ts
      update.ts
    tenants/
      list.ts
```
### mobile
```
  .env
  App.tsx
  app.config.ts
  package.json
  tsconfig.json
  src/
    config.ts
    api/
      client.ts
    features/
      catalog/
        api.ts
        types.ts
      events/
        api.ts
      inventory/
        api.ts
        types.ts
      products/
        api.ts
    lib/
      api.ts
      config.ts
      errors.ts
      http.ts
      qr.ts
      z.ts
    navigation/
      RootStack.tsx
      types.ts
    providers/
      RolesProvider.tsx
      ThemeProvider.tsx
      queryClient.ts
    screens/
      EventDetailScreen.tsx
      EventsListScreen.tsx
      InventoryDetailScreen.tsx
      InventoryListScreen.tsx
      ModuleHubScreen.tsx
      ObjectDetailScreen.tsx
      ObjectsListScreen.tsx
      ProductDetailScreen.tsx
      ProductsListScreen.tsx
      RegistrationDetailScreen.tsx
      RegistrationsListScreen.tsx
      ScanScreen.tsx
      TenantsScreen.tsx
    shared/
      modules.ts
    ui/
      Fab.tsx
      NonProdBadge.tsx
      Screen.tsx
      Section.tsx
      theme.ts
```
### web
```
  package.json
  src/
    App.tsx
    main.tsx
    vite-env.d.ts
    lib/
      api.ts
```

## Changelog

### 2025-09-16
- Canonicalized API aliases: `/products`, `/events`, `/registrations` over generic `/objects/:type`.
- Standardized list pagination to `limit` + `next` cursors and search params `type`, `sku`, `q`, `order`.
- Mobile: unified objects client; fixed typed navigation to eliminate `navigation` TS errors.
- Scan intents: keep `navigate`; stub `attach-epc` for later write-path work.
- Web: flagged legacy endpoints (`/objects/:type/list?cursor=`, `/objects/search?tag=`) for update.
- Inventory: continue using `type=inventory` via generic routes; defer `/inventory/*` facade until movements/locations land.
- Docs: merged into **MBapp-Master.md** with updated Monorepo Layout and Changelog sections.

### 2025-09-16
- Web: replaced web/src/lib/api.ts with canonical client (objects + products alias, cursor pagination, x-tenant-id).
- Mobile: unified ScanScreen routing for product/inventory/event/registration; preserved attach-epc stub.
- Inventory: ensured parity patterns (search/kind/cursor, save-toasts, query invalidation).
- Cleanup: removed unused mobile/src/config.ts.

### 2025-09-16
- Fix: Localized Vite typings to web package. Removed `"types": ["vite/client"]` from non-web tsconfigs and added `web/tsconfig.json` scoped to Vite.

