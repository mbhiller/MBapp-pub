# Spec ↔ Implementation Delta Report

**Scope:** Compare [spec/MBapp-Modules.yaml](../spec/MBapp-Modules.yaml) endpoints and schemas vs. [apps/api/src/](../apps/api/src/) implementation.  
**As of:** December 20, 2025 (Sprint IV end)  
**Status:** READ-ONLY analysis; no changes recommended here.

---

## 1. Endpoints in SPEC but Missing in CODE

### Registrations CRUD (✅ SPRINT IV — NOW IMPLEMENTED)
| Endpoint | Method | Expected | Status |
|:---------|:-------|:---------|:-------|
| `/registrations` | GET | listRegistrations | ✅ **IMPLEMENTED** (Sprint IV) |
| `/registrations` | POST | createRegistration | ✅ **IMPLEMENTED** (Sprint IV) |
| `/registrations/{id}` | GET | getRegistration | ✅ **IMPLEMENTED** (Sprint IV) |
| `/registrations/{id}` | PUT | replaceRegistration | ✅ **IMPLEMENTED** (Sprint IV) |
| `/registrations/{id}` | DELETE | deleteRegistration | ✅ **IMPLEMENTED** (Sprint IV) |

**Evidence (Sprint IV):**  
- Spec: lines 2815–2975 (5 endpoints: POST/GET /registrations, GET/PUT/DELETE /registrations/{id})  
- Code: [apps/api/src/registrations/](../apps/api/src/registrations/) (list.ts, create.ts, get.ts, update.ts, delete.ts)  
- Routing: [apps/api/src/index.ts](../apps/api/src/index.ts) lines 223–236 (feature-flagged via FEATURE_REGISTRATIONS_ENABLED)  
- Smoke tests: `smoke:registrations:crud`, `smoke:registrations:filters` — both PASS  
- **Status:** ✅ Fully implemented; feature-flagged (default OFF); no deltas

### Views CRUD (Full lifecycle missing)
| Endpoint | Method | Expected | Status |
|:---------|:-------|:---------|:-------|
| `/views/{id}` | GET | getView | ⚠️ **NOT IMPLEMENTED** |
| `/views/{id}` | PUT | replaceView | ⚠️ **NOT IMPLEMENTED** |
| `/views/{id}` | PATCH | updateView | ⚠️ **NOT IMPLEMENTED** |
| `/views/{id}` | DELETE | deleteView | ⚠️ **NOT IMPLEMENTED** |
| `/views` | POST | createView | ⚠️ **NOT IMPLEMENTED** |

**Evidence:**  
- Spec defines 5 endpoints for `/views` at lines 2250–2447  
- [apps/api/src/index.ts](../apps/api/src/index.ts) only routes `GET /views` → `ViewsList.handle()`
- Missing handlers: `views/get.ts`, `views/create.ts`, `views/update.ts`, `views/patch.ts`, `views/delete.ts`
- Sprint III scope includes these; currently listed as "OUT OF SCOPE" stubs

### Workspaces CRUD (Full lifecycle missing)
| Endpoint | Method | Expected | Status |
|:---------|:-------|:---------|:-------|
| `/workspaces/{id}` | GET | getWorkspace | ⚠️ **NOT IMPLEMENTED** |
| `/workspaces/{id}` | PUT | replaceWorkspace | ⚠️ **NOT IMPLEMENTED** |
| `/workspaces/{id}` | PATCH | updateWorkspace | ⚠️ **NOT IMPLEMENTED** |
| `/workspaces/{id}` | DELETE | deleteWorkspace | ⚠️ **NOT IMPLEMENTED** |
| `/workspaces` | POST | createWorkspace | ⚠️ **NOT IMPLEMENTED** |

**Evidence:**  
- Spec defines 5 endpoints at lines 2446–2634  
- [apps/api/src/index.ts](../apps/api/src/index.ts) only routes `GET /workspaces` → `WsList.handle()`
- Missing handlers analogous to Views  
- Sprint III scope

### Inventory Adjustment
| Endpoint | Method | Expected | Status |
|:---------|:-------|:---------|:-------|
| `/inventory/{id}/adjust` | POST | Create inventory adjustment (movement) | ⚠️ **NOT IMPLEMENTED** |

