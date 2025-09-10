# MBapp — Master Systems Doc (nonprod)

_Last updated: 2025-09-10 02:17 UTC. This file is the **single source of truth** for the nonprod app + API._

---


## Quick callouts (fresh chat primer)
- **Repo:** `github.com/mbhiller/MBapp-pub`
- **Main branch:** `main` (always releasable)
- **Current sprint branch:** `feature/sprint-2025-09-11`
- **API Base:** `https://ki8kgivz1f.execute-api.us-east-1.amazonaws.com`
- **Tenant ID:** `DemoTenant`
- **AWS (nonprod):** API ID `ki8kgivz1f` • Lambda `mbapp-nonprod-objects` • DynamoDB `mbapp_objects` • GSI `byId`

---

## Monorepo layout (relevant parts)
```
apps/
  api/
    src/tenants/
      list.ts               # GET /tenants handler (server side)
  mobile/
    src/
      api/client.ts         # REST helpers (getObject, updateObject, createObject, listObjects...)
      lib/
        config.ts           # reads EXPO_PUBLIC_* values
        http.ts             # axios client factory (tenant header, logging, Axios v1 typing)
        qr.ts               # robust MBapp QR parser (JSON/URL/loose text)
        z.ts                # zod helpers
      navigation/
        RootStack.tsx       # single native stack + modal Scan; header buttons
        types.ts            # typed route params (+ Scan intent)
      screens/
        ObjectsListScreen.tsx
        ObjectDetailScreen.tsx
        ScanScreen.tsx
      features/tenants/
        api.ts              # listTenants() using shared http client
        useTenants.ts       # React Query hook
        TenantsScreen.tsx   # themed screen (ready, optional)
      ui/
        ThemeProvider.tsx   # env-aware theme context
        theme.ts            # tokens for prod/nonprod
        Screen.tsx
        Section.tsx
        NonProdBadge.tsx
docs/
  MBapp-Master.md           # ← THIS DOC
scripts/
  Make-JsonQr.ps1           # creates object (optional) + emits JSON + QR PNG → qr/
  Set-Mobile-Env.ps1        # helper to set EXPO_PUBLIC_* locally
qr/                         # local output folder for QR JSON/PNG (git-ignored)
```

> `qr/` is developer output and should be ignored by git.

---

## Backend (Objects API)

### Environment
- **Lambda:** `mbapp-nonprod-objects` (Node 20, CJS)
- **DynamoDB:** table `mbapp_objects`
- **GSI:** `byId`
- **Env vars (Lambda):**
  ```
  OBJECTS_TABLE=mbapp_objects
  BY_ID_INDEX=byId
  ```

### Headers
- Multi-tenant header required: `x-tenant-id: DemoTenant`

### Routes (canonical)
- **Create:** `POST /objects/{{type}}` → `201` + `Location: /objects/{{type}}/{{id}}` + body `{ id, type, ... }`
- **Read:** `GET /objects/{{type}}/{{id}}` → `200 { id, type, name?, tags?, data?, integrations?, createdAt, updatedAt }` or `404`
- **Update:** `PUT /objects/{{type}}/{{id}}`
  - Body: `{ name?, tags?, integrations? }` (merges; e.g., `tags.rfidEpc`)
  - `200 { id, updated: true }` • `404` not found • `409` type mismatch
- **List:** `GET /objects?type={{type}}&limit={{n}}&cursor={{token}}&name={{contains}}`
  - Returns `{ items: [...], nextCursor? }`
  - Name filter supported; nonprod caps limit to avoid heavy scans

### Tenants (server)
- **GET /tenants** (non-blocking for app): array or `{ items: [...] }` with `{ id, name, slug? }`.

---

## Mobile app (Expo / React Native)

### Env & theming
- **Env vars**
  - `EXPO_PUBLIC_ENV = nonprod | prod` (controls theme + NON-PROD badge)
  - `EXPO_PUBLIC_API_BASE = https://...execute-api...amazonaws.com`
  - `EXPO_PUBLIC_TENANT_ID = DemoTenant`
- **Theme system**
  - `ui/ThemeProvider.tsx`, `ui/theme.ts` define tokens for **prod** and **nonprod**
  - Use `<Screen>` + `<Section>` primitives to keep layouts consistent (ObjectDetail look)
  - `NonProdBadge` shows when `EXPO_PUBLIC_ENV != prod`

**Helper to set env (PowerShell):**
```powershell
# Session only
./scripts/Set-Mobile-Env.ps1
# or persist for your user (open a new terminal afterwards)
./scripts/Set-Mobile-Env.ps1 -Persist
```

### Navigation
- **Single Native Stack** (`navigation/RootStack.tsx`) with screens:
  - `Objects` (list) — headerLeft: **Tenants**, headerRight: **Scan**
  - `ObjectDetail` — headerRight **Scan** opens scanner in attach mode for this object
  - `Scan` — **fullScreenModal**; header **Close**; Android **Back** exits
  - `Tenants` — themed directory (optional)
- **Route typing**: `navigation/types.ts`
  - `Scan` accepts optional `{ attachTo: {id,type}, intent?: "attach-epc" | "metadata" | "invoice" | ... }`
- (Optional later) Deep link config for `mbapp://objects/:type/:id`

### HTTP client (shared)
- **Path:** `src/lib/http.ts`
- **Exports:** `client()` (**preferred factory**) and alias `http`
- **Behavior:**
  - Base URL from `EXPO_PUBLIC_API_BASE`
  - Timeout `10s`
  - Adds `x-tenant-id` from `EXPO_PUBLIC_TENANT_ID` on every request
  - Defaults `Accept: application/json` and `Content-Type: application/json` for body requests
  - Light logging in nonprod (request/response + duration)
  - Axios v1 typing: `InternalAxiosRequestConfig` in interceptors

