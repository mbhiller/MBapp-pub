# MBapp — Master Systems Doc (nonprod)

_Last updated: 2025-09-10 00:00 UTC. This file is the **single source of truth** for the current nonprod app + API state._

We are intentionally running **lean** during this sprint: Hub shows the core 3 modules (**Products**, **Objects**, **Tenants**) and **Scan** is available everywhere. Role/module gating will be reintroduced later when needed.

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
  - **React:** `19.0.0` (web + mobile)
  - **TypeScript:** `5.5.4` (hoisted at workspace root)
  - **@types/react:** `^19.1.x` (hoisted; avoid per-app overrides)

---

## Scope for this sprint slice (catalog-first, scan-first)
- **Hub** (lean): Products, Objects, Tenants; plus header **Scan** button on all primary screens.
- **Catalog / Products**: list + detail; create (mode `new`) and update (by `id`).
- **Objects**: list + detail; “Scan to Attach EPC” button from detail opens Scan with `attachTo`.
- **Scan**: single modal screen, launched from headers or with `attachTo` from Object Detail.
- **Tenants**: visible from headers and Hub (placeholder list).

> Role/module gating is deferred (we will re-enable later via a `registry.ts` and `Session` provider).

---

## Monorepo layout (relevant parts)
```
apps/
  api/
    src/
      index.ts               # Entry (routes switch) — HANDLER: dist/index.handler
      objects/               # Canonical object handlers (get, create, update, list, search)
      common/responses.ts    # ok/bad/notimpl/preflight/error helpers
    ops/
      Publish-ObjectsLambda-EsbuildOnly.ps1
      Setup-ProductsRoutes.ps1
  mobile/
    App.tsx                  # QueryClientProvider + ThemeProvider + NavigationContainer
    src/
      navigation/
        RootStack.tsx        # Hub + Objects + Products + Tenants + Scan (global Scan header)
        types.ts
      screens/
        ModuleHubScreen.tsx  # lean hub (3 tiles) + Scan utility tile
        ProductsListScreen.tsx
        ProductDetailScreen.tsx   # keyboard + refetch fix
        ObjectsListScreen.tsx     # minimal, stable
        ObjectDetailScreen.tsx    # "Scan to Attach EPC"
        ScanScreen.tsx
      features/
        catalog/
          api.ts             # /products API client (POST/PUT/GET/list)
          types.ts
          useProducts.ts     # React Query hooks (list/detail/create/update)
        tenants/
          api.ts
          useTenants.ts
          TenantsScreen.tsx
      providers/queryClient.ts
      ui/
        ThemeProvider.tsx, Screen.tsx, Section.tsx, NonProdBadge.tsx
docs/
  MBapp-Master.md
```

---

## Backend (Objects API + Products aliases)

### Environment
- **Lambda:** `mbapp-nonprod-objects` (Node 20, CommonJS)
- **DynamoDB:** table `mbapp_objects`
- **GSI:** `byId`
- **Env vars (Lambda):**
```
OBJECTS_TABLE=mbapp_objects
BY_ID_INDEX=byId
```

### Headers
- Multi-tenant header required on all API calls: `x-tenant-id: DemoTenant`

### Canonical Object routes
- **Create:** `POST /objects/{type}`
- **Read:** `GET /objects/{type}/{id}` and legacy `GET /objects/{id}`
- **Update:** `PUT /objects/{type}/{id}`
- **List:** `GET /objects/{type}/list` and `GET /objects/{type}`
- **Search:** `GET /objects/search`
- **Tenants stub:** `GET /tenants`

### **Products** alias routes (re-using Object handlers)
We expose `/products` so the mobile client can use it directly, while storing rows under `type=product` and tolerating legacy `good/service` rows.

| Client Route            | Backend handling                                                               |
|------------------------|----------------------------------------------------------------------------------|
| `POST /products`       | Rewrites body to `type:"product"` (preserves `kind` if body.type was `good/service`) → `POST /objects/product` |
| `PUT /products/{id}`   | `PUT /objects/product/{id}`; if **type mismatch**, retries `"good"` then `"service"` |
| `GET /products/{id}`   | `GET /objects/product/{id}`; if mismatch, falls back to `"good"` then `"service"` |
| `GET /products`        | `GET /objects/product` (list; supports `limit`, `cursor`, `q`)                   |

