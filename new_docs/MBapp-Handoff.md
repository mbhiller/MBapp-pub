# Update — 2025-10-08 21:25 UTC

**Current branch:** `feat/scanner-rfid-v1` (from `feat/sprint-scanning-epc`)

## Accomplished This Sprint (Scanner/RFID v1)
- **Reusable ScannerPanel** in `_shared` with:
  - Collapsed header (barcode icon left, chevron right)
  - Expanded action pills: **Add Line / Receive / Pick / Count** (+ `extraModes` per module)
  - Manual input with **camera toggle adornment**; inline non-blocking **toasts**
  - Auto **scanner session** lifecycle when expanded in action modes
- **Smart Pick** mode (when `soId` present): resolve EPC → choose eligible line → `:reserve(1)` → scanner `pick`
- **SalesOrderDetailScreen**: scanner card at top; collapsed by default; camera hidden until toggled
- **Shared utilities** (`apps/mobile/src/features/_shared`):
  - `Toast.tsx` — `ToastProvider` / `useToast()`
  - `epc.ts` — `resolveEpc(epc)` via `/epc/resolve`
  - `useScannerSession.ts` — session start/stop hook
- **Ops Smokes**:
  - `smoke:scanner:pick` (happy path)
  - `smoke:scanner:guardrails` (expected 409s)
  - **`smoke:scanner:smartpick`** — **receive → commit → reserve → pick** ✅ PASS

## What Carries Forward (from prior sprint) — Schemas & Paths (Condensed)
- **ObjectBase** (server): required → `id`, `tenantId`, `createdAt`, `updatedAt`; optional → `metadata` (free-form)
- **Key endpoints**
  - `GET /epc/resolve?epc=...` → `{ itemId, status? }`
  - `POST /scanner/sessions` → `{ op: "start" | "stop", sessionId? } → { id }`
  - `POST /scanner/actions` → `{ sessionId, epc, action: "receive" | "pick" | "count", fromLocationId?, toLocationId? }`
  - Sales Orders:
    - `POST /sales/so/:id:commit`
    - `POST /sales/so/:id:reserve` → `{ lines: [{ lineId, deltaQty }] }`
    - (Fulfill exists; guardrails enforce counters)
- **Idempotency Keys**
  - Receive: `scan-{epc}`
  - Smart Pick reserve: `sprsv-{soId}-{lineId}-{epc}`

## Known Issues / Next
- SalesOrdersList: **New → Back** should not auto-save a draft (add confirm discard; persist on Save only)
- Extract `_shared/api.ts` for idempotency helpers + error normalization
- Memoize small UI atoms; add unit tests with mocked `apiClient`



# 🧭 MBapp Development Handoff Summary
**Updated:** 2025-10-08  
**Branch:** `feat/sprint5-100825`  
**Sprint Focus:** Sales Order Release & Backorder Flow · Smoke Validation · Schema Alignment  
**Environment:** API (`apps/api`) · Mobile (`apps/mobile`) · Ops (`ops/smoke.mjs`, PowerShell)

---

## 🗺️ Roadmap Position
- Phase 1 (Foundations & Ops) **✅ Complete**
- Currently executing **Core Business Operations** → finalize **Release/Backorder** lifecycle
- Next up: **Views & Workspaces v1**, **Scanner/RFID v1**, **Help Desk/Tutorials v1**

**Active Core Modules**
| Module | Status | Notes |
|---|---|---|
| Products & Inventory | ✅ Stable | Unified counters: `onHand`, `reserved`, `available` |
| Purchase Orders | ✅ Stable | Idempotent receive; returns; partials |
| Sales Orders | ⚙️ Active | Commit · Reserve · **Release** · Fulfill; backorder rollups |
| Reporting | 🚧 Planned | `/reports/so-summary` (line-level rollup) |

---