### Screens (current behavior)
- **ObjectsListScreen**
  - Themed list using `Screen/Section`
  - Type chips (horse/dog/cattle), local search, pull-to-refresh, infinite scroll
  - Press → `ObjectDetail`; Long-press → `Scan` in attach mode
  - Badges: `EPC {rfidEpc}` and `Archived`
- **ObjectDetailScreen**
  - Robust param handling: accepts `{ id, type }` or `{ obj }`/`{ item }`
  - Inline edit: **Name**, **RFID EPC** (empty detaches), **Archived** toggle
  - **Actions**: **Scan to Update** button (opens Scan with `attachTo` current object)
  - Save merges tags safely; shows toasts on success/failure
- **ScanScreen**
  - Uses `expo-camera` (QR + common barcodes)
  - **MBapp QR** detection: JSON, URL `/objects/:type/:id`, or loose JSON → **replace → Object Detail**
  - Otherwise treats scan as **EPC**: attach if `attachTo` provided; else stash in manual field
  - Exit options: header **Close**, on-screen **Close** pill, Android **Back**
  - Nonprod overlay shows the raw scan (first 200 chars) for debug

- **TenantsScreen**
  - Ready and themed; calls `useTenants()`; graceful if API not wired

### Tenants (client)
- `features/tenants/api.ts`: `listTenants()` adapts to `client()`/`http()` factory or a prebuilt instance
- `features/tenants/useTenants.ts`: React Query hook with mild caching

---

## QR utilities

### Script
- **Path:** `scripts/Make-JsonQr.ps1`
- **Behavior:**
  - If no `-Id`, creates a test object via `POST /objects/{{type}}` (sends a `name`)
  - Emits JSON payload:  
    `{ "t": "mbapp/object-v1", "id": "...", "type": "...", "href": "/objects/<type>/<id>" }`
  - Saves `qr-object-<type>-<id>.json` and `qr-object-<type>-<id>.png` to `qr/`
  - `-Open` launches the PNG
- **Typical usage:**
  ```powershell
  ./scripts/Make-JsonQr.ps1 -Open
  ./scripts/Make-JsonQr.ps1 -Id <guid> -Type horse -Open
  ```
- (Optional later) also include `url: "mbapp://objects/<type>/<id>"` for deep links

---

## Local smoke tests

### API (PowerShell)
```powershell
$API="https://ki8kgivz1f.execute-api.us-east-1.amazonaws.com"
$TENANT="DemoTenant"; $TYPE="horse"
$hdr=@{ "x-tenant-id"=$TENANT; "content-type"="application/json" }

# Create
$name="Smoke $([DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss'))"
$create=Invoke-RestMethod -Method POST "$API/objects/$TYPE" -Headers $hdr -Body (@{name=$name}|ConvertTo-Json)
$id=$create.id; if(-not $id){ throw "create failed" }

# Get
$one=Invoke-RestMethod -Method GET "$API/objects/$TYPE/$id" -Headers $hdr
if($one.id -ne $id){ throw "get mismatch" }

# Update (EPC + archived)
$body=@{ name="$name (Updated)"; tags=@{ rfidEpc="3034000F12345678000004D2"; archived=$true } } | ConvertTo-Json
$null=Invoke-RestMethod -Method PUT "$API/objects/$TYPE/$id" -Headers $hdr -Body $body

# List
$lst=Invoke-RestMethod -Method GET "$API/objects?type=$TYPE&limit=10&name=Smoke" -Headers $hdr
"OK id=$id items=$($lst.items.Count)"
```

### Mobile
1. Ensure env is set (`Set-Mobile-Env.ps1` or PowerShell session variables)
2. `npm run start` (from `apps/mobile`), open on device/emulator
3. `./scripts/Make-JsonQr.ps1 -Open` and scan → **Object Detail** opens (replace)
4. From detail, tap **Scan to Update** → opens **Scan** in attach mode; attach EPC; returns to detail
5. Long-press list item → **Scan** attach flow; attach EPC and return to detail
6. Tap **Tenants** (header) → loads list (or shows friendly error)

---

## Branching & releases
- **Current:** `feature/sprint-2025-09-11`
- Merge to `main` at end of day (squash), keep `main` clean & releasable
- Tag milestones, e.g., `sprint-2025-09-10`, `sprint-2025-09-11`

### Next-sprint candidates
- Deep linking `mbapp://objects/:type/:id` (QR script can also emit `url`)
- Delete/Restore flow (soft delete with `tags.deletedAt`)
- List: show/hide Archived filter; empty-state CTA
- Type-specific detail forms (start with horse)
- Scan intents (e.g., `metadata`, `invoice`) with action router

---

## Change log
- **2025-09-11:** Env-aware theming; single-stack nav; **Scan Close UX**; **robust QR parser** (JSON/URL/loose); **Scan replaces to Object Detail**; Tenants route + API hook; shared HTTP client with tenant header & Axios v1 typing; **Object Detail: in-screen “Scan to Update” button**; route types extended with `Scan intent`; Objects list themed with chips/badges.
- **2025-09-10:** MBapp QR → detail, robust ObjectDetail params, EPC attach merge; `Make-JsonQr.ps1` writes to `qr/`; scan UX and list improvements.
- **2025-09-09:** Canonical GET/PUT and List; initial mobile inline edit + scan→attach flow; CI stable.