**Evidence:**  
- Spec defines at line 2735: POST /inventory/{id}/adjust; create movement via InventoryAdjustmentRequest  
- No handler in [apps/api/src/inventory/](../apps/api/src/inventory/)  
- **Note:** Movements are created indirectly (e.g., SO fulfill → movements). Direct adjust endpoint missing.

### Deprecated Endpoints (in spec, not routed)
- `/purchase-orders/{id}/receive-line` (POST) — marked deprecated in spec; no route in code  
- `/sales-orders/{id}/fulfill-line` (POST) — marked deprecated in spec; no route in code  
- **Status:** Both are OK to ignore (deprecated); multi-line receive/fulfill is preferred

### Events & Resources Actions (Not in scope yet, Tier 2)
| Endpoint | Method | Tier |
|:---------|:-------|:-----|
| `/events/registration/{id}:cancel` | POST | Tier 2.0 |
| `/events/registration/{id}:checkin` | POST | Tier 2.0 |
| `/events/registration/{id}:checkout` | POST | Tier 2.0 |
| `/resources/reservation/{id}:cancel` | POST | Tier 2.0 |
| `/resources/reservation/{id}:start` | POST | Tier 2.0 |
| `/resources/reservation/{id}:end` | POST | Tier 2.0 |

**Status:** Out of scope (Sprint III). Not yet implemented.

### Admin Audit
| Endpoint | Method | Expected | Status |
|:---------|:-------|:---------|:-------|
| `/admin/audit` | GET | Retrieve audit log | ❌ **NOT IMPLEMENTED** |

**Evidence:** Spec line 3479 defines endpoint but no handler exists.

---

## 2. Endpoints in CODE but Missing/Underspecified in SPEC

### Generic Objects Sub-endpoints (Spec vs. Route mismatch)
**Spec defines:**
- `/objects/{type}/list` (GET) — line 2110
- `/objects/{type}/search` (GET) — line 2134

**Code implements:**
- `/objects/:type` (GET) — routes to list  
- `/objects/:type/search` (POST) — routes to search

**Gap:**  
- Spec shows `/objects/{type}/list` as separate GET endpoint  
- Code merges list into `/objects/{type}` GET  
- Spec shows `/objects/{type}/search` as GET; code uses POST  
- **Evidence:** [apps/api/src/index.ts](../apps/api/src/index.ts) lines 377–390

### PO & SO Suggest/Create endpoints underspecified
| Endpoint | Spec Detail | Code Implementation | Gap |
|:---------|:-----------|:-------------------|:----|
| `/purchasing/po:create-from-suggestion` | POST; accepts draft\|drafts | [po-create-from-suggestion.ts](../apps/api/src/purchasing/po-create-from-suggestion.ts) | Spec uses `oneOf` (draft XOR drafts); code accepts both seamlessly + returns `{ id?, ids[] }` ✓ |

**Status:** Implementation matches spec intent; spec could clarify response structure clarity.

---

## 3. Schema & Field Mismatches

### A. InventoryMovement (misaligned canonical action field)

**Spec schema** (line 704):
```yaml
properties:
  action:
    type: string
    enum: [receive, reserve, commit, fulfill, adjust, release]
```

**Code type** ([inventory/movements.ts](../apps/api/src/inventory/movements.ts) line 32):
```typescript
const ACTIONS = ["receive","reserve","commit","fulfill","adjust","release"] as const;
type Action = typeof ACTIONS[number];
```

**Issue:**  
- Spec & code agree on actions ✓  
- However, creation uses inconsistent payloads: some use `{ type: "receive", qty: 3 }` others use `{ action: "receive", qty: 3 }`  
- Smoke test [ops/smoke/smoke.mjs](../ops/smoke/smoke.mjs) lines 155–161 tries both variants with fallback logic  
- **Evidence:** `ensureOnHand()` tries 3 different payload shapes; movement creation is brittle

**Impact:** Minor; both paths work, but API contract ambiguous.

### B. PurchaseOrder & SalesOrder line key naming
**Spec schema:**
```yaml
PurchaseOrderLine:
  properties:
    id:   { type: string }           # primary identifier
    lineId: N/A                      # not in spec
SalesOrderLine:
  properties:
    id:   { type: string }           # primary identifier
    lineId: N/A                      # not in spec
```