## ✅ Recent Progress (Since last session)
**Backend**
- Guardrail smokes passing: **PO idempotency**, **SO over‑commit/over‑fulfill**.
- New smoke scaffolds: `smoke:salesOrder:release`, `smoke:salesOrder:commit-backorder`.
- Lifecycle refactor: strict delta enforcement for reserve/release; backorder rollup defined.
- Inventory counters normalized everywhere to `{ onHand, reserved, available }`.

**Mobile**
- Hydration stable: `useQuery(getObject)` + cache; **`useRefetchOnFocus()`** wired for return-to-list freshness.
- Screens aligned with generated types (from `spec/MBapp-Modules.yaml`).
- Sales Order actions hooked for Commit/Reserve/Fulfill; Release button pending.

**DevOps**
- `ops/smoke.mjs` extended for partial reserve/release scenarios.
- Env pattern consistent: `$env:MBAPP_API_BASE`, `$env:MBAPP_BEARER`.
- CI checks green on apps/api + apps/mobile (build + lint).

---

## 🧩 Architecture Quick‑Ref (to keep code aligned)

### API (`apps/api`)
- **Index Router (`src/index.ts`)** dynamically mounts module routes (object folders export `routes`/`handlers`).  
- **Actions** are idempotent and named `:commit | :reserve | :release | :fulfill`.  
- **Auth/Tenant** via middleware util; all writes are tenant‑scoped; optimistic concurrency on counters.  
- **Objects** carry `{ pk, sk, tenantId, updatedAt }`; report endpoints are computed (not stored).

### Mobile (`apps/mobile`)
- **Screen pattern:** List → Detail → Shared `FormScreen`.
- **Hydration:** `useQuery` → `getObject(id)`; never re‑shape server responses locally.
- **Focus refresh:** `useRefetchOnFocus(load, [id])` on detail/list; avoids manual pull‑to‑refresh.
- **Types:** Generated from OpenAPI (`MBapp-Modules.yaml`); consume `components["schemas"]`.
- **Shared UI/hooks:** `useColors`, `useSafeQuery`, `Fab`, `FormScreen`, `useFocus`.

### Shared Principles
- **Smokes first:** encode edge cases and idempotency into `ops/smoke` before UI polish.
- **Spec‑driven dev:** update `MBapp-Modules.yaml` → regen API & mobile types → then wire screens.
- **Status enums unified:** `draft → submitted → committed → partially_fulfilled → fulfilled → closed/cancelled`.
- **Naming:** pluralized screens (`SalesOrdersListScreen`, `PurchaseOrdersListScreen`); actions as verbs.

---

## ⚙️ Developer Optimization Guidelines
1. **Single Source of Truth:** schemas in `MBapp-Modules.yaml` drive codegen for API & Mobile.  
2. **Hydrate, don’t re‑shape:** keep server objects intact; present with view helpers only.  
3. **Focus‑based fetch:** prefer `useRefetchOnFocus` over ad‑hoc refresh logic.  
4. **Idempotency everywhere:** include Idempotency‑Key on receives/fulfills; design smokes accordingly.  
5. **Type parity on PRs:** regenerated types must be committed with backend changes.  
6. **Rollups are computed:** avoid persisting totals beyond counters needed for performance.  
7. **Uniform UX:** actions (Commit/Reserve/Release/Fulfill) share labels, toasts, and metadata feedback.

---

## 🚀 Next Steps (Actionable)
1. **API:** Implement `POST /sales/so/{id}:release` (or allow negative `deltaQty` on `:reserve` with strict guard).  
2. **Rollups:** Maintain per‑line: `qtyReserved`, `qtyFulfilled`, `qtyBackordered = max(0, qty - reserved - fulfilled)`; recompute on `:reserve`, `:commit`, `:fulfill`.  
3. **Smokes:** Run/finish  
   - `smoke:salesOrder:release` (reserve → release → counters baseline; partial release coverage)  
   - `smoke:salesOrder:commit-backorder` (low stock → commit → backordered lines)  
