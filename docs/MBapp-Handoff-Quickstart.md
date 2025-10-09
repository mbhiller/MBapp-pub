
MBapp Handoff Quickstart

Short doc to paste into a new chat so development can continue seamlessly.

One-liner

We’re building MBapp: a modular ops system (Sales, Purchasing, Inventory, Products, Events/Resources) with a TypeScript Lambda API and a React Native mobile client. Auth is Bearer + tenant headers; actions are clean RPC endpoints (submit/commit/reserve/…); UI is card-based with collapsible sections and a single primary CTA per screen.

Repos / Paths

Backend: apps/api (Lambda, single router in src/index.ts, module handlers under src/<module>).

Mobile: apps/mobile (feature-first folders under src/features, screens under src/screens).

Must-know conventions

Tenant header: send both X-Tenant-Id and x-tenant-id.

Auth: Bearer; mobile re-logins in dev with /auth/dev-login if 401.

Objects vs Actions: CRUD via /objects/{type}; domain actions via /sales/so/{id}:commit-style RPCs.

Inventory math: available = onHand − reserved. Fulfill reduces both onHand and reserved.

UI: Header card is always visible (Edit→Save). Lines & Scanner are collapsible. Badges are read-only. Actions live under ⋮.

Where to look

Backend entrypoint maps Sales/Purchasing/Inventory/Events/Scanner/Tools in apps/api/src/index.ts.

Frontend client lives at apps/mobile/src/api/client.ts.

Feature pattern: features/<module>/api.ts + <module>Actions.ts + <Module>DetailScreen.tsx.

Smokes you can run
node ops/smoke.mjs smoke:salesOrder:reserve --stock 5 --qty 3 --code res --strict 1
node ops/smoke.mjs smoke:salesOrder:fulfill --stock 5 --qty 3 --code ful --strict 1
node ops/smoke.mjs smoke:salesOrder:release --stock 5 --qty 3 --release 2 --code sorel
node ops/smoke.mjs smoke:salesOrder:flow    --lines 3 --qty 1 --code so
node ops/smoke.mjs smoke:salesOrder:backorder
node ops/smoke.mjs smoke:purchaseOrder:flow --lines 3 --qty 2 --code po
node ops/smoke.mjs smoke:reservation:flow   --code resv --durationMin 60
node ops/smoke.mjs smoke:scanner:basic      --count 3
node ops/smoke.mjs smoke:reports:product-links --limit 500
Handy snippets

Sales actions (mobile)
export type LineDelta = { lineId: string; deltaQty: number; lot?: string; locationId?: string };
export const so = {
  submit:  (id: string) => apiClient.post(`/sales/so/${id}:submit`, {}),
  commit:  (id: string, opts?: { strict?: boolean }) => apiClient.post(`/sales/so/${id}:commit`, opts?.strict ? { strict: true } : {}),
  reserve: (id: string, lines: LineDelta[]) => apiClient.post(`/sales/so/${id}:reserve`, { lines }),
  release: (id: string, lines: LineDelta[]) => apiClient.post(`/sales/so/${id}:release`, { lines }),
  fulfill: (id: string, lines: LineDelta[]) => apiClient.post(`/sales/so/${id}:fulfill`, { lines }),
};
PO actions (mobile)
export const po = {
  submit:  (id: string) => apiClient.post(`/purchasing/po/${id}:submit`, {}),
  approve: (id: string) => apiClient.post(`/purchasing/po/${id}:approve`, {}),
  receive: (id: string, lines: { lineId: string; deltaQty: number }[]) => apiClient.post(`/purchasing/po/${id}:receive`, { lines }),
  cancel:  (id: string) => apiClient.post(`/purchasing/po/${id}:cancel`, {}),
  close:   (id: string) => apiClient.post(`/purchasing/po/${id}:close`, {}),
};
Hand off sentence you can paste

“Let’s keep developing. Backend is a single Lambda router with module handlers; actions use RPC paths like /sales/so/{id}:commit. Mobile uses a canonical api/client.ts, separates CRUD (api.ts) from action RPCs (<module>Actions.ts), and screens follow a card layout: header Edit/Save, a single primary CTA, and a ⋮ menu, with Lines/Scanner collapsible. Inventory math is available = onHand − reserved. Smokes validate Sales, Purchasing, Reservations, and Scanning.”
