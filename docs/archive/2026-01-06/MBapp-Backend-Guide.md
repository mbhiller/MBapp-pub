# MBapp Backend Guide (apps/api)

This doc explains how our **router**, **auth**, and **module endpoints** are structured so anyone can add or modify API routes quickly and safely.

## 1) Runtime & entrypoint
- Runtime: AWS Lambda (APIGW v2 proxy). Types: `APIGatewayProxyEventV2`, `APIGatewayProxyResultV2`.
- Entrypoint: `apps/api/src/index.ts` → single **router** function `handler(event)`.
- Helpers: `json()`, `notFound()`, `methodNotAllowed()`, `match()`, `withId()`, `withTypeId()`.

## 2) Auth & permissions
- `getAuth(event)` → `{ userId, tenantId, roles, policy }` (Bearer required).
  - **policy**: `Record<string, boolean>` from JWT `mbapp.policy` claim or derived from `mbapp.roles`.
  - **Policy source priority:**
    1. **Explicit JWT policy (if non-empty):** Uses `mbapp.policy` from JWT unchanged (explicit override)
    2. **Role derivation (fallback):** If JWT has no `mbapp.policy` or empty object, derives permissions from `mbapp.roles` via `derivePolicyFromRoles()`
  - **Role mappings** ([apps/api/src/auth/derivePolicyFromRoles.ts](../apps/api/src/auth/derivePolicyFromRoles.ts)):
    - `admin` → `{ "*": true }` (superuser)
    - `operator` → `{ "*:read": true, "sales:*": true, "purchase:*": true, "inventory:*": true, "view:*": true, "workspace:*": true, "scanner:use": true }`
    - `viewer` → `{ "*:read": true }` (read-only)
    - `warehouse` → `{ "*:read": true, "inventory:*": true, "purchase:receive": true, "scanner:use": true }`
  - **Wildcard semantics:**
    - `"*"` → superuser (all permissions)
    - `"*:*"` → all actions on all types
    - `"*:read"` → read action on all types
    - `"product:*"` → all actions on product type
    - `"product:read"` → exact permission match
  - **Canonical permission keys:** Use singular module prefixes (`party`, `product`, `inventory`, `purchase`, `sales`, `view`, `workspace`, `scanner`, etc.) in `<resource>:<action>` form. `/auth/policy` returns these canonical keys. Clients may honor legacy aliases for backward compatibility, but canonical keys are the contract.

### JWT Claims Contract

- **Claims:** JWT `mbapp` object contains `mbapp.userId` (string), `mbapp.tenantId` (string), `mbapp.roles` (string[]), and `mbapp.policy` (Record<string, boolean>).
- **Precedence:** Non-empty `mbapp.policy` is used as-is; otherwise derive from `mbapp.roles`; otherwise policy is empty.
- **Permission keys:** Lowercase-only. Mixed-case keys are denied and not expanded.
- **Wildcards:** Supported values `*`, `*:*`, `*:read`, `{type}:*` (same semantics as `hasPerm`).
- **Legacy aliases:** Server expands aliases bidirectionally for party/parties, product/products, sales/salesorder, purchase/purchaseorder, inventory/inventoryitem before evaluating permissions.
- **Web client consumption:** Web fetches `/auth/policy` on token change to gate UI navigation links. Uses canonical lowercase permission keys and same wildcard semantics; fails closed (no policy → all links hidden). See [apps/web/src/lib/permissions.ts](../apps/web/src/lib/permissions.ts) for `hasPerm()` helper.

### Permission key semantics & derived policy (canonical)

- **hasPerm wildcard resolution:** Checks exact match first, then `resource:*`, `*:action`, `*:read`, `*:*`, `*` (superuser). Same semantics apply across modules.
- **Derived policy matrix (canonical keys):**

| Role | Derived policy keys |
|------|----------------------|
| admin | `*` |
| operator | `*:read`, `sales:*`, `purchase:*`, `inventory:*`, `view:*`, `workspace:*`, `scanner:use` |
| viewer | `*:read` |
| warehouse | `*:read`, `inventory:*`, `purchase:receive`, `scanner:use` |

- **Contract reminder:** Canonical keys are singular; legacy plural/alias keys may be accepted by some clients for transition only.
- `injectPreAuth(event, auth)` → stores auth into `event.requestContext.authorizer.mbapp`.
- `requirePerm(auth, "<type>:<action>")` guards routes with wildcard support: `type:*`, `*:action`, `*:*`, `*`.
- **Tenant header**: send both `X-Tenant-Id` and `x-tenant-id`.
- **Idempotency**: `"Idempotency-Key"` header for retriable actions.