---

## Ops — build, publish, and route wiring

### Publish Lambda (esbuild only; no tsc)
`apps/api/ops/Publish-ObjectsLambda-EsbuildOnly.ps1`
- Bundles `src/index.ts` → `dist/index.js` (CJS, node20)
- Zips `dist/` + production `node_modules/`
- Uploads code and ensures **handler = `dist/index.handler`**

Usage:
```powershell
aws sso login --profile mbapp-nonprod-admin
pwsh .\apps\api\ops\Publish-ObjectsLambda-EsbuildOnly.ps1 `
  -FunctionName mbapp-nonprod-objects -Region us-east-1 -Profile mbapp-nonprod-admin
```

### Wire `/products` routes
`apps/api/ops/Setup-ProductsRoutes.ps1`
- Ensures routes exist and point to integration **`tdnoorp`** (HTTP API `ki8kgivz1f`)
- Enables `$default` **auto-deploy**

Usage:
```powershell
pwsh .\apps\api\ops\Setup-ProductsRoutes.ps1 `
  -Profile mbapp-nonprod-admin -Region us-east-1 `
  -ApiId ki8kgivz1f -IntegrationId tdnoorp
```

---

## Mobile test plan (after any change)
From `apps/mobile`:
```bash
npx expo start -c
```
In the app:
1. **Hub** → Products → **New** → Create (`sku`, `name`, `type`, `uom`, `price`) → lands on detail with **id**.
2. Change **Price** → **Save** → keyboard dismisses; detail refetches; value sticks.
3. **Objects** → open item → **Scan to Attach EPC** opens Scan (modal).
4. **Tenants** opens cleanly.
5. Header **Scan** available on Hub, Products, Objects, Tenants.

---

## API smoke tests (PowerShell)
```powershell
$API='https://ki8kgivz1f.execute-api.us-east-1.amazonaws.com'
$TEN='DemoTenant'
$HDR=@{ 'x-tenant-id'=$TEN; 'Content-Type'='application/json' }

# Create
$body=@{ sku='ALF-BALE'; name='Alfalfa Bale'; type='good'; uom='ea'; price=14.5 } | ConvertTo-Json
$p = Invoke-RestMethod -Method POST "$API/products" -Headers $HDR -Body $body

# Read
Invoke-RestMethod -Method GET "$API/products/$($p.id)" -Headers @{ 'x-tenant-id'=$TEN } | Out-Host

# Update
Invoke-RestMethod -Method PUT "$API/products/$($p.id)" -Headers $HDR -Body (@{ price=15.0 } | ConvertTo-Json) | Out-Host

# List
Invoke-RestMethod -Method GET "$API/products?limit=25" -Headers @{ 'x-tenant-id'=$TEN } | Out-Host
```

---

## Troubleshooting

- **Mobile shows “Element type is invalid…”**
  - Ensure screens export **default** (e.g., `export default function ObjectsListScreen…`).
  - Verify imports in `RootStack.tsx` match default exports.

- **Keyboard won’t dismiss on Product Detail**
  - Fixed in `ProductDetailScreen.tsx` (uses `Keyboard.dismiss`, `keyboardDismissMode="on-drag"`, and refetch after save).

- **Unsupported route /products**
  - Run `Setup-ProductsRoutes.ps1` to create routes against integration `tdnoorp`.
  - Ensure Lambda handler is `dist/index.handler` via publish script.

- **Type mismatch on legacy products**
  - The alias handler retries `good` then `service` on GET/PUT by id.

- **JSX/TS errors in VS Code but app runs**
  - Restart TS server in VS Code.
  - Keep a single hoisted `@types/react` and `typescript` at the root; avoid root `overrides` that conflict.

---

## Change log
- **2025-09-10:** Lean Hub (Products/Objects/Tenants) with global Scan; Product Detail keyboard + refetch fix; stable Objects screens; `/products` aliases alive; ops scripts captured (`tdnoorp` integration).
- **2025-09-09:** Scan UX, Tenants route, shared HTTP client, Object Detail scan attach.
