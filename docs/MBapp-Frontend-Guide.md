# MBapp Frontend Guide (apps/mobile & web)

How we build modules, screens, layouts, hydration, navigation, actions, and hooks.

## 1) Module layout (feature-first)
apps/mobile/src/features/
salesOrders/
api.ts // CRUD (objects)
soActions.ts // RPC actions: submit/commit/reserve/release/fulfill
purchasing/
api.ts
poActions.ts
inventory/
api.ts
products/
api.ts
events/
api.ts
eventsActions.ts
resources/
api.ts
reservationsActions.ts
_shared/
useColors.ts
ScannerPanel.tsx
Keep CRUD (reusable) separate from action RPCs.

## 2) API client
`apps/mobile/src/api/client.ts`:
- Dual tenant headers; Bearer token required (no automatic dev-login fallback).
- `listObjects/getObject/createObject/updateObject/deleteObject`.
- `apiClient.get/post/put/del` with optional idempotency.

## 3) Screen patterns
- **Header card**: always visible; ✏️ Edit toggles inputs; **Save/Create** only in edit mode.
- **Primary CTA** (context-aware): Draft→Submit; Submitted→Commit; Committed/Partial→Fulfill All (if reserved) else Commit or Reserve All.
- **⋮ menu**: Refresh, Release All, Commit (strict), optional Close/Cancel.
- **Lines card**: collapsible; totals in subtitle; per-line quick action (Fulfill 1 if reserved>0 else Reserve 1 if back>0) + line ⋮ (Reserve/Release/Fulfill N, Qty +/−, Remove).
- **Badges**: **read-only** pills (Reserved / Fulfilled / Backordered).
- **Scanner panel**: collapsible, default closed.
- **Backorder banner**: collapsible; auto-open on shortages.

## 4) Hydration & state
- Hydrate on mount and after actions via `/objects/{type}/{id}`.
- Auto-refresh silently after commit/reserve/release/fulfill.
- Validate line qty: `qty ≥ fulfilled`; if `qty < reserved + fulfilled`, prompt to release excess.

## 5) Navigation & workspace
- Stack params: `{ id?, mode?, expandScanner? }`.
- (Optional) `WorkspaceProvider` stores `workspaceId`; include it in list/search calls and in create/update bodies.

**Navigation route names** (from `apps/mobile/src/navigation/types.ts`):
- Parties: `PartyList`, `PartyDetail`
- Inventory: `InventoryList`, `InventoryDetail`
- Products: `ProductsList`, `ProductDetail`
- Purchasing: `PurchaseOrdersList`, `PurchaseOrderDetail`
- Sales: `SalesOrdersList`, `SalesOrderDetail`
- Backorders: `BackordersList`
- Resources: `ResourcesList`, `ResourceDetail`
- Events: `EventsList`, `EventDetail`
- Routing: `RoutePlanList`, `RoutePlanDetail`
- Workspaces: `WorkspaceHub`
- Reservations: `ReservationsList`, `ReservationDetail`, `CreateReservation`, `EditReservation`
- Registrations: `RegistrationsList`, `RegistrationDetail`
- Dev: `DevTools`

## 6) Feature Flags

Mobile feature flags (from `apps/mobile/src/features/_shared/flags.ts`):

| Flag | Env Variable | __DEV__ Override | Default | Usage |
|------|--------------|------------------|---------|-------|
| `FEATURE_REGISTRATIONS_ENABLED` | `EXPO_PUBLIC_FEATURE_REGISTRATIONS_ENABLED` | No | `false` | Registrations tile + sections |
| `FEATURE_RESERVATIONS_ENABLED` | `EXPO_PUBLIC_FEATURE_RESERVATIONS_ENABLED` | Yes (`true`) | `false` | Reservations tile + create/edit |
| `FEATURE_PO_QUICK_RECEIVE` | _(hardcoded)_ | No | `true` | PO "Receive All" button |

**Note:** Views and Events have no mobile-side flags (backend-controlled only via permissions + backend flags).