### Web Client RBAC

**Web policy consumption:** Web client ([apps/web](../apps/web)) fetches `/auth/policy` on token change via [AuthProvider.tsx](../apps/web/src/providers/AuthProvider.tsx) and uses the same canonical permission keys and wildcard semantics as backend.

- **Navigation gating:** [Layout.tsx](../apps/web/src/components/Layout.tsx) hides module links (Parties, Products, Sales Orders, Purchase Orders, Inventory) when user lacks corresponding `:read` permissions (e.g., `product:read`).
- **Route protection:** [ProtectedRoute.tsx](../apps/web/src/components/ProtectedRoute.tsx) component wraps create/edit routes and redirects to `/not-authorized` if user lacks required `:write` permission (e.g., `product:write`).
- **Action gating:** Create buttons in list pages ([PartiesListPage](../apps/web/src/pages/PartiesListPage.tsx), [ProductsListPage](../apps/web/src/pages/ProductsListPage.tsx), etc.) are hidden when user lacks write permission.
- **Fail-closed:** No token → all gated links/buttons hidden; policy fetch error → all gated features hidden; missing permission → feature hidden/route redirects. Web relies on `/auth/policy` for both UI visibility and route protection; server returns 403 if client-side check is bypassed.

### Authorization: Permission Prefix Normalization

**Context:** `/objects/:type` routes accept camelCase object types in URLs (e.g., `/objects/salesOrder`, `/objects/purchaseOrder`) but canonical permission keys use lowercase module prefixes (`sales`, `purchase`, `inventory`).

