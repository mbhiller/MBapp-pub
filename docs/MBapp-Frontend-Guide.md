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
- Dual tenant headers; Bearer handling; dev auto-login on 401.
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