**Code reality** ([shared/db.ts](../apps/api/src/shared/db.ts)):
```typescript
export type OrderLine = {
  id: string;        // stored key
  itemId: string;
  ...
};
```

**Handlers use both:**
- Reserve/fulfill requests expect `{ lineId: "...", deltaQty: ... }`  
- But actual line objects store `id`  
- **Evidence:** [sales/so-reserve.ts](../apps/api/src/sales/so-reserve.ts), [purchasing/po-receive.ts](../apps/api/src/purchasing/po-receive.ts)

**Impact:** Clients must map `id` ↔ `lineId` in request payloads; inconsistent naming in spec + code.

### C. View schema fields (Spec vs. unimplemented code)
**Spec schema** (line 1771):
```yaml
View:
  properties:
    id: { type: string }
    type: { enum: [view] }
    moduleKey: { type: string }       # e.g., "products", "inventory"
    filters: { type: array }          # filter objects (structure undefined)
    sort: { type: object }            # sort config
    columns: { type: array }          # column names to display
    ownerId: { type: string }
    shared: { type: boolean }
    isDefault: { type: boolean }
```

**Code:**  
- Only [views/list.ts](../apps/api/src/views/list.ts) exists (reads only)  
- No handler to validate or store View fields  
- **Impact:** Spec is aspirational; no runtime enforcement yet

### D. Workspace schema fields (incomplete in code)
**Spec schema** (line 1810):
```yaml
Workspace:
  properties:
    id: { type: string }
    type: { enum: [workspace] }
    name: { type: string }
    ownerId: { type: string }
    tiles: { type: array, items: { $ref: '#/components/schemas/WorkspaceTile' } }
    shared: { type: boolean }
    isDefault: { type: boolean }
```

**Code:** Only list implemented; no CRUD.

### E. BackorderRequest schema mismatch
**Spec** (line 191):
```yaml
BackorderRequest:
  properties:
    preferredVendorId:  { type: string, nullable: true }  # denormalized UI hint
```

**Code:** [smoke.mjs](../ops/smoke/smoke.mjs) does not populate or test this field.  
**Impact:** Field exists in spec but not exercised in smokes.

### E. BackorderRequest schema mismatch
**Spec** (line 191):
```yaml
BackorderRequest:
  properties:
    preferredVendorId:  { type: string, nullable: true }  # denormalized UI hint
```

**Code:** [smoke.mjs](../ops/smoke/smoke.mjs) does not populate or test this field.  
**Impact:** Field exists in spec but not exercised in smokes.

### F. Registration schema (✅ SPRINT IV — MATCHES)
**Spec schema** (lines 1962–2019):
```yaml
Registration:
  allOf:
    - $ref: '#/components/schemas/ObjectBase'
    - type: object
      properties:
        type: { enum: [registration] }
        eventId: { type: string }
        partyId: { type: string }
        division: { type: string, nullable: true }
        class: { type: string, nullable: true }
        status: { enum: [draft, submitted, confirmed, cancelled], default: draft }
        fees: { type: array, items: { required: [code, amount] } }
        notes: { type: string, nullable: true }
      required: [type, eventId, partyId, status]
```

**Code implementation** ([registrations/create.ts](../apps/api/src/registrations/create.ts), [registrations/update.ts](../apps/api/src/registrations/update.ts)):
- ✅ Validates required: eventId, partyId (strings)  
- ✅ Status enum: draft|submitted|confirmed|cancelled (defaults to draft)  
- ✅ Fees array validation: code (string), amount (number) required  
- ✅ Optional fields: division, class, notes  
- ✅ Stored with type="registration"

**Evidence:** Smoke tests PASS (crud + filters); no schema mismatches.

**Impact:** ✅ NONE — spec and code fully aligned.

### G. Error schema (inconsistent shape)
**Spec** (line 410):
```yaml
Error:
  properties:
    message: { type: string }
    code: { type: string, description: "stable error code" }
    details: { type: array }
```

**Code** ([common/responses.ts](../apps/api/src/common/responses.ts)):
Returns `{ message, code?, details? }` — matches spec when code is present, but many handlers return only `{ message }` without `code`.

**Sprint IV Note:**  
- Registrations handlers return error messages without consistent `code` field (matches existing pattern)  
- No regression; maintains status quo with other modules