4. **Types:** Regenerate API/mobile types; ensure `SalesOrderLine` includes `itemId` and rollup fields.  
5. **Mobile:** Add **Release** action to Sales Order detail; surface per‑line counters (via `/inventory/{itemId}/onhand`).  
6. **Optional:** Add `smoke:reports:so-summary --id <soId>` to print line rollups for verification.

---

## 🔮 Forward Outlook
- **Views & Workspaces v1:** Saved views, workspace cards, cross‑module filters.  
- **Scanner/RFID v1:** EPC registry; contextual actions; offline queue; device profiles.  
- **Help Desk/Tutorials v1:** coachmarks, in‑app tickets, release notes panel.  
- **Management & Projects v1:** task boards, automation rules, Slack/Teams bridge.

---

**Paste the section below at the start of your next chat:**

> Continuing MBapp development.  
> Branch: `feat/sprint5-100825`  
> Focus: Sales Order **Release & Backorder** lifecycle (API + smokes + mobile).  
> Status: guardrail smokes passing; release endpoint pending; rollup fields defined.  
> Next: implement `:release`, run `smoke:salesOrder:release` + `commit-backorder`, regen types, add Release action to mobile.


## Ops / Smoke Commands (Scanner)

PowerShell:
```powershell
if (Test-Path ops\.env.ps1) { . .\ops\.env.ps1 }
node ops\smoke.mjs smoke:scanner:pick --qty 1
node ops\smoke.mjs smoke:scanner:guardrails --qty 1
node ops\smoke.mjs smoke:scanner:smartpick
```

---

## ▶ Next Steps — Sprint feat/sprint-100825 (2025-10-08 21:31 UTC)

### Branching & Ritual
- Create branch from current head:
  ```powershell
  git checkout -b feat/sprint-100825
  git push -u origin feat/sprint-100825
  ```
  git add -A
  git commit -m "wip: feat/sprint-100825 <scope>: <summary>"
  git push
  ```

### Backorder Feature (Priority)
- **API — Commit allows backorder** (`POST /sales/so/:id:commit`)
  - Change from hard 409 on shortage to: reserve what’s available, compute `qtyBackordered` per line.
  - Return `200` with `shortages[]` informational payload; keep `status="committed"`, set `metadata.hasBackorder=true` if any.
  - Keep strict mode via `?strict=true` to preserve current behavior on demand.
- **API — Reserve decrements backorder** (`POST /sales/so/:id:reserve`)
  - On a successful reserve, decrement `line.qtyBackordered` by the reserved amount (min with current backorder).
- **Mobile — SalesOrderDetail UI**
  - Show per-line badges: `Reserved: N`, `Backordered: M`.
  - Add “Reserve Next” quick action when `Backordered > 0` (calls `:reserve` 1).
  - Smart Pick already fills backorder (resolve → reserve(1) → pick) when stock is available.
- **Ops — Smokes**
  - `smoke:so:commit-backorder` — expect 200 with `shortages`, `qtyBackordered>0`.
  - `smoke:so:fill-backorder` — receive 1 → reserve 1 → verify `qtyBackordered` decreases.
  - `smoke:so:auto-smartpick-fills` — receive → smartpick once → verify backorder decrements & fulfill increments.

### Quality & Infra
- **Shared `_shared/api.ts`**: idempotency helpers, error normalization.
- **ScannerPanel polish**: memoize small atoms; disable primary while scanning; add tiny delta details to success toasts.
- **SalesOrdersList bug**: prevent draft creation on “New → Back” (confirm discard; only persist on Save).
- **Unit tests**: mock `apiClient` for ScannerPanel flows; add API contract tests for commit/reserve backorder logic.
- **Docs**: update this handoff with backorder spec & smoke outputs after implementation.

### Acceptance Criteria
- Committing with insufficient stock returns `200` and records backorders (no 409 in default mode).
- Reserving successfully reduces `qtyBackordered` and increases reserved counters (guardrails intact).
- Smart Pick converts available stock into picked units even when lines were previously backordered.
- New smokes PASS reliably in CI and locally.


