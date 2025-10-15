# MBapp Backend Guide (apps/api)

This doc explains how our **router**, **auth**, and **module endpoints** are structured so anyone can add or modify API routes quickly and safely.

## 1) Runtime & entrypoint
- Runtime: AWS Lambda (APIGW v2 proxy). Types: `APIGatewayProxyEventV2`, `APIGatewayProxyResultV2`.
- Entrypoint: `apps/api/src/index.ts` → single **router** function `handler(event)`.
- Helpers: `json()`, `notFound()`, `methodNotAllowed()`, `match()`, `withId()`, `withTypeId()`.

## 2) Auth & permissions
- `getAuth(event)` → `{ userId, tenantId, roles, policy }` (Bearer required).
- `injectPreAuth(event, auth)` → stores auth into `event.requestContext.authorizer.mbapp`.
- `requirePerm(auth, "<scope>:<verb>")` guards routes.
- **Tenant header**: send both `X-Tenant-Id` and `x-tenant-id`.
- **Idempotency**: `"Idempotency-Key"` header for retriable actions.

## 3) Router map (high level)
**Public**: `GET /` or `/health`, `POST /auth/dev-login` (dev)  
**Auth**: `GET /auth/policy`  
**Views**: `GET/POST /views`, `GET/PUT/DELETE /views/{id}`  
**Workspaces**: `GET/POST /workspaces`, `GET/PUT/DELETE /workspaces/{id}`  
**Objects**: `GET/POST /objects/{type}`, `GET/PUT/DELETE /objects/{type}/{id}`, `POST /objects/{type}/search`  
**Purchasing (PO)**: `POST /purchasing/po/{id}:(submit|approve|receive|cancel|close)`  
**Sales (SO)**: `POST /sales/so/{id}:(submit|commit|reserve|release|fulfill|cancel|close)`  
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

## 8) Smokes
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
