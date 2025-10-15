# MBapp-Working.md — Tier 1 Sprint Plan (Execution-Ready)

> This is the **living** plan for completing Tier 1. It is repo-tailored (paths & scripts) and aligned with our Roadmap + Guides + Relationships.

---

## 0) Sprint Objective (Tier 1 “Done”)
- **Core Identity online**: Party + PartyRole + PartyLink with UNIQ# guards; role-filtered lists/pickers.
- **SO/PO parity**: shared line editor semantics; totals/taxes; guardrails (over-commit/fulfill; cancel/close).
- **Labor & Staffing foundations**: EmployeeProfile → EventStaffAssignment → LaborEntry → PayrollBatch with postings (COGS vs Opex).
- **Tenant/Related-Party + Leases**: TenantProfile, RelatedPartyRule, LeaseAgreement, LeaseBillingRun with correct postings.
- **Smokes green in CI**: identity, SO/PO flows, labor, leases (optionally tenants/auctions self-bid).

---

## 1) Branch, Sync, and Spec
```powershell
cd "{repo_root}"
git switch -c feat/tier1-foundations-101425
```
- Spec: `specs/MBapp-Modules.yaml` (updated with Customer/VendorAccount, Labor, Tenant, Leasing). Commit if modified.
```powershell
git add specs/MBapp-Modules.yaml docs/*.md
git commit -m "docs/spec: Tier 1 aligned (identity, SO/PO, labor, leasing, tenant)"
```

---

## 2) Types Generation & Typecheck (per workspace)
**Backend (API)**
```powershell
cd apps/api
npx openapi-typescript ..\..\specs\MBapp-Modules.yaml -o src/api/generated-types.d.ts
npm run typecheck || npm run build --workspaces=false
```

**Mobile**
```powershell
cd ..\mobile
npx openapi-typescript ..\..\specs\MBapp-Modules.yaml -o src/api/generated-types.d.ts
npm run typecheck
```

> Fix any type errors immediately. If blockers appear, paste the error and path—we’ll return a drop‑in patch.

---

## 3) Backend — Required Work
### 3.1 Identity & Roles
- [ ] Party CRUD/search: filter by `kind` and `role`.
- [ ] PartyRole assign/remove (`customer`, `vendor`, `employee`, `bidder`, `lessor`, `lessee`).
- [ ] PartyLink create/list (`employs`, `owns`, `member_of`, `handles`, `affiliate`, `parent`).  
- [ ] UNIQ#: email/registry/externalId guard (no dupes).

**Smoke**
```powershell
node ops/smoke.mjs smoke:seed:all
node ops/smoke.mjs smoke:verify:edits   # node ops/smoke.mjs smoke:identity:party-roles
```

### 3.2 Sales & Purchase Orders (SO/PO)
- [ ] Shared line editor behavior (id‑less add, change, remove, normalize→patch→normalize).
- [ ] Totals/taxes; negative inventory prevention; over‑commit/over‑fulfill guardrails.
- [ ] **Role validators**: `SalesOrder.customerId` must be Party with role=customer; `PurchaseOrder.vendorId` must be Party with role=vendor.
- [ ] Cancel/close rules enforced.

**Smokes**
```powershell
node ops/smoke.mjs smoke:salesOrder:require-customer-role    # node ops/smoke.mjs smoke:salesOrder:flow
node ops/smoke.mjs smoke:purchaseOrder:require-vendor-role    # node ops/smoke.mjs smoke:purchaseOrder:flow
node ops/smoke.mjs smoke:purge:all
# (run your inventory-specific flows here if you have a dedicated command)  # node ops/smoke.mjs smoke:guardrails:inventory
```

### 3.3 Labor & Staffing
- [ ] **EmployeeProfile** CRUD (employmentType, scope, payType, stdRate, GL defaults, cost center).
- [ ] **EventStaffAssignment** (role, shift, rateOverride, costCategory).
- [ ] **LaborEntry** (timesheet; `eventId`→COGS else Opex).
- [ ] **PayrollBatch** (approve/post); Posting Rules emit correct JEs.

