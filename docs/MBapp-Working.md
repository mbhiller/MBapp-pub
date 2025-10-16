# MBapp-Working.md
*(Updated after completion of Sprint A — Parties Foundation)*

---

## 🧭 Project Context

MBapp is a modular, multi-tenant business management platform built on:

- **Backend** — AWS Lambda + API Gateway + DynamoDB (OpenAPI contract-first)
- **Front-end** — React Native (Expo) & React Web (Vite)
- **Spec Source of Truth** — `spec/MBapp-Modules.yaml`
- **Infra** — Terraform (state in S3 + DDB locks)
- **Automation** — PowerShell tooling (`ops/Set-MBEnv.ps1`, smoke tests)
- **Development Philosophy** — Vertical-slice, contract-first, smoke-validated.

---

## ✅ Sprint A — Parties Foundation (COMPLETE)

### Goal
Introduce the new **Parties / Party Roles** domain and migrate customer/vendor logic to a unified Party model while cleaning and stabilizing shared mobile/infra code.

### Key Deliverables
| Area | Status | Notes |
|------|:------:|-------|
| **Schema** | ✅ | Added `Party`, `PartyRole`, `PartyLink`, `PartyAddress`, `PartyContact` to `MBapp-Modules.yaml`. |
| **Policy / Permissions** | ✅ | `party:read` & `party:write` added and granted to dev roles. |
| **Router Hardening** | ✅ | Added `shared/ctx.ts` to build typed `ctx` (tenantId, userId, roles, policy, idempotencyKey, requestId).<br> Added `"Accept"` to CORS headers.<br> Ctx attached automatically in router. |
| **Shared Components** | ✅ | `PartyPicker`, `LineEditor`, `ItemSelectorModal`, and upgraded `FormScreen` now centralized under `features/_shared/`. |
| **Hooks** | ✅ | `useRefetchOnFocus` unified (accepts array or object). |
| **Auth / Env / CI** | ✅ | `ops/Set-MBEnv.ps1` rebuilt — sets full env, performs dev-login, exports `MBAPP_BEARER`, runs smokes. |
| **Smokes** | ✅ | `smoke:ping` and `smoke:parties:happy` passing. |
| **Docs** | ✅ | This working doc replaces previous version. |

### Structural Notes
- **Objects API** remains the canonical CRUD entry point (`/objects/:type[/search|/:id]`).
- **Action routes** (`/sales/so/:id:reserve` etc.) remain distinct for workflow verbs.
- **Router** now injects a typed context; handlers can import `getCtx(event)` or `requireIdempotency(event)` when needed.
- **FormScreen** now renders an inline header with `title`, `onSave`, and `onBack`.
- **All “customer/vendor” components** migrated or queued for deletion; new PartyPicker replaces them everywhere.
- **Type generation** continues from `MBapp-Modules.yaml` via OpenAPI → `generated-types.ts`.

---

## 🚧 Sprint B — Products & Inventory Core  *(IN PROGRESS)*

### Objective
Establish canonical Product and Inventory data flows as the foundation for future SO/PO, Events, and Resource logic.

### Target Duration
1 sprint ≈ 2 weeks

