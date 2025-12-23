# MBapp Backend Guide (apps/api)

This doc explains how our **router**, **auth**, and **module endpoints** are structured so anyone can add or modify API routes quickly and safely.

## 1) Runtime & entrypoint
- Runtime: AWS Lambda (APIGW v2 proxy). Types: `APIGatewayProxyEventV2`, `APIGatewayProxyResultV2`.
- Entrypoint: `apps/api/src/index.ts` → single **router** function `handler(event)`.
- Helpers: `json()`, `notFound()`, `methodNotAllowed()`, `match()`, `withId()`, `withTypeId()`.

## 2) Auth & permissions
- `getAuth(event)` → `{ userId, tenantId, roles, policy }` (Bearer required).
  - **policy**: `Record<string, boolean>` from JWT `mbapp.policy` claim (runtime enforcement).
- `injectPreAuth(event, auth)` → stores auth into `event.requestContext.authorizer.mbapp`.
- `requirePerm(auth, "<type>:<action>")` guards routes with wildcard support: `type:*`, `*:action`, `*:*`, `*`.
- **Tenant header**: send both `X-Tenant-Id` and `x-tenant-id`.
- **Idempotency**: `"Idempotency-Key"` header for retriable actions.

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
**Auth**: `GET /auth/policy` (dev stub returns `{ scopes: ["*:*"], user, roles, tenants, version, issuedAt }`)  
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