**Smoke**
```powershell
node ops/smoke.mjs smoke:verify:edits  # placeholder; wire labor smoke when available      # node ops/smoke.mjs smoke:labor:event-direct-labor
```

### 3.4 Tenant/Related-Party & Leasing
- [ ] **TenantProfile** seeded with our org Party (`primaryPartyId`).
- [ ] **RelatedPartyRule** for self/affiliates with `alertOnTransact`, `requireApproval`, `autoOffsetARAP` toggles.
- [ ] **LeaseAgreement** CRUD (lessor/lessee, resources, term, charge schedule, deposit).
- [ ] **LeaseBillingRun** generates invoices/bills and posts to correct GL (revenue vs expense/prepaid).

**Smokes**
```powershell
node ops/smoke.mjs smoke:verify:edits  # placeholder; wire tenant self-bid when available    # node ops/smoke.mjs smoke:tenants:self-bid
node ops/smoke.mjs smoke:verify:edits  # placeholder; add lease billing run when added     # node ops/smoke.mjs smoke:leases:billing-run
```

---

## 4) Frontend — Required Work
### 4.1 Parties & Pickers
- [ ] Parties feature (tabs: People | Organizations | Animals; role filters).
- [ ] **PartyPicker(role=customer)** for SO; **PartyPicker(role=vendor)** for PO.
- [ ] **AnimalPicker** for Registrations.
- [ ] Dupe‑guard UX: if email/registry exists, route to existing Party.

### 4.2 Orders UX
- [ ] Shared line editor across SO/PO with consistent modals and keyboard behavior.
- [ ] Badges for statuses; totals/taxes blocks; consistent filter persistence on return to list.

### 4.3 Labor & Leasing UI
- [ ] **Event detail → Staff tab** (assignments, shifts, rate overrides, cost category).
- [ ] **Timesheets**: My entries; **Approvals**: manager view; **Payroll**: create/approve/post batch.
- [ ] **Leases**: list + detail; dev-only “Run Billing” to trigger LeaseBillingRun.

---

## 5) Seeding & Test Data
- [ ] Seed: our org Party + roles; one sample customer; one vendor; one employee; one event; one basic lease (arena).
```powershell
node ops/seed.mjs identity:baseline --ourOrg "Your Ranch LLC" --sampleCustomer "Blue Sky Farms" --sampleVendor "Hay & Feed Co." --sampleEmployee "Alex Stablehand" --event "Fall Classic 2025"
```
- [ ] (Optional) Seed CustomerAccount/VendorAccount for terms/limits/defaults.

---

## 6) CI Additions
- [ ] Workflow runs typegen check (optional), `api:typecheck`, `mobile:typecheck`.
- [ ] Smokes in CI: `smoke:identity`, `smoke:so-flow`, `smoke:po-flow`, `smoke:labor`, `smoke:leases`.
- [ ] Canary deploy (if applicable) before promoting to main.

---

## 7) Definition of Done (Tier 1)
- ✅ SO/PO parity with role guards; inventory guardrails green.
- ✅ Identity CRUD/search/links + UNIQ# dupe guards.
- ✅ Labor posted correctly (COGS vs Opex); PayrollBatch flow complete.
- ✅ Lease billing posts correctly; tenant/related-party rules functional.
- ✅ All smokes green locally and in CI.

---

## 8) Commands Index (direct node usage)
```powershell
# Common ones detected in ops/smoke.mjs:
node ops/smoke.mjs smoke:seed:all
node ops/smoke.mjs smoke:events:capacity-guard
node ops/smoke.mjs smoke:reservations:conflict-guard
node ops/smoke.mjs smoke:registrations:edit-in-place
node ops/smoke.mjs smoke:salesOrder:require-customer-role
node ops/smoke.mjs smoke:purchaseOrder:require-vendor-role
node ops/smoke.mjs smoke:purge:all
node ops/smoke.mjs smoke:verify:edits
```

---

## 9) Open Questions / Needed Paths
- **SO/PO validators**: confirm write handler file(s) so we can drop in the role checks.
- **LeaseBillingRun**: if not implemented, point me to the desired API path and handler pattern.
- **Party/Animal pickers**: confirm component/hook conventions and folder paths for drop‑in components.