### Deliverables & Progress
| # | Task | Owner/Area | Status | Notes |
|:-:|------|-------------|:------:|-------|
| **1** | Finalize `Product`, `InventoryItem`, `InventoryMovement`, `InventoryCounter` schemas in `MBapp-Modules.yaml`. | Backend Spec | ⬜ | Counters derive solely from movements (`onHand`, `reserved`, `available`). |
| **2** | Regenerate API & mobile types from new spec. | Dev Tools | ⬜ | via `openapi-typescript`. |
| **3** | Build backend guard utilities `assertCanReserve/Commit/Fulfill/Receive`. | Backend Core | ⬜ | Used by SO/PO actions in next sprint. |
| **4** | Implement `/inventory/onhand`, `/inventory/onhand:batch`, `/inventory/movements` handlers to compute from movements. | Backend Core | ⬜ | Replace any direct counter updates. |
| **5** | Add idempotency enforcement to all movement-creating actions. | Backend Core | ⬜ | Use `requireIdempotency(event)`. |
| **6** | Create **Inventory Stock Card** React Native screen (summary view + counters). | Mobile UI | ⬜ | Styled like SO/PO detail cards; uses hydration on focus. |
| **7** | Integrate **ItemSelectorModal** into SO/PO LineEditor add/edit flows. | Mobile UI | ⬜ | Leverages shared `searchObjects`. |
| **8** | Write & validate smokes: `smoke:inventory:guards`, `smoke:inventory:onhand`. | Ops / QA | ⬜ | Receive → reserve/commit → fulfill → assert counters. |
| **9** | Add inventory smokes to CI matrix. | DevOps | ⬜ | Continue using bearer from Set-MBEnv. |
| **10** | Update this working doc + close sprint review. | PM / All | ⬜ | Include screenshots + smoke logs. |

### Notes for Developers
- **Movement-based accounting** replaces any direct counter mutation.
- **Idempotency-Key** required for every POST/PUT that changes movement state.
- **Guards** live in `/apps/api/src/inventory/guards.ts`.
- **Inventory Stock Card** consumes `/inventory/onhand` and `/inventory/movements`.

---

## 🧩 Sprint C — SO / PO Refactor (Upcoming)

### Objective
Refactor Sales Order (SO) and Purchase Order (PO) modules to align with the new Parties + Inventory foundations.

### Tentative Scope
| Area | Deliverable |
|-------|--------------|
| **Schema** | Orders reference `partyId` (+role), `lines[].itemId`, `lines[].qty`, `lines[].price`. |
| **Status Guards** | Shared util controlling transitions: `draft → submitted → approved → committed/received → closed/cancelled`. |
| **Actions** | `/sales/so/:id:(reserve|commit|fulfill|cancel|close)` and `/purchasing/po/:id:(submit|approve|receive|cancel|close)` rebuilt with new guards + idempotency. |
| **Mobile** | Unified SO/PO Detail screens with shared LineEditor + ItemSelectorModal; PartyPicker used for customer/vendor. |
| **Smokes** | `smoke:orders:so:happy`, `smoke:orders:po:happy`. |
| **CI** | Add both order smokes to workflow. |

---

## 🧱 Structural Direction Going Forward

1. **Router Table Registry** — next sprint convert the regex blocks into a declarative table for easy slice registration.  
2. **Ctx Object** — already stable; all new handlers should read `getCtx(event)` for tenant/user/idempotency.  
3. **Contract-First Discipline** — always update `MBapp-Modules.yaml` before coding.  
4. **Vertical Slices** — every sprint adds a full vertical (spec → backend → mobile → smokes → CI).  
5. **Smoke Coverage** — each feature merged only after its smoke passes locally and in CI.  
6. **Code Gen & Consistency** — use generated types; avoid inline any; re-use shared components.  

---

## 📅 Current Status Summary
| Sprint | Theme | Status | Next |
|:------:|:------|:------:|:-----|
| **A** | Parties Foundation | ✅ Complete | Freeze and document |
| **B** | Products & Inventory Core | 🚧 Starting | Define schemas + build guards |
| **C** | SO/PO Refactor | 🕓 Next | Implement new order flows |

---

### Quick Commands Reference

```powershell
# Bootstrap & login
.\ops\Set-MBEnv.ps1 -Login -Show

# Verify auth
.\ops\Set-MBEnv.ps1 -TestAuth

# Run smokes
.\ops\Set-MBEnv.ps1 -Smoke "smoke:ping"
.\ops\Set-MBEnv.ps1 -Smoke "smoke:parties:happy"

# After Sprint B schema changes
pnpm -w -r tsc --noEmit
node ops/smoke/smoke.mjs smoke:inventory:guards
node ops/smoke/smoke.mjs smoke:inventory:onhand