**Evidence:**  
- Vendor guard error: returns `{ statusCode: 400, body: { code: "VENDOR_REQUIRED", message: "..." } }` ✓  
- Generic guard errors: return only `{ message }` ✗

**Impact:** Clients cannot reliably match error types by code; some endpoints missing error codes.

---

## 4. Behavior Gaps

### A. Pagination (spec vs. code)

**Spec expectations** (multiple endpoints):
- Legacy `next` cursor: opaque string
- New `pageInfo` object (optional): `{ hasNext, nextCursor, pageSize }`
- Parameters: `limit` (1–200, default 50), `next` (cursor)

**Code implementation** ([objects/list.ts](../apps/api/src/objects/list.ts), [views/list.ts](../apps/api/src/views/list.ts)):
- Returns both `next` (legacy) AND `pageInfo` (new)  
- ✓ Backward-compatible  
- ✓ Matches spec intent

**Gap in `/inventory/{id}/movements`:**
- Spec (line 2687) says optional `pageInfo` + legacy `next`  
- [inventory/movements.ts](../apps/api/src/inventory/movements.ts) implements cursor pagination but response shape could clarify `pageInfo` vs `next` precedence  
- **Minor:** Implementation is correct; documentation could be clearer

### B. Query parameters (spec vs. code)

**Views List** — Spec (line 2254) expects query params:
```yaml
- moduleKey
- ownerId
- shared (boolean)
- isDefault (boolean)
- limit, next
```

**Code** ([views/list.ts](../apps/api/src/views/list.ts)):
- Accepts all params via generic `listObjects()` repo  
- ✓ Filtering happens in repo layer
- ✓ Matches spec

**Registrations List** — Spec (lines 2826–2859) expects query params:
```yaml
- eventId (string)
- partyId (string)
- status (enum: draft|submitted|confirmed|cancelled)
- limit, next
```

**Code** ([registrations/list.ts](../apps/api/src/registrations/list.ts)):
- ✓ Supports eventId, partyId, status filters (in-memory post-query)  
- ✓ Pagination via limit + next cursor  
- ✓ Matches spec

**Inventory Movements** — Spec (line 2707) expects:
```yaml
- refId (optional; filter by source PO/SO)
- poLineId (optional; filter by PO line)
- limit, sort
```

**Code** ([inventory/movements.ts](../apps/api/src/inventory/movements.ts)):
- ✓ Supports refId & poLineId filters (lines 2707–2724)  
- ✓ Supports sort (asc/desc)

**Status:** Implementation matches spec.

### C. Auth & permissions (spec vs. code)

**Spec:**
- All endpoints require `bearerAuth`; `X-Tenant-Id` header required  
- Permissions: `view:read`, `workspace:read`, `{type}:read`/`write`, etc.

**Code** ([auth/middleware.ts](../apps/api/src/auth/middleware.ts)):
- Dev login returns hardcoded roles: `["admin"]` (TODO: parse from JWT)  
- Permission checks: `requirePerm(auth, "view:read")` etc.  
- ✓ Matches spec intent  
- **Gap:** Roles always ["admin"] in dev; real JWT parsing not implemented ([auth/policy.ts](../apps/api/src/auth/policy.ts) line 9)

### D. Idempotency (spec vs. code)

**Spec expectations:**
- Header: `Idempotency-Key` (optional)
- Duplicate requests with same key should return same response without side-effects

**Code:**
- PO receive: [purchasing/po-receive.ts](../apps/api/src/purchasing/po-receive.ts) implements via payload signature + stored state  
- SO actions: Some use Idempotency-Key; implementation varies  
- **Gap:** No centralized idempotency store; each endpoint rolls its own or relies on Idempotency-Key header  
- **Evidence:** Smoke test `smoke:po:receive-line-idem-different-key` verifies this behavior ([ops/smoke/smoke.mjs](../ops/smoke/smoke.mjs) line 489)

**Status:** Works but inconsistent; could benefit from middleware.

### E. Feature flags (spec vs. code)

**Spec:**
- Endpoints may be gated by feature flags  
- X-Feature-* headers in dev mode  
- No spec of actual gates per endpoint