**Implementation:**
- **Type-to-prefix mapping** ([apps/api/src/index.ts](../apps/api/src/index.ts#L193)):
  ```typescript
  function typeToPermissionPrefix(typeRaw: string): string {
    const type = (typeRaw || "").toLowerCase();
    const moduleMap: Record<string, string> = {
      "salesorder": "sales",
      "purchaseorder": "purchase",
      "inventoryitem": "inventory",
    };
    return moduleMap[type] || type;
  }
  ```
  Router calls `requireObjectPerm(auth, method, type)` which internally maps `type` to canonical prefix before checking permissions.

- **Server-side policy alias expansion** ([apps/api/src/auth/middleware.ts](../apps/api/src/auth/middleware.ts#L17-L56)):
  ```typescript
  function expandPolicyWithAliases(policy: Record<string, boolean>): Record<string, boolean> {
    // Bidirectional mappings: sales↔salesorder, purchase↔purchaseorder, inventory↔inventoryitem
    // Expands both canonical→legacy and legacy→canonical to support backward compatibility
  }
  ```
  Applied in `getAuth()` to policy object BEFORE returning auth context; ensures both `purchase:write` and `purchaseorder:write` grant the same access.

- **Single source of truth for permission checks:**
  - Router (index.ts) enforces permissions via `requireObjectPerm()` for ALL `/objects/:type` routes (GET, POST, PUT, DELETE, search).
  - Object handlers (create.ts, update.ts, get.ts, list.ts, search.ts, delete.ts) do NOT perform additional permission checks; router is authoritative.
  - This avoids case-sensitivity conflicts (permission checks are case-sensitive by default; normalization happens at router entrypoint).

- **Fallback behavior:**
  - If specific permission check fails (e.g., `purchase:write`), router attempts generic fallback `objects:write` before rejecting request.
  - This allows new object types (e.g., `location`) to work with generic `objects:*` permissions without requiring new module-specific permission keys.

**Example flows:**
- `POST /objects/purchaseOrder` with operator role (derives `purchase:*`) → Router checks `purchase:write` → SUCCESS
- `POST /objects/purchaseOrder` with explicit policy `{"purchaseorder:write": true}` → Expansion adds `purchase:write` → Router checks `purchase:write` → SUCCESS
- `POST /objects/purchaseOrder` with viewer role (derives `*:read`) → Router checks `purchase:write` → FAIL → Fallback checks `objects:write` → FAIL → 403 Forbidden

## 3) Feature Flags

Backend flags (from `apps/api/src/flags.ts`):

| Flag Env Variable | Header Override (dev/CI only) | Default | Purpose |
|-------------------|-------------------------------|---------|----------|
| `FEATURE_REGISTRATIONS_ENABLED` | `X-Feature-Registrations-Enabled` | `false` | Registration endpoints |
| `FEATURE_RESERVATIONS_ENABLED` | `X-Feature-Reservations-Enabled` | `false` | Reservation endpoints + conflicts |
| `FEATURE_VIEWS_ENABLED` | `X-Feature-Views-Enabled` | `false` | Views CRUD endpoints |
| `FEATURE_EVENT_DISPATCH_ENABLED` | `X-Feature-Events-Enabled` | `false` | Event dispatcher (EventBridge/SNS) |
| `FEATURE_EVENT_DISPATCH_SIMULATE` | `X-Feature-Events-Simulate` | `false` | Return `_dev.emitted: true` instead of real dispatch |
| `FEATURE_ENFORCE_VENDOR_ROLE` | `X-Feature-Enforce-Vendor` | `true` | Require vendor partyRole on PO |

**Note:** Header overrides only work in non-prod environments (controlled by `IS_PROD` check).

## 4) Router map (high level)
**Public**: `GET /` or `/health`, `POST /auth/dev-login` (dev)  
**Auth**: `GET /auth/policy` (returns `Record<string, boolean>` — explicit JWT policy or role-derived permissions)  
**Views**: `GET/POST /views`, `GET/PUT/DELETE /views/{id}`  
**Workspaces**: `GET/POST /workspaces`, `GET/PUT/DELETE /workspaces/{id}`  
**Objects**: `GET/POST /objects/{type}`, `GET/PUT/DELETE /objects/{type}/{id}`, `POST /objects/{type}/search`  
**Purchasing (PO)**: `POST /purchasing/po/{id}:(submit|approve|receive|cancel|close)`, `POST /purchasing/suggest-po`, `POST /purchasing/po:create-from-suggestion`  
**Sales (SO)**: `POST /sales/so/{id}:(submit|commit|reserve|release|fulfill|cancel|close)` (commit accepts `?strict=1`)  
**Inventory**: `GET /inventory/{itemId}/onhand`, `POST /inventory/onhand:batch`, `GET /inventory/{itemId}/movements`, `POST /inventory/search`  
**Events/Resources**: `POST /events/registration/{id}:(cancel|checkin|checkout)`, `POST /resources/reservation/{id}:(cancel|start|end)`  
**EPC & Scanner**: `GET /epc/resolve?epc=...`, `POST /scanner/sessions`, `POST /scanner/actions`, `POST /scanner/simulate` (dev)  
**Tools**: `GET/DELETE /tools/gc/{type}`, `GET /tools/gc/list-all`, `POST /tools/gc/delete-keys`

## 4) Handler modules
Create files like:
apps/api/src/sales/so-commit.ts
apps/api/src/purchasing/po-receive.ts
apps/api/src/inventory/onhand-get.ts
Each exports `async function handle(event)`. Read path/query/body, use `authorizer.mbapp`, return `json(status, body)`.

## 5) Error & guardrails
- Throw `{ statusCode, message }` to bubble clean errors.
- **Sales**: `commit(strict)` → 409 if shortages; no over-ship; no negative release.
- **Inventory**: `available = onHand - reserved` (≥ 0). Fulfill reduces **both** onHand & reserved.
- **Purchasing (PO receive):**
  - **Over-receive guard:** Returns 409 conflict with `details.code = "RECEIVE_EXCEEDS_REMAINING"` including `{ lineId, ordered, received, remaining, attemptedDelta }`.
  - **PO status transitions:** `draft → submitted → approved → partially-received → fulfilled` (when all lines fully received).
  - **Idempotency behavior:**
    - Dual-track: `Idempotency-Key` header (key-based) + payload-signature (content-based).
    - Key-based idempotency checked BEFORE validation (safe short-circuit for previously successful requests).
    - Payload-signature idempotency checked AFTER validation (prevents caching invalid requests).
    - **Caching policy:** Idempotency keys are marked/applied ONLY on successful writes; failed operations (e.g., over-receive) are NOT cached.
    - **Retry behavior:** Repeating an invalid request with the same idempotency key will re-validate and fail again (not return cached success).

## 6) Adding a new action route (checklist)
1. New file `src/<module>/<action>.ts` with `handle()`.
2. Wire regex block in `index.ts` + `requirePerm`.
3. Update `spec/openapi.yaml` and `spec/MBapp-Modules.yaml`.
4. Add `ops/smoke.mjs` tests.
5. Use `"Idempotency-Key"` when appropriate.

## 7) OpenAPI & spec parity
- Keep `spec/openapi.yaml` synced.
- Prefer `200` returning the updated domain object.
- Error body: `{ message, code?, ...context }` (no global `#/components/schemas/Error` needed).

## 8) Smokes & Environment Requirements

**Smoke Env Requirements (Sprint XXVI+):**
- **MBAPP_API_BASE** (required): Full HTTPS URL to AWS API Gateway (e.g., `https://ki8kgivz1f.execute-api.us-east-1.amazonaws.com`). No localhost fallback. Script exits(2) if missing.
- **MBAPP_BEARER** (required): Valid bearer token for tenant. No dev-login fallback. Script exits(2) if missing.
- **MBAPP_TENANT_ID** (optional): Defaults to `DemoTenant` if unset.
- **X-Tenant-Id**: Always injected in `baseHeaders()` for multi-tenant scoping.
- **X-Feature-* headers**: Override flags in non-prod environments (e.g., `X-Feature-Events-Simulate: 1`).

**Running a Smoke Locally:**
```bash
export MBAPP_API_BASE=https://ki8kgivz1f.execute-api.us-east-1.amazonaws.com
export MBAPP_TENANT_ID=DemoTenant
export MBAPP_BEARER=<your-token>

node ops/smoke/smoke.mjs smoke:parties:crud
node ops/smoke/smoke.mjs smoke:close-the-loop
```

See the Handoff Quickstart for the canonical set.

## Aligned Addenda — Tier 1 Canonical Model (Backend)

### Identity & Roles (enforced)
- **Party** is canonical. Roles are additive via **PartyRole** (`customer, vendor, employee, bidder, lessor, lessee, ...`).
- **Guards:** When creating/updating:
  - `SalesOrder.customerId` must reference a Party with role **customer**.
  - `PurchaseOrder.vendorId` must reference a Party with role **vendor**.
- **PartyLink** encodes relationships (`employs, owns, member_of, handles, affiliate, parent, subsidiary`).

### Account Profiles (optional, not identities)
- **CustomerAccount** (terms, credit limit, price list, tax flags, default bill/ship-to).
- **VendorAccount** (terms, remit-to, 1099 flag, default expense/COGS).
- Orders pull defaults at write-time; keep denormalized copies on the order for audit.

### Labor & Staffing Posting
- **EmployeeProfile** (employmentType, scope, payType, stdRate, GL defaults).
- **EventStaffAssignment** (role, shift, rateOverride, costCategory=direct_labor|overhead).
- **LaborEntry** → **PayrollBatch** (posted):
  - If `eventId` present or `costCategory=direct_labor`: DR **COGS:DirectLabor**, CR **Wages Payable**.
  - Else: DR **Opex:Wages**, CR **Wages Payable**.

### Auctions (tenant as buyer/seller)
- Our org is a Party; may hold `bidder, customer, vendor` roles.
- Settlement posts AR/AP normally. If tenant is counterparty, optional auto-offset clears self AR/AP.

### Leasing
- **LeaseAgreement** (lessorPartyId, lesseePartyId, resourceIds, term, charges, deposit).
- **LeaseBillingRun** generates Invoices (lessor→AR/Revenue) or Bills (lessee→AP/Expense/Prepaid).

### Tenant & Related-Party
- **TenantProfile.primaryPartyId** marks “us.”
- **RelatedPartyRule** flags `self/subsidiary/affiliate/...`; options:
  - `alertOnTransact`, `requireApproval`, `autoOffsetARAP` (creates clearing JE after document post).

### Minimal Validators (pseudo-code)
```ts
assertRole(customerId, 'customer'); // SO write path
assertRole(vendorId, 'vendor');     // PO write path

if (isSelfCounterparty(partyId)) {
  enforceRelatedPartyRules(docType, amount);
}
```

### Smokes to wire
- `smoke:identity:party-roles` (create Party → add roles → list by role)
- `smoke:salesOrder:flow` + guard: customer role required
- `smoke:purchaseOrder:flow` + guard: vendor role required
- `smoke:labor:event-direct-labor` (staff→labor→batch→COGS post)
- `smoke:lease:billing-run` (generate invoices/bills; verify postings)
- `smoke:auction:self-bid` (optional)