## 6) Actions helpers
**Sales Orders**
```ts
export type LineDelta = { lineId: string; deltaQty: number; lot?: string; locationId?: string };
export const so = {
  submit:  (id: string) => apiClient.post(`/sales/so/${id}:submit`, {}),
  commit:  (id: string, opts?: { strict?: boolean }) => apiClient.post(`/sales/so/${id}:commit`, opts?.strict ? { strict: true } : {}),
  reserve: (id: string, lines: LineDelta[]) => apiClient.post(`/sales/so/${id}:reserve`, { lines }),
  release: (id: string, lines: LineDelta[]) => apiClient.post(`/sales/so/${id}:release`, { lines }),
  fulfill: (id: string, lines: LineDelta[]) => apiClient.post(`/sales/so/${id}:fulfill`, { lines }),
};
Purchasing (mirror)
export type PoReceiveLine = { lineId: string; deltaQty: number; lot?: string; locationId?: string };
export const po = {
  submit:  (id: string) => apiClient.post(`/purchasing/po/${id}:submit`, {}),
  approve: (id: string) => apiClient.post(`/purchasing/po/${id}:approve`, {}),
  receive: (id: string, lines: PoReceiveLine[]) => apiClient.post(`/purchasing/po/${id}:receive`, { lines }),
  cancel:  (id: string) => apiClient.post(`/purchasing/po/${id}:cancel`, {}),
  close:   (id: string) => apiClient.post(`/purchasing/po/${id}:close`, {}),
};
Events & Resources
export const registrations = {
  cancel:   (id: string) => apiClient.post(`/events/registration/${id}:cancel`,  {}),
  checkin:  (id: string) => apiClient.post(`/events/registration/${id}:checkin`, {}),
  checkout: (id: string) => apiClient.post(`/events/registration/${id}:checkout`,{}),
};
export const reservations = {
  cancel: (id: string) => apiClient.post(`/resources/reservation/${id}:cancel`, {}),
  start:  (id: string) => apiClient.post(`/resources/reservation/${id}:start`,  {}),
  end:    (id: string) => apiClient.post(`/resources/reservation/${id}:end`,   {}),
};
7) Conventions

File naming: api.ts for CRUD, <module>Actions.ts for RPCs, *Screen.tsx for screens.

UX: chevrons collapse; ⋮ for actions; badges are not buttons.

After every action: re-hydrate; show a light toast if notable.

Keep smoke parity with backend guardrails.

## Aligned Addenda — Tier 1 Canonical Model (Frontend)

### Pickers & Lists (role-filtered Party views)
- **Customers** = Party where role=customer (label can read “Customer” or “Client” in context).
- **Vendors** = Party where role=vendor.
- **Employees** = Party where role=employee.
- **Bidders/Lessors/Lessee** as needed by module.

**UI conventions**
- Show **chips** for all roles on Party rows (“Acme — customer, vendor”).
- Inline action: “+ Add role” creates a PartyRole without leaving the screen.
- Deduping: if email/registry exists, route to existing Party (UNIQ# match).

### Orders
- **SO** detail uses **PartyPicker(role=customer)** for `customerId`.
- **PO** detail uses **PartyPicker(role=vendor)** for `vendorId`.
- When a Party is picked, pull defaults from **CustomerAccount/VendorAccount** (terms, price list, remit-to/bill-to) into the order draft.

### Labor & Staffing UI
- **Event detail → Staff tab**: list **EventStaffAssignment**, add/edit shifts, rate overrides, cost category.
- **Timesheets**: “My Entries” (LaborEntry), **Approvals** (manager view), **Payroll Batches** (create/approve/post).
- Posting feedback: toast with JE id/summary after batch post (dev builds).

### Leasing UI
- **Facilities/Resources → Leases** list with status (draft/active/terminated/expired).
- **Lease detail**: resources, term, charge schedule, deposit. “Run Billing” (dev-only) triggers **LeaseBillingRun** and shows generated documents.

### Auctions UI
- Allow selecting our **Tenant Party** as a bidder in dev; badge/alert when self-related per **RelatedPartyRule**.
- Settlement screen shows AR/AP created; if auto-offset enabled, show clearing entry reference.

### Navigation & State
- Keep role-filtered pickers as thin wrappers over the Parties endpoint.
- Use focus-refetch hooks on detail→list returns so status badges & totals update.
- Keyboard behavior: dismiss on navigate; preserve filter text unless an explicit reset is triggered.

### Web Development Proxy (CORS-Free Local Dev)

**Location:** [apps/web/vite.config.ts](../apps/web/vite.config.ts)

To eliminate CORS preflight requests during local development, use the Vite dev server proxy:

```bash
# apps/web/.env
VITE_API_BASE=/api
VITE_API_PROXY_TARGET=https://ki8kgivz1f.execute-api.us-east-1.amazonaws.com
```

**How it works:**
- Vite proxies `/api/*` → API Gateway
- Browser makes same-origin requests (no OPTIONS preflight)
- Faster dev experience, cleaner network logs

**Verification:**
```bash
cd apps/web
npm run dev
# Open http://localhost:5173
# DevTools → Network: Zero OPTIONS requests ✓
```

**For direct API testing** (with CORS):
```bash
VITE_API_BASE=https://ki8kgivz1f.execute-api.us-east-1.amazonaws.com
```

See [apps/web/README.md](../apps/web/README.md) for complete configuration guide.

**List-page enrichment:** When enriching rows with vendor/party names, use the batching helper in [apps/web/src/lib/concurrency.ts](../apps/web/src/lib/concurrency.ts) and avoid unbounded `Promise.all(...apiFetch...)` fan-out to prevent burst-related 503s.

- Lease Billing Run
- Auction self-bid smoke