**Code** ([flags.ts](../apps/api/src/flags.ts)):
- `featureVendorGuardEnabled` (env: FEATURE_ENFORCE_VENDOR_ROLE, header: X-Feature-Enforce-Vendor, default: true)  
  - Gates vendor validation on PO submit ([purchasing/po-submit.ts](../apps/api/src/purchasing/po-submit.ts))
- `featureEventsEnabled` (env: FEATURE_EVENT_DISPATCH_ENABLED, header: X-Feature-Events-Enabled, default: false)  
  - Event dispatcher plumbing (Sprint III)
- `featureEventsSimulate` (env: FEATURE_EVENT_DISPATCH_SIMULATE, header: X-Feature-Events-Simulate, default: false)  
  - Simulate mode (noop publish)
- `featureRegistrationsEnabled` **(Sprint IV)** (env: FEATURE_REGISTRATIONS_ENABLED, header: X-Feature-Registrations-Enabled, default: false)  
  - Gates all /registrations endpoints (default OFF; dev-header override in non-PROD)

**Status:** Implementation OK; spec could document which endpoints are feature-gated.

### F. CORS & OPTIONS (spec vs. code)

**Spec:**
- No explicit OPTIONS method documented

**Code** ([index.ts](../apps/api/src/index.ts) line 128-141):
- Universal preflight fast-path: OPTIONS requests return 204 immediately (before auth/routing)
- CORS headers: `Allow-Origin: *`, `Allow-Methods: GET,POST,OPTIONS,PUT,DELETE`, `Allow-Headers: *`, `Max-Age: 600`
- **Sprint AU:** Updated to status 204, simplified headers to `*`, added max-age
- ✓ Not required by spec, but essential for browser CORS compliance

**Infrastructure** ([API_GATEWAY_CORS_CONFIG.md](../infra/API_GATEWAY_CORS_CONFIG.md)):
- API Gateway (`ki8kgivz1f`) managed outside Terraform (manual configuration required)
- Recommended: Configure gateway-level CORS for optimal performance (bypasses Lambda invocation)
- Recommended: Set OPTIONS route authorization to NONE (avoid authorizer overhead)
- Smoke test: `smoke:cors:preflight-objects-detail` validates CORS behavior

---

## 5. Request/Response Shape Issues

### A. SO/PO Line updates in actions

**Spec for `/sales/so/{id}:fulfill`** (line 3090):
```yaml
requestBody:
  properties:
    lines:
      items:
        properties:
          lineId: { type: string }
          deltaQty: { type: number }
          locationId: { type: string }
          lot: { type: string }
```

**Code** ([sales/so-fulfill.ts](../apps/api/src/sales/so-fulfill.ts)):
- Accepts same shape ✓

**Issue:** Spec shows `locationId` and `lot` as optional but doesn't say if they're required. Code treats them as optional; seems right.

### B. SuggestPoResponse ambiguity

**Spec** (line 1213):
```yaml
SuggestPoResponse:
  oneOf:
    - type: object
      required: [draft]
      properties:
        draft: { $ref: '#/components/schemas/PurchaseOrder' }
    - type: object
      required: [drafts]
      properties:
        drafts: { type: array }
```

**Code** ([purchasing/suggest-po.ts](../apps/api/src/purchasing/suggest-po.ts)):
- Single vendor → returns `{ draft }` ✓  
- Multi-vendor → returns `{ drafts }` ✓  
- **Status:** Matches spec intent

### C. SalesCommitResponse (shortages format)

**Spec** (line 1671):
```yaml
SalesCommitResponse:
  allOf:
    - $ref: '#/components/schemas/SalesOrder'
    - type: object
      properties:
        shortages:
          type: array
          items:
            properties:
              lineId: { type: string }
              itemId: { type: string }
              backordered: { type: number }
```

**Code** ([sales/so-commit.ts](../apps/api/src/sales/so-commit.ts)):
- Returns SalesOrder + optional shortages array ✓

---

## 6. Minor Field Documentation Gaps

