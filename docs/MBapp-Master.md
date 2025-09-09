
# MBapp — Master Systems Doc (nonprod)

_Last updated: 2025-09-09 (UTC). Keep this **single** doc as the source of truth._

---

## Quick callouts (for a fresh chat)
- **Repo:** `github.com/mbhiller/MBapp-pub`
- **Branch:** `main` (feature branches as needed)
- **API Base:** `https://ki8kgivz1f.execute-api.us-east-1.amazonaws.com`
- **Tenant ID:** `DemoTenant`
- **AWS (nonprod):** API ID `ki8kgivz1f` • Lambda `mbapp-nonprod-objects` • Dynamo table `mbapp_objects` • GSI `byId`

When starting a new chat, share the items above + any changed files you want me to review (paste contents for drop-ins).

---

## Monorepo
```
apps/
  api/       # Lambda monolith for Objects API
  mobile/    # Expo/React Native app
docs/
  MBapp-Master.md   # ← this file (single source of truth)
scripts/
  Make-JsonQr.ps1   # ← QR generator for object detail
qr/                 # ← local output folder for QR PNG + JSON artifacts
```
> `qr/` is local/developer output and should be ignored by git (see `.gitignore`).

---

## Backend (Objects API)

### Environment
- **Lambda:** `mbapp-nonprod-objects` (Node 20, CJS handler `index.handler`)
- **DynamoDB:** table `mbapp_objects`
- **GSI:** `byId` (id or id_tenant variants supported by code)
- **Env vars (Lambda):**
  ```
  OBJECTS_TABLE=mbapp_objects
  BY_ID_INDEX=byId
  ```

### Headers
- Multi-tenant header: `x-tenant-id: DemoTenant`

### Routes (canonical)
- **Create:** `POST /objects/{{type}}` → `201` + `Location: /objects/{{type}}/{{id}}` + full item.
- **Read:** `GET /objects/{{type}}/{{id}}` → `200 {{ id, type, name?, tags?, data?, integrations?, createdAt, updatedAt }}` or `404`.
- **Update:** `PUT /objects/{{type}}/{{id}}`
  - Body: `{{ name?, tags?, integrations? }}`
  - Merges fields; tags merge safely (e.g., `tags.rfidEpc`).
  - `200 {{ id, updated: true }}` • `404` not found • `409` type mismatch.
- **List (paginated):** `GET /objects?type={{type}}&limit={{n}}&cursor={{token}}&name={{contains}}`
  - Returns `{{ items: [...], nextCursor? }}`
  - Name filter supported; nonprod has a limit cap to avoid heavy scans.
- **Search:** present but avoids full-table `Scan` by default; prefer List+filters.

> Legacy `GET /objects/{{id}}?type=...` may 308-redirect to the canonical route when inference is enabled. Clients should call canonical.

### Errors
- `400` bad input • `404` not found • `409` conflict • `500` internal.
- Body typically `{{ error: string }}` or `{{ message: string }}`.

---

## Mobile App

### Tech
- Expo/React Native
- TypeScript with **moduleResolution: bundler** (Expo)
- Global toasts via `ToastHost` + `toastFromError`

### Key files
- Client: `apps/mobile/src/api/client.ts` (axios: baseURL from env, header `x-tenant-id`)
- Screens:
  - `ObjectsListScreen.tsx` — tabs by type; server-side `name` filter; infinite scroll; **long-press row → Scan & attach EPC**.
  - `ObjectDetailScreen.tsx` — inline edit: `name` and `tags.rfidEpc` (empty detaches); robust id/type param handling (accepts `{{ id,type }}`, `{{ obj }}`, or `{{ item }}`).
  - `ScanScreen.tsx` — uses `expo-camera`; detects **MBapp QR** (`{{ id, type }}` JSON) to open detail, otherwise treats scan as EPC (attach flow or capture).
- UI utilities:  
  - `src/ui/Toast.tsx` — global Snackbar host + `toast(message)`
  - `src/lib/errors.ts` — `toastFromError(e, prefix?)`
  - `src/lib/config.ts` — reads `EXPO_PUBLIC_API_BASE`, `EXPO_PUBLIC_TENANT_ID`
  - `src/lib/http.ts` — axios instance
  - `src/lib/z.ts` — zod normalizers (tenants, etc.)
- Helper:
  - `apps/mobile/src/lib/qr.ts` — parses MBapp QR payloads.

### Env (mobile)
- `EXPO_PUBLIC_API_BASE` (falls back to the API base above)
- `EXPO_PUBLIC_TENANT_ID` (falls back to `DemoTenant`)

