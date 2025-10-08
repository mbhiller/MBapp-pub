
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