| Field | Spec | Code | Gap |
|:------|:-----|:-----|:----|
| `InventoryMovement.docType` | readOnly, enum: [inventoryMovement] | stored as "inventoryMovement" | ✓ match |
| `InventoryMovement.uom` | nullable | stored, used | ✓ match |
| `InventoryMovement.lot` | nullable, string | stored | ✓ match; new in Sprint I |
| `InventoryMovement.locationId` | nullable, string | stored | ✓ match; new in Sprint I |
| `InventoryMovement.refId` | source doc id | stored | ✓ match |
| `InventoryMovement.poLineId` | PO line id | stored | ✓ match; new in Sprint I |
| `Party.roleFlags` | denormalized booleans for fast gates | not surfaced in list/get | ⚠️ Code stores but doesn't return |
| `Party.roles` | array for UI | not populated in code | ⚠️ Optional; code uses roleFlags instead |

---

## 7. Prioritized Fix Plan

### Priority: MUST FIX (blocks Sprint III)

#### 1. **Views CRUD Implementation** (Medium effort)
- **What:** Implement POST, GET, PUT, PATCH, DELETE `/views/{id}`  
- **Files:** Add `views/get.ts`, `views/create.ts`, `views/update.ts`, `views/patch.ts`, `views/delete.ts`  
- **Evidence:** Spec lines 2319–2447; Sprint III DoD includes `smoke:views:crud`  
- **Acceptance:** All 5 smoke steps pass (create → list → update → delete)

#### 2. **Workspaces CRUD Implementation** (Medium effort)
- **What:** Implement POST, GET, PUT, PATCH, DELETE `/workspaces/{id}`  
- **Files:** Add `workspaces/get.ts`, `workspaces/create.ts`, `workspaces/update.ts`, `workspaces/patch.ts`, `workspaces/delete.ts`  
- **Evidence:** Spec lines 2507–2634; Sprint III DoD includes `smoke:workspaces:list`  
- **Acceptance:** List/get workspace with role-aware filtering; tiles hydration

#### 3. **InventoryMovement field clarity (Small effort)**
- **What:** Standardize movement creation payload (action vs. type field)  
- **Files:** [inventory/actions.ts](../apps/api/src/inventory/actions.ts), [smoke.mjs](../ops/smoke/smoke.mjs)  
- **Gap:** Spec uses `action`; code fallback accepts both  
- **Fix:** Enforce `action` field only; update smokes  
- **Acceptance:** Single payload shape in smoke tests

#### 4. **Error code consistency (Small effort)**
- **What:** Add error `code` field to all 4xx/5xx responses  
- **Evidence:** Spec line 410; currently missing from many handlers  
- **Files:** [common/responses.ts](../apps/api/src/common/responses.ts), all action handlers  
- **Acceptance:** All error responses include `code` field

---

### Priority: SHOULD FIX (improve usability)

#### 5. **Event dispatcher plumbing (Medium effort)**
- **What:** Implement event emission (feature-flagged noop/simulate)  
- **Files:** [events/dispatcher.ts](../apps/api/src/events/dispatcher.ts) (stub exists)  
- **Evidence:** Spec section on event types; Sprint III DoD includes `smoke:events:enabled-noop`  
- **Acceptance:** `smoke:po:emit-events` passes with `FEATURE_EVENT_DISPATCH_SIMULATE=true`

#### 6. **Inventory adjustment endpoint (Small effort)**
- **What:** Implement POST `/inventory/{id}/adjust` (creates movement via InventoryAdjustmentRequest)  
- **Files:** Add `inventory/adjust.ts`  
- **Evidence:** Spec line 2735  
- **Acceptance:** Smoke test creates movement via adjust endpoint

#### 7. **Line key naming (Medium effort — risky)**
- **What:** Standardize SO/PO line references (`id` vs. `lineId`)  
- **Issue:** Risky breaking change; clients expect `lineId` in action requests  
- **Recommendation:** Document in API client; leave as-is for now; revisit in v2  
- **Alternative:** Alias support (accept both)

#### 8. **Party.roleFlags exposure (Small effort)**
- **What:** Surface `roleFlags` in GET /objects/party/{id}  
- **Reason:** Spec documents it; code stores it; clients need it for fast permission checks  
- **Files:** [parties/repo.ts](../apps/api/src/parties/repo.ts) (if separate), or [objects/get.ts](../apps/api/src/objects/get.ts)  
- **Acceptance:** GET /objects/party/{id} returns roleFlags

---

### Priority: NICE TO HAVE (documentation & polish)

#### 9. **Centralized idempotency middleware (Large effort)**
- **What:** Move idempotency logic to shared middleware  
- **Current:** Each endpoint implements its own (PO receive, SO actions)  
- **Benefit:** Consistency, simpler handlers  
- **Risk:** Regression if state store schema changes  
- **Recommendation:** Post-Sprint III; low priority