---

## QR utilities (local)

### Script
- **Path:** `scripts/Make-JsonQr.ps1`
- **What it does:** 
  - If no `-Id` is given, creates a test object via `POST /objects/{{type}}` (sends a `name` so backend is happy).
  - Emits JSON payload `{{ t: "mbapp/object-v1", id, type, href }}`.
  - Writes `qr-object-{{type}}-{{id}}.json` and `qr-object-{{type}}-{{id}}.png` into **`qr/`** (created if missing).
  - `-Open` flag opens the PNG after download.
- **Typical usage:**
  ```powershell
  ./scripts/Make-JsonQr.ps1 -Open
  # or reuse an existing id
  ./scripts/Make-JsonQr.ps1 -Id <guid> -Type horse -Open
  ```

### Payload shape
```json
{{ "t": "mbapp/object-v1", "id": "<guid>", "type": "horse", "href": "/objects/horse/<guid>" }}
```

### App behavior
- Scan an **MBapp QR** → app navigates to `ObjectDetail` with the provided `{ id, type }`.
- Scan a **non-MBapp code** → app treats it as an **EPC**:
  - If `ScanScreen` was opened with `attachTo={{ id, type }}`, it merges `tags.rfidEpc` on that object.
  - Otherwise it captures the EPC into the manual field so you can attach later.

---

## CI (GitHub Actions)
- **API job**
  - `working-directory: apps/api`
  - `npm install`
  - `npx tsc -p tsconfig.json --noEmit`
  - `npx esbuild src/index.ts --bundle --platform=node --target=node20 --format=cjs --outfile=dist/index.js`
- **Mobile job**
  - `working-directory: apps/mobile`
  - `npm install --only=dev` (typecheck without full native/Expo stacks)
  - `npx tsc -p tsconfig.json --noEmit`

> Mobile `tsconfig.json` extends Expo base and uses `"moduleResolution": "bundler"` to avoid the `customConditions` error.

---

## Local smoke (PowerShell)
```powershell
$API="https://ki8kgivz1f.execute-api.us-east-1.amazonaws.com"
$TENANT="DemoTenant"; $TYPE="horse"
$hdr=@{ "x-tenant-id"=$TENANT; "content-type"="application/json" }

# Create
$name="Smoke $([DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss'))"
$create=Invoke-RestMethod -Method POST "$API/objects/$TYPE" -Headers $hdr -Body (@{name=$name}|ConvertTo-Json)
$id=$create.id; if(-not $id){ throw "create failed" }

# Get (canonical)
$one=Invoke-RestMethod -Method GET "$API/objects/$TYPE/$id" -Headers $hdr
if($one.id -ne $id){ throw "get mismatch" }

# Update
$null=Invoke-RestMethod -Method PUT "$API/objects/$TYPE/$id" -Headers $hdr -Body (@{name="$name (Updated)"}|ConvertTo-Json)

# List
$lst=Invoke-RestMethod -Method GET "$API/objects?type=$TYPE&limit=10&name=Smoke" -Headers $hdr
"OK id=$id items=$($lst.items.Count)"
```

---

## Branching & releases
- **Merged to `main`:** QR helper (`apps/mobile/src/lib/qr.ts`), `ScanScreen` MBapp-QR → detail, robust `ObjectDetail` param extraction, `scripts/Make-JsonQr.ps1` writing to `qr/`.
- **Tag suggestion:** `mobile-qr-v1` (optional).
- **Next feature branch:** `feature/sprint-2025-09-10` (start from `main`).

```powershell
git checkout main
git pull --ff-only
git checkout -b feature/sprint-2025-09-10
git push -u origin feature/sprint-2025-09-10
```

---

## Backlog (near-term)
- DELETE `/objects/{type}/{id}` (soft-delete flag).
- `prevCursor` support (reverse pagination).
- Richer search indexes (common fields).
- Success toast variants (OK/Warning).
- Type-specific forms (zod-driven).

---

## Change log
- **2025-09-09 (later):** Mobile **MBapp QR** flow: `apps/mobile/src/lib/qr.ts`, `ScanScreen` QR→detail, robust `ObjectDetail` id/type handling, QR script now writes to `qr/` folder.
- **2025-09-09:** Canonical GET/PUT; List filter + capped limits + cursors; Mobile inline edit (name/EPC), Scan→Attach EPC flow (long-press list); global toasts; CI stable with per-app configs + Expo bundler.