#### 10. **JWT role parsing (Medium effort)**
- **What:** Parse roles from JWT claims instead of hardcoding ["admin"]  
- **File:** [auth/middleware.ts](../apps/api/src/auth/middleware.ts)  
- **Evidence:** TODO comment at [auth/policy.ts](../apps/api/src/auth/policy.ts):9  
- **Status:** Requires token format spec (out of scope)

#### 11. **Search endpoint method (GET vs. POST)**
- **What:** Align spec with code (GET /objects/{type}/search vs. POST)  
- **Current:** Code uses POST; spec shows GET  
- **Recommendation:** Leave as POST (supports complex query bodies); update spec as informational note

#### 12. **Audit endpoint (Low priority, Tier 2+)**
- **What:** Implement GET `/admin/audit`  
- **Evidence:** Spec line 3479  
- **Recommendation:** Out of scope for Sprint III; Tier 2 feature

---

## Summary Table

| Category | Count | Status |
|:---------|:------|:-------|
| Endpoints in spec, not implemented | 11 | 5 Sprint III (Views/Workspaces CRUD), 6 Tier 2+ |
| Endpoints in code, underspecified | 2 | Minor (POST vs GET search) |
| Schema mismatches | 7 | 3 major (Views, Workspaces, line keys), 4 minor/resolved |
| Behavior gaps | 6 | 4 acceptable, 2 to fix |
| Fix plan items | 12 | 4 must-fix, 4 should-fix, 4 nice-to-have |

**Sprint IV Delta:** Registrations v1 (5 endpoints) moved from "not implemented" to ✅ IMPLEMENTED; schema validated with no mismatches.

---

## Recommendation for Sprint III

**Focus order:**
1. ✅ Views CRUD (2–3d)
2. ✅ Workspaces CRUD (2–3d)
3. ✅ Error code consistency (1d)
4. ✅ Event dispatcher (1–2d)
5. 🔄 Inventory adjustment (0.5d)
6. ⏳ Line key standardization (defer; risky)
7. ⏳ Party.roleFlags (optional polish)

**Out of scope for Sprint III:**
- Line naming refactor (breaking change)
- Centralized idempotency (post-III polish)
- Tier 2 endpoints (Events, Resources actions; Audit)
- JWT role parsing (auth overhaul)

---

## File References for Review

| File | Line(s) | Purpose |
|:-----|:--------|:--------|
| [spec/MBapp-Modules.yaml](../spec/MBapp-Modules.yaml) | 2250–2634 | Views & Workspaces spec (not implemented) |
| [spec/MBapp-Modules.yaml](../spec/MBapp-Modules.yaml) | 2815–2975 | **Registrations spec (✅ Sprint IV implemented)** |
| [spec/MBapp-Modules.yaml](../spec/MBapp-Modules.yaml) | 2735 | Inventory adjust endpoint spec |
| [apps/api/src/index.ts](../apps/api/src/index.ts) | 165–380 | Route dispatch; shows what's wired |
| [apps/api/src/registrations/](../apps/api/src/registrations/) | **Sprint IV** | **5 handlers: list, get, create, update, delete** |
| [apps/api/src/views/list.ts](../apps/api/src/views/list.ts) | 1–23 | Views list only; no CRUD |
| [apps/api/src/auth/policy.ts](../apps/api/src/auth/policy.ts) | 9 | TODO: JWT role parsing |
| [apps/api/src/common/responses.ts](../apps/api/src/common/responses.ts) | (implicit) | Error shape; missing `code` consistency; **noContent() added Sprint IV** |
| [spec/MBapp-Modules.yaml](../spec/MBapp-Modules.yaml) | 410 | Error schema with code field |

---

## Sprint IV Summary (Registrations v1)

**Scope:** Validate Registrations module implementation against spec after Sprint IV delivery.

### Endpoints Delivered (5 total)
✅ All spec endpoints implemented with **zero deltas**:

| Endpoint | Method | Handler | Spec Line | Status |
|:---------|:-------|:--------|:----------|:-------|
| /registrations | GET | [list.ts](../apps/api/src/registrations/list.ts) | 2816–2862 | ✅ PASS |
| /registrations | POST | [create.ts](../apps/api/src/registrations/create.ts) | 2863–2888 | ✅ PASS |
| /registrations/{id} | GET | [get.ts](../apps/api/src/registrations/get.ts) | 2890–2923 | ✅ PASS |
| /registrations/{id} | PUT | [update.ts](../apps/api/src/registrations/update.ts) | 2924–2960 | ✅ PASS |
| /registrations/{id} | DELETE | [delete.ts](../apps/api/src/registrations/delete.ts) | 2961–2984 | ✅ PASS |

### Schema Alignment
**Spec Schema** (lines 1962–2019): Registration extends ObjectBase
- Required: `type` (registration), `eventId`, `partyId`, `status`
- Optional: `division`, `class`, `fees[]`, `notes`
- Status enum: `draft | submitted | confirmed | cancelled` (default: draft)
- Fees validation: `{ code: string, amount: number, qty?: number }[]`

**Code Implementation:**
- ✅ All required fields validated in [create.ts](../apps/api/src/registrations/create.ts#L14-L40) and [update.ts](../apps/api/src/registrations/update.ts)
- ✅ Status enum enforced with default "draft"
- ✅ Fees array structure validated (code + amount required)
- ✅ Optional fields accepted (division, class, notes)
- ✅ Type="registration" enforced on creation

**Result:** **ZERO schema mismatches**; spec and code fully aligned.

### Behavior Validation

**Query Parameters** (GET /registrations):
- Spec (lines 2826–2859): `eventId`, `partyId`, `status` (enum), `limit`, `next`
- Code: In-memory filtering on all spec params; pagination via cursor
- ✅ **MATCH**

**Auth & Permissions:**
- Spec: Requires bearerAuth + X-Tenant-Id
- Code: All handlers use `requirePerm(auth, "registration:read|write")`
- ✅ **MATCH**

**Response Shapes:**
- 201 Created (POST): Returns Registration object ✅
- 200 OK (GET/PUT): Returns Registration object ✅
- 204 No Content (DELETE): Returns empty body via new `noContent()` helper ✅
- 400/401/403/404: Standard error responses ✅

**Feature Flag:**
- Spec: Notes "FEATURE_REGISTRATIONS_ENABLED (default OFF)"
- Code: [flags.ts](../apps/api/src/flags.ts) + [index.ts](../apps/api/src/index.ts#L223-L236) gates all /registrations routes
- Default: `false` (disabled in PROD)
- Dev override: `X-Feature-Registrations-Enabled` header
- ✅ **MATCH**

### Smoke Test Coverage
**Tests:** [ops/smoke/smoke.mjs](../ops/smoke/smoke.mjs)
1. `smoke:registrations:crud` — Full lifecycle: POST → GET → PUT → DELETE → verify removal
   - **Result:** ✅ PASS
2. `smoke:registrations:filters` — Create 3 registrations, filter by eventId/partyId/status
   - **Result:** ✅ PASS (byEvent: 2, byParty: 2, byStatus: 2)

**Coverage:** End-to-end validation of all 5 endpoints + filtering logic.

### API Polish Delivered
**204 No Content Pattern:**
- Spec: DELETE /registrations/{id} returns 204 with no body (line 2977)
- Code: Added `noContent()` helper in [responses.ts](../apps/api/src/common/responses.ts)
- Returns: `{ statusCode: 204, headers: baseHeaders, body: "" }` (RFC 7231 compliant)
- ✅ **Matches spec exactly**

### Gaps Identified
**None.** Registrations v1 has **zero implementation deltas** vs. spec:
- ✅ All endpoints implemented
- ✅ Schema validated (required/optional fields)
- ✅ Query params match
- ✅ Auth/permissions enforced
- ✅ Response codes correct
- ✅ Feature flag operational
- ✅ Smoke tests pass

### Fix Plan: NONE REQUIRED
Sprint IV delivered **contract-compliant** Registrations v1 with no schema-breaking changes, no missing endpoints, and full smoke test coverage.

**Next Sprint Candidates:**
- Views CRUD (still pending from Sprint III scope)
- Workspaces CRUD (still pending from Sprint III scope)
- Registration actions (:cancel, :checkin, :checkout) — Tier 2

---

**Delta Report End**
