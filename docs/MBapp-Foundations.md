### Registration Hold TTL (Sprint AV)

- On checkout (draft → submitted), the server sets `submittedAt` and `holdExpiresAt = now + TTL`, where TTL comes from `REGISTRATION_HOLD_TTL_SECONDS` (default 900 seconds).
- Replay behavior: if a submitted registration has `holdExpiresAt < now`, the API returns `409` with `{ code: "hold_expired" }` and does not return the existing PaymentIntent/clientSecret.
- Expire helper: `expireRegistrationHold({ tenantId, regId })` cancels expired submitted holds, sets `paymentStatus = failed`, clears `paymentIntentClientSecret`, and safely releases the event seat via `releaseEventSeat(eventId)`.
- Capacity release uses an atomic decrement that never allows negative `reservedCount` and is idempotent-friendly (no-op when already zero).
- Cleanup endpoint: `POST /registrations:cleanup-expired-holds` performs bounded cleanup of expired holds. Query parameter `?limit=` bounds work (default 50, max 200). Tenant-scoped; requires `registration:write`. Returns `{ expiredCount }`.

### Notifications Seam (Sprint AW: Postmark, Sprint AV: Simulate Foundation)

**Message Object Contract:**
- Type: `message` with `channel: "push" | "sms" | "email"`
- Fields: `type`, `channel`, `to` (recipient), `subject`, `body`, `status` (queued|sending|sent|failed|cancelled)
- Provider tracking: `provider` (e.g., "postmark"), `providerMessageId`, `errorMessage`, `lastAttemptAt`
- Idempotency: Parent object stores `confirmationMessageId` (e.g., registration.confirmationMessageId); skips duplicate enqueue if already stored.

**Postmark Integration (Sprint AW):**
- **Provider:** Postmark (https://postmarkapp.com/)
- **Endpoint:** `POST https://api.postmarkapp.com/email`
- **Headers:** `X-Postmark-Server-Token: {POSTMARK_API_TOKEN}`, `Content-Type: application/json`
- **Env vars:** `POSTMARK_API_TOKEN` (required), `POSTMARK_FROM_EMAIL` (default: noreply@mbapp.dev), `POSTMARK_MESSAGE_STREAM` (default: "outbound")
- **Send flow:** `enqueueEmail()` creates message with `status=queued`, then:
  - If simulate mode ON (`FEATURE_NOTIFY_SIMULATE=1` or header `X-Feature-Notify-Simulate: true`): immediately marks `status=sent` (deterministic CI, no external calls)
  - If simulate mode OFF: sends via Postmark, updates message with `status=sent/failed` + provider details
- **Error handling:** Failed sends set `status=failed` with `errorMessage` and `lastAttemptAt` for observability/retry
- **CI:** Smokes use simulate header to skip real sends; keeps CI deterministic and fast
- **Manual testing:** Use Postmark's test server token (`POSTMARK_API_TEST`) to validate the integration without delivering real mail:
  - Set `POSTMARK_API_TOKEN="POSTMARK_API_TEST"` and `FEATURE_NOTIFY_SIMULATE=0`
  - Messages will validate and return success, but won't be delivered to recipients
  - Use this for local/dev testing of the provider contract before using production token

**Stripe Webhook Integration:**
- On `payment_intent.succeeded`, enqueues confirmation email when party email exists
- Persists `confirmationMessageId` on registration for idempotency
- Subsequent webhook replays detect stored ID and skip duplicate send

**Feature Flags:**
- `FEATURE_NOTIFY_SIMULATE`: Default `true` in CI/dev; set to `false` or omit for real provider sends
- Header override: `X-Feature-Notify-Simulate: true` (non-prod only) to simulate in staging/prod
- Real providers (Postmark/Twilio/SMS) reuse the same seam, toggled by this flag

# MBapp Foundations Report

**Navigation:** [Roadmap](MBapp-Roadmap.md) · [Status/Working](MBapp-Status.md) · [Cadence](MBapp-Cadence.md) · [Verification](smoke-coverage.md)  
**Last Updated:** 2026-01-06

---

## Purpose

This document defines the **structural standards and invariants** for the MBapp codebase:
- Object model contracts (what fields/types every module uses)
- API patterns (idempotency, pagination, error handling, feature flags)
- Web and mobile UI conventions (routing, forms, guards, navigation)
- Smoke test conventions (naming, structure, cleanup rules)
- Spec-to-types generation workflow

**For roadmap planning:** See [MBapp-Roadmap.md](MBapp-Roadmap.md)  
**For current status & coverage:** See [MBapp-Status.md](MBapp-Status.md)

---

## Canonical Docs Policy

These **5 documents are the canonical source of truth (SSOT)** for MBapp:
- [MBapp-Roadmap.md](MBapp-Roadmap.md) — Feature roadmap and delivery phases
- [MBapp-Foundations.md](MBapp-Foundations.md) — Structural standards (this doc)
- [MBapp-Status.md](MBapp-Status.md) — Current implementation status and sprint summaries
- [MBapp-Cadence.md](MBapp-Cadence.md) — Workflow cadence and Definition of Done
- [smoke-coverage.md](smoke-coverage.md) — Smoke test organization and coverage

**Archived docs** (in `docs/archive/2026-01-06/`) are **reference-only** and may be stale or incorrect. Do not cite them as truth. If you find useful information in an archived doc, copy it forward into a canonical doc (and update it), rather than linking to it as truth.

---

## 1. Config / Environment Entrypoints

### 1.1 Mobile (apps/mobile)

**Primary Config:** [apps/mobile/app.config.ts](../apps/mobile/app.config.ts#L34-L38)
```typescript
extra: {
  EXPO_PUBLIC_API_BASE: process.env.EXPO_PUBLIC_API_BASE ?? 
    "https://ki8kgivz1f.execute-api.us-east-1.amazonaws.com",
  EXPO_PUBLIC_TENANT_ID: process.env.EXPO_PUBLIC_TENANT_ID ?? "DemoTenant",
  EXPO_PUBLIC_ROLES: process.env.EXPO_PUBLIC_ROLES ?? "admin,objects.view,..."
}
```

**Runtime Access:** [apps/mobile/src/lib/config.ts](../apps/mobile/src/lib/config.ts#L17-L22)
```typescript
export function requireApiBase(): string {
  const { API_BASE } = getExtra();
  if (!API_BASE) {
    throw new Error('Missing API_BASE in Expo extra. Set it in app.config.ts');
  }
  return API_BASE;
}
```

**HTTP Client:** [apps/mobile/src/lib/http.ts](../apps/mobile/src/lib/http.ts#L10)
```typescript
baseURL: requireApiBase(),
```

**Status:** ✅ **No localhost fallback** — Mobile correctly defaults to AWS API Gateway  
**Auth:** Currently uses dev login flow; bearer token stored in DevAuthBootstrap provider

---

### 1.2 Web (apps/web)

**Primary Config:** [apps/web/src/lib/api.ts](../apps/web/src/lib/api.ts#L3-L4)
```typescript
const API_BASE = import.meta.env.VITE_API_BASE!;
const TENANT   = import.meta.env.VITE_TENANT ?? "DemoTenant";
```

**Environment File:** `apps/web/.env` (expected, not checked in)
```bash
VITE_API_BASE=https://ki8kgivz1f.execute-api.us-east-1.amazonaws.com
VITE_TENANT=DemoTenant
```

**Status:** ⚠️ **Missing .env handling** — Web requires manual .env setup; no sample file present  
**Auth:** No auth implementation detected in web client (uses plain fetch, no bearer token)

### Web List-Page Enrichment: Avoid N+1 Fan-Out
- **Symptom:** Parallel detail-enrichment calls on list pages can spike Lambda/API concurrency and surface intermittent 503s.
- **Rule:** Do not use unbounded `Promise.all(missing.map(...apiFetch...))` for vendor/party enrichments; cap concurrency.
- **Pattern:** Use the shared batching helper [apps/web/src/lib/concurrency.ts](../apps/web/src/lib/concurrency.ts) (`forEachBatched`) or equivalent fixed-width batching for list-page enrichments.
- **Guardrail:** Tool [ops/tools/check-no-unbounded-fanout.mjs](../ops/tools/check-no-unbounded-fanout.mjs) fails if obvious fan-out patterns reappear in PurchaseOrdersListPage.
  - Run manually: `npm run check:no-unbounded-fanout` (or `node ops/tools/check-no-unbounded-fanout.mjs`).
  - Keep list enrichments within the batching helper to avoid regression.

---

### 1.3 Smoke Tests (ops/smoke)

**Config:** [ops/smoke/smoke.mjs](../ops/smoke/smoke.mjs#L7-L8)
```javascript
const API = (process.env.MBAPP_API_BASE ?? "http://localhost:3000").replace(/\/+$/, "");
const TENANT = process.env.MBAPP_TENANT_ID ?? "DemoTenant";
```

**Status:** ✅ **AWS-only** — Requires `MBAPP_API_BASE` (no localhost fallback); exits(2) if unset  
**Auth:** Requires `MBAPP_BEARER` env var; smokes fail fast if missing (no dev-login fallback)

---

### 1.4 RBAC / Policy Consumption

**Canonical Permission Model:** 
- API endpoint `/auth/policy` returns `Record<string, boolean>` with canonical lowercase permission keys (e.g., `party:read`, `product:write`, `sales:*`, `*:read`).
- Keys format: `{type}:{action}` where type is singular module prefix (party, product, inventory, purchase, sales, view, workspace, scanner) and action is read/write/\* or custom actions.
- Wildcard support: `*` (superuser), `*:*` (all actions), `*:read` (read all types), `{type}:*` (all actions on type).
- Legacy alias expansion (server-side): party↔parties, product↔products, sales↔salesorder, purchase↔purchaseorder, inventory↔inventoryitem.

**API & Backend:**
- `/auth/policy` endpoint returns full permission map for authenticated user; fails closed (no token → empty policy).
- Permission checks use `hasPerm(policy, permission)` wildcard resolver (exact → type:* → *:action → *:* → *).

---

## 2. Integration Defaults (Sprint AU)

**Chosen providers (defaults unless explicitly overridden):**
- **Payments:** Stripe (PaymentIntent flow). Rationale: best-in-class docs, SDKs, idempotency, test mode, webhooks; fast to ship vertical slices.
- **File storage:** S3 (existing AWS footprint; lifecycle + presign supported).
- **Email:** Postmark (reliable deliverability, minimal setup; transactional first).
- **SMS/voice:** Twilio (ubiquitous API, good simulator tooling).
- **Accounting export-first:** QuickBooks Online (QBO) for outbound sync; no inbound writeback yet.
- **Corporate cards/expenses:** Ramp (export-first; no inbound accounting yet).
- **Hardware:** Zebra (scanners/printers) where device control is required; MBapp-native merch for simple swag.

**Principles:**
- Prefer export-first integrations (push our data out) before attempting ingest.
- Keep simulate/dev headers/envs for all external calls to allow CI smokes without vendor traffic.
- Idempotency everywhere (keys passed through to providers when supported).

## 3. Payments (Stripe) Contract

- **Flow:** PaymentIntent (not Checkout Session). Client receives `clientSecret` from `/events/registration/{id}:checkout` and calls Stripe.js `confirmCardPayment`.
- **Public auth:** `X-MBapp-Public-Token` header hashes to `registration.publicTokenHash`. No JWT required for public checkout.
- **Idempotency:**
  - API honors `Idempotency-Key` header and reuses existing PaymentIntent if already created.
  - Stripe call passes the same key to avoid duplicate charges.
- **Webhooks:** `/webhooks/stripe` verifies signature (real) or simulate signature (`Stripe-Signature: sim_valid_signature`) in smokes. On `payment_intent.succeeded`, sets `registration.status=confirmed`, `paymentStatus=paid`, `confirmedAt=now`.
- **Metadata:** PaymentIntent metadata includes `registrationId` and `eventId` for webhook correlation.
- **Capacity guard:** Checkout enforces atomic `reservedCount` increment on Event with condition `reservedCount < capacity` (null/0 treated as unlimited). Failure → 409 `capacity_full`.

**Mobile:**
- Fetches `/auth/policy` on app startup via `useAuthContext()` in [apps/mobile/src/features/_shared/AuthContext.tsx](../apps/mobile/src/features/_shared/AuthContext.tsx).
- Hides module tabs/screens based on `{type}:read` permissions (e.g., PartiesTab visible only if user has `party:read`).
- Fail-closed: no token → policy empty → all module tabs hidden.

**Web:**
- Fetches `/auth/policy` on token change via [AuthProvider.tsx](../apps/web/src/providers/AuthProvider.tsx#L95-L120) (Sprint S).
- Navigation gating in [Layout.tsx](../apps/web/src/components/Layout.tsx): Hides module links for Parties, Products, Sales Orders, Purchase Orders, Inventory based on `:read` permissions.
- Route protection in [App.tsx](../apps/web/src/App.tsx): Create/edit routes (`/parties/new`, `/products/:id/edit`, etc.) wrapped with [ProtectedRoute.tsx](../apps/web/src/components/ProtectedRoute.tsx) requiring `:write` permission; redirects to `/not-authorized` if denied (Sprint T E1).
- Action gating in list pages: Create buttons hidden when user lacks write permission (Sprint T E2).
- Detail page action gating (Sprint U): [SalesOrderDetailPage.tsx](../apps/web/src/pages/SalesOrderDetailPage.tsx) and [PurchaseOrderDetailPage.tsx](../apps/web/src/pages/PurchaseOrderDetailPage.tsx) gate action buttons by granular permissions:
  - **Sales Orders:** submit/edit (sales:write), commit (sales:commit), reserve/release (sales:reserve), fulfill (sales:fulfill), close (sales:close), cancel (sales:cancel).
  - **Purchase Orders:** submit/edit (purchase:write), approve (purchase:approve), receive (purchase:receive), close (purchase:close), cancel (purchase:cancel).
  - All action buttons hidden during `policyLoading` (fail-closed); handlers detect 403 responses and display permission-denied messages before generic error handling.
- Views/Workspaces write action gating (Sprint V): [ViewsListPage.tsx](../apps/web/src/pages/ViewsListPage.tsx), [ViewDetailPage.tsx](../apps/web/src/pages/ViewDetailPage.tsx), [WorkspacesListPage.tsx](../apps/web/src/pages/WorkspacesListPage.tsx), [WorkspaceDetailPage.tsx](../apps/web/src/pages/WorkspaceDetailPage.tsx) gate all write actions:
  - **Views:** Edit/delete links/buttons require `view:write` (list + detail pages).
  - **Workspaces:** Create button (list), delete workspace, add/remove views, set/unset default view require `workspace:write` (list + detail pages).
  - All write actions hidden during `policyLoading` (fail-closed); existing error handling preserved (alert/inline errors).
- Inventory/Locations write action gating (Sprint W E1): [InventoryDetailPage.tsx](../apps/web/src/pages/InventoryDetailPage.tsx) and [LocationsListPage.tsx](../apps/web/src/pages/LocationsListPage.tsx) gate all write actions:
  - **Inventory:** Putaway/Adjust buttons require `inventory:write`; Cycle Count button requires `inventory:adjust` (detail page only).
  - **Locations:** Create form and inline Edit/Save/Cancel controls require `location:write` OR `objects:write` (list page; aligns with API fallback for unknown types).
  - All write actions hidden during `policyLoading` (fail-closed); consistent with prior sprint patterns.
- Backorder/Detail Edit link gating (Sprint W E2): [BackorderDetailPage.tsx](../apps/web/src/pages/BackorderDetailPage.tsx), [BackordersListPage.tsx](../apps/web/src/pages/BackordersListPage.tsx), [PartyDetailPage.tsx](../apps/web/src/pages/PartyDetailPage.tsx), [ProductDetailPage.tsx](../apps/web/src/pages/ProductDetailPage.tsx) gate write actions:
  - **Backorders:** Ignore/Convert buttons require `objects:write`; Suggest PO requires `purchase:write` (detail page + bulk actions in list page).
  - **Party/Product Detail:** Edit links require `party:write` / `product:write` respectively (detail pages; edit forms still route-protected from Sprint T).
  - All write actions hidden during `policyLoading` (fail-closed); layered with existing status gates.
- Fail-closed: no token → all gated links/buttons hidden; policy error → all gated features hidden.

**Consistency Across Platforms:**
- Canonical permission keys, fail-closed semantics, and wildcard resolution are identical across API, mobile, and web.
- Server is source of truth for authorization; client-side gating is UX-only (server 403 enforces access control).

**Backorder integrity:**
- Each backorderRequest must reference an existing salesOrder (`soId`), a line on that order (`soLineId` match against `lines`/`lineItems`), and an inventory record (try `inventoryItem`, fall back to `inventory`).
- Validation runs at sales order commit (when creating backorders) and on convert; ignore remains permissive for cleanup but emits integrity context for observability.

**Inventory ↔ InventoryItem aliasing:**
- Canonical type is `inventoryItem`; legacy records may still have `type=inventory`.
- API objects layer resolves both types for GET/UPDATE/DELETE/LIST/SEARCH (inventoryItem first, inventory fallback) so callers can use either id/type during migration; `/objects/inventory` now persists as `inventoryItem` (canonical) while legacy read routes remain supported via alias resolution.
- New code should write `inventoryItem` and read using alias-aware helpers (API: type-alias helpers; web/mobile: fetch inventoryItem then inventory on 404).

**Onhand Endpoints & Permissions (Sprint AI):**
- All three onhand endpoints (`GET /inventory/{id}/onhand`, `GET /inventory/{id}/onhand:by-location`, `POST /inventory/onhand:batch`) require `inventory:read` permission.
- Permission enforcement: API enforces via `requirePerm(auth, "inventory:read")` in router; handlers rely on router check (no handler-level enforcement needed).
- Generated constant: Use `PERM_INVENTORY_READ` imported from `apps/web/src/generated/permissions.ts` or `apps/mobile/src/generated/permissions.ts` instead of hardcoding `"inventory:read"` strings.
- Wildcard matching: `inventory:read` permission is granted by `*:read` (read all types) or `*` (superuser) in user policy.
- CI Coverage: `smoke:inventory:onhand-permission-denied` test validates permission enforcement; 403 Forbidden is returned when `inventory:read` is absent.

---

### 1.5 Dev Tools: Tenant Wipe Utility (ops/tools)

**Purpose:** Safely delete all objects in a DynamoDB tenant partition (dev/staging cleanup only).

**Tool:** [ops/tools/wipe-tenant.mjs](../ops/tools/wipe-tenant.mjs) — Node.js utility for tenant cleanup (non-interactive, script-friendly).

**Safety Model:**

1. **Allowlisted Tenants:** Only `SmokeTenant` and `DemoTenant` can be wiped by default.
   - Prevents accidental wipes of production or custom tenants.
   - Override with `--allow-any-tenant` flag (prints warning, not recommended).

2. **Dry-Run Default:** No deletion occurs unless `--confirm --confirm-tenant` match is provided.
   - Dry-run queries and reports item count safely.
   - Deletion requires explicit confirmation with matching tenant name (typo-proof).

3. **Production Gating:** Blocks deletes in production environments unless `--allow-production` is set.
   - Detection: `NODE_ENV=production` or `MBAPP_ENV=prod`.
   - Dry-runs allowed in production (safe inspection).
   - Deletes in production require both `--confirm` AND `--allow-production` (loud warning printed).

4. **Retry & Reliability:**
   - Handles DynamoDB `UnprocessedItems` with exponential backoff (base 100ms, max 5s, up to 8 retries).
   - Non-zero exit if any items fail to delete (for CI detection).
   - Tracks deleted/failed counts in final summary.

**Usage:**

```bash
# Dry-run (list items, no delete) — safe for all environments
npm run wipe:smoke
npm run wipe:demo

# Delete with explicit confirmation
npm run wipe:smoke -- --confirm --confirm-tenant SmokeTenant
npm run wipe:demo -- --confirm --confirm-tenant DemoTenant

# Sequential cleanup (both tenants)
npm run wipe:smoke-and-demo

# Direct invocation (both --tenant= and --tenant formats work)
node ops/tools/wipe-tenant.mjs --tenant=SmokeTenant
node ops/tools/wipe-tenant.mjs --tenant SmokeTenant --confirm --confirm-tenant SmokeTenant
node ops/tools/wipe-tenant.mjs --tenant CustomTenant --allow-any-tenant  # dry-run, warns
node ops/tools/wipe-tenant.mjs --tenant CustomTenant --confirm --confirm-tenant CustomTenant --allow-any-tenant  # delete, warns
```

**Logging & Output:**

- Init: `[wipe-tenant] env=development table=mbapp_objects tenant=SmokeTenant confirm=false`
- Query: `[wipe-tenant] found 1387 items for tenant SmokeTenant`
- Dry-run: `[wipe-tenant] Dry run complete (no deletes performed). Re-run with --confirm to delete.`
- Progress (deletion): `[wipe-tenant] deleted 250/1387... (12.5 items/sec, 20.0s)`
- Summary: `[wipe-tenant] done. found=1387 deleted=1387 failed=0 duration=15.3s (90.5 items/sec)`
- Retries: `[wipe-tenant] retry 1/8 in 142ms (3 items)` — printed on unprocessed items

**Exit Codes:**

- `0`: Success (dry-run or all items deleted)
- `1`: Query failure, batch write failure, or partial delete failure (items in failed list)
- `2`: Validation failure (invalid tenant, missing confirm-tenant, confirm mismatch, allowlist violation)
- `3`: Production mode block (deletes attempted without --allow-production)

**Scope:**

- Wipes ONLY the `objects` table partition for the tenant (DynamoDB Query by PK).
- Does NOT touch movements, audit logs, or other tables.
- Does NOT backup or version data before deletion (permanent).

**CI/Smoke Integration:**

- Smoke tests that need a clean tenant call `npm run wipe:smoke` (dry-run) or `npm run wipe:demo` before setup.
- Example: [ops/smoke/smoke.mjs](../ops/smoke/smoke.mjs) may reset SmokeTenant state via wipe before provisioning test data.
- Wipe tool itself has no dedicated smoke (tool failures are caught by broader smoke test failures).


### 2.1 Idempotency & Error Handling
- All mutating endpoints (`POST /purchase-orders`, `POST /purchase-orders/{id}/submit`, etc.) accept optional `idempotencyKey` header
- Duplicate submissions within TTL window (24h default) return same response (200/201) with `X-Idempotency-Cached: true`
- Standard error contract: `{ code: string, message: string, details?: object }`
- Business rule violations return 409 Conflict with domain error codes (e.g., `PO_STATUS_NOT_RECEIVABLE`)

### 2.2 Pagination & Filtering
- List endpoints support `?limit=N` (default 25, max 100) and `?nextToken=XYZ`
- Filters use query params: `?status=draft`, `?vendorId=abc123`
- Response shape: `{ items: T[], nextToken?: string }`

### 2.3 Feature Flags
- Header override pattern: `X-Feature-{FlagName}: 1` (dev/staging only)
- Example: `X-Feature-Enforce-Vendor: 1` enables vendor guard in non-prod
- All flags default OFF; must be explicitly enabled per environment

### 2.4 Object Model Contracts

See [spec/MBapp-Modules.yaml](../spec/MBapp-Modules.yaml) for full OpenAPI definitions. Key patterns:

**Workspaces / Views (alias model):**
- Workspace-first storage with legacy fallback: list/get/read prefer true `type="workspace"` records, then fall back to legacy `type="view"` workspace-like records; results are deduped by id before counting toward limits.
- Workspace membership is tracked via `views: string[]` (view IDs only; `workspace.id` is never a viewId). Workspace detail (web + mobile) opens member views into entity list screens using each view’s `entityType`; web falls back to `/views/{id}` when no list screen is mapped.
- Name limits: View names validate to 1–120 chars; Workspace names validate to 1–200 chars. Stay within those limits to avoid 400 validation errors.
- Dual-write flag: `MBAPP_WORKSPACES_DUALWRITE_LEGACY=true` writes both the workspace record and a legacy `type="view"` shadow (and deletes both). Use only during migration to keep legacy consumers aligned; default OFF.
- Pagination + aliasing: `/workspaces` list accepts `cursor` **or** `next` (handled by `parsePagination`); responses return `cursor`. `/views` list uses `cursor`; only handlers wired through `parsePagination` honor `next` as an alias.
- **Workspace v1 (alias reality):** Workspaces persist as `{ id, name, entityType?, views[] }`; clients MUST include `entityType` on updates even when unchanged.

**Workspace View Pinning Invariants (Sprint L):**
- **entityType Compatibility Rule:** If `workspace.entityType` is set (e.g., `purchaseOrder`), all pinned views in `views[]` MUST have matching `view.entityType` or no `entityType` set. Server PATCH endpoint validates and rejects with 400 if a pinned view's `entityType` differs.
- **Deduplication:** PATCH `/workspaces/{id}` with `views[]` automatically dedupes by viewId (first occurrence wins) before persisting; prevents accidental duplicates.
- **Unknown viewId rejection:** If a viewId in the PATCH payload does not exist (not found in `type="view"`), PATCH returns 400 with message `"Unknown viewId: <id>"`.
- **Mixed hubs allowed:** Workspaces without `entityType` set can act as "mixed hubs" with views of any entity type; no validation applied. Navigation in WorkspaceDetail uses each view's `entityType` to route to appropriate list screen.
- **Client-side guards:** Web and mobile clients validate entityType compatibility before sending PATCH; mismatched views are blocked with clear error messages. This prevents invalid payloads from reaching the API.

**Workspace Default View Rules (Sprint M):**
- **Field:** `workspace.defaultViewId?: string | null` — Optional field to designate a preferred default view for quick "Open" navigation.
- **Validation rules (enforced in create/update/patch):**
  1. **Type check:** Must be string, null, or undefined. Invalid types return 400 with `"defaultViewId must be a string if provided"`.
  2. **Existence check:** If set, must be present in workspace's `views[]` array. Returns 400 with `"defaultViewId <id> not found in views array"`.
  3. **EntityType compatibility:** If `workspace.entityType` is set, the default view must have matching `view.entityType` or no `entityType`. Returns 400 with `"View <id> has entityType X but workspace has Y"`.
- **Auto-clearing:** When removing a view from `views[]` that is currently set as `defaultViewId`, the API automatically clears `defaultViewId` to null (or returns 400 if attempted via PATCH without clearing).
- **Open precedence (web + mobile):** "Open" button uses `defaultViewId` if set → first pinned view in `views[]` if available → workspace detail page as fallback. Ensures users always have a valid navigation target.
- **UX indicators:** Both web and mobile show blue background + "DEFAULT" badge on the default view card. Set/Unset controls provided in workspace detail pages.
- **Error messages:** API returns specific error codes for each failure mode: `"Unknown viewId: <id>"`, `"not found in views array"`, `"has entityType X but workspace has Y"`.
- **Smoke coverage:** `smoke:workspaces:default-view-validation` validates all 8 scenarios including creation, PATCH updates, unknown viewId rejection, entityType mismatches, and removal edge cases.

**Views/Workspaces v1 Foundation — CI-Locked (Sprint AB):**
- **Filter Validation:** All 11 filter operators (eq, ne, lt, le, gt, ge, in, nin, contains, startsWith, regex) validated and locked in CI via `smoke:views:validate-filters`.
- **PATCH Workflow:** View update + reapplication tested via `smoke:views:save-then-update` (validates operator leverage: update existing view without creating duplicate).
- **RBAC Boundaries:** Permission enforcement validated via `smoke:views-workspaces:permissions` (admin writes succeed, viewer writes denied 403, reads allowed).
- **API RBAC:** All 12 Views/Workspaces endpoints annotated with `x-mbapp-permission` (view:read, view:write, workspace:read, workspace:write); enforced at API layer.
- **Generated Permissions:** `PERM_VIEW_READ`, `PERM_VIEW_WRITE`, `PERM_WORKSPACE_READ`, `PERM_WORKSPACE_WRITE` exported in web/mobile/spec generated files.
- **Web UX:** SaveViewButton and ViewSelector permission-gated by `PERM_VIEW_WRITE`; disabled when `!canWriteViews`, 403 errors show "Access denied — required: view:write".

**Workspaces Legacy Sunset — Retirement Plan (Sprint AU+)**

*Context:* Early workspace implementations stored workspace-shaped records as `type="view"` with schema `{ name, views[], shared, ownerId, ... }` instead of canonical `type="workspace"`. Current API supports both via dual-source reads (workspace-first, fallback to view) and optional dual-write when `MBAPP_WORKSPACES_DUALWRITE_LEGACY=true`.

**Telemetry Events (Sprint AU):** Unified legacy fallback measurement
- **`workspaces:legacy_fallback_read_hit`** — **UNIFIED COUNTER** for both GET and LIST legacy fallback
  - GET variant: `{ event, tenantId, op: "get", workspaceId, sourceType: "view" }`
    - Emitted in [apps/api/src/workspaces/repo.ts](../apps/api/src/workspaces/repo.ts) `getWorkspaceById()` when primary `type="workspace"` not found but `type="view"` returns record
  - LIST variant: `{ event, tenantId, op: "list", legacyCount, sourceUsed: "view", requestedLimit, hasCursor }`
    - Emitted in `listWorkspaces()` when any items sourced from `type="view"` (once per request)
  - **Why unified:** Simplifies dashboards/alerts; single metric tracks "are we still using fallback?" across all read patterns
- **`workspaces:legacy_fallback_get`** (backwards-compatible, deprecated) — See unified counter instead
- **`workspaces:legacy_fallback_list`** (backwards-compatible, deprecated) — See unified counter instead
- **`workspaces:dualwrite_enabled`** — Warning when `MBAPP_WORKSPACES_DUALWRITE_LEGACY=true`
  - Payload: `{ event, tenantId, op: "create"|"update"|"patch"|"delete" }`
  - Emitted in all mutation handlers (create.ts, update.ts, patch.ts, delete.ts)

**Phase 1: Telemetry + Migration Tool (✅ Complete, Sprint AU)**
- **Deliverables:**
  - ✅ Unified telemetry counters added to repo.ts (GET/LIST fallback)
  - ✅ Migration tool [ops/tools/migrate-legacy-workspaces.mjs](../ops/tools/migrate-legacy-workspaces.mjs) with safety gates + idempotency
  - ✅ End-to-end smoke test `smoke:migrate-legacy-workspaces:creates-workspace` validates migration path
  - ✅ Documentation updated in Foundations + Status + smoke-coverage.md
- **Checklist:**
  - ✅ Telemetry emits correctly (verified in repo.ts implementation)
  - ✅ Migration tool dry-run shows candidates (no writes)
  - ✅ Migration tool with --confirm performs copy-only migration
  - ✅ Idempotency validated (re-run shows skippedExists, no duplicates)
  - ✅ Legacy views preserved after migration (copy-only, no deletes)
  - ✅ Smoke validates end-to-end: legacy view → migration → workspace read
  - ✅ TypeScript compiles clean; core/extended smokes green

**Phase 2: Cutover Readiness (Sprint AW — Planned)**
- **Deliverables:**
  - Run migration in staging → prod (after telemetry confirms cutover is safe)
  - Monitor `workspaces:legacy_fallback_read_hit` telemetry pre/post migration
  - Document cutover runbook with rollback procedures
- **Go/No-Go Criteria (must ALL pass before cutover):**
  - ✓ Legacy fallback reads < 1% of workspace reads (measured via `legacy_fallback_read_hit` / total reads) for ≥3 consecutive days
  - ✓ All mission-critical tenants migrated (0 legacy records remain OR legacy-using tenants have agreed to local data migration)
  - ✓ Smoke tests green on prod + staging (migration + readback tests pass)
  - ✓ Dualwrite flag remains OFF (verify no late-game adds of legacy shadows)
  - ✓ Customer communication sent (if any public tenants rely on legacy records)
- **Expected Post-Migration State:**
  - `legacy_fallback_read_hit` drops to near-zero (only stale clients may trigger)
  - All workspace records now `type="workspace"` (canonical)
  - Legacy `type="view"` workspace-shaped shadows persist (not deleted in Phase 2)
  - Fallback code still active (no changes to read logic yet)

**Phase 3: Fallback Removal (✅ Complete, Sprint AY, 2026-01-05)**
- **Deliverables:**
  - ✅ Removed dual-source read logic from `getWorkspaceById()` and `listWorkspaces()` ([repo.ts](../apps/api/src/workspaces/repo.ts))
  - ✅ Deleted `MBAPP_WORKSPACES_DUALWRITE_LEGACY` flag and all conditional writes (create.ts, update.ts, patch.ts, delete.ts)
  - ✅ Simplified `delete.ts`: workspace-only deletion, 404 if missing (no view fallback)
  - ✅ Workspace-only writes: CREATE/UPDATE/PATCH now write only `type="workspace"` records
  - ✅ Updated Foundations.md, Status.md, smoke-coverage.md, ci-smokes.json
- **Checklist:**
  - ✓ File reductions: repo.ts 247→106 lines (57%), delete.ts 57→28 lines
  - ✓ Removed all legacy telemetry emissions (`legacy_fallback_*`, `dualwrite_enabled`)
  - ✓ Grep verified: zero remaining `DUALWRITE_LEGACY` references in codebase
  - ✓ Typecheck clean on all modified handlers
  - ✓ Renamed smoke to `smoke:workspaces:get-no-fallback` (expects 404, no fallback)
  - ✓ Added smoke `smoke:workspaces:cutover-validation` to core tier (validates full post-cutover flow)
- **Breaking Changes:**
  - Workspace GET/LIST no longer fallback to legacy `type="view"` records (now returns 404)
  - Migration tool must be run BEFORE Phase 3 (no recovery post-removal for unmigrated legacy views)
  - Dualwrite flag removed entirely (no dual-writing after this release)
- **Migration Tool Status:**
  - `migrate-legacy-workspaces.mjs` remains available as **copy-only safety tool** for late-discovered legacy items
  - Can be run pre-Phase 3 or post-Phase 3 to copy any remaining legacy views to canonical workspaces (read-only; never deletes)
  - Useful for manual discovery of unexpected legacy-shaped records before cleanup phases

**Operator Playbook — Legacy Workspace Migration (Post-Cutover)**

After Phase 3 cutover (Sprint AY, 2026-01-05), `/workspaces` endpoints **no longer fallback** to legacy `type="view"` records. If legacy workspace-shaped views exist, they must be migrated to canonical `type="workspace"` records.

**Prerequisites:**
- AWS credentials with DynamoDB access (`aws sso login --profile <profile>`)
- Region environment configured (run `ops/Set-MBEnv.ps1 <ENV>` or set `AWS_REGION`/`AWS_DEFAULT_REGION`)
- Tenant ID known (e.g., `SmokeTenant`, `DemoTenant`)

**Migration Steps:**

1. **Dry-run** (lists candidates, no writes):
   ```bash
   node ops/tools/migrate-legacy-workspaces.mjs --tenant SmokeTenant
   ```
   Expected output: `{"region":"us-east-1","table":"mbapp_objects","candidatesFound":N,...,"dryRun":true}`

2. **Execute migration** (copy-only, idempotent):
   ```bash
   node ops/tools/migrate-legacy-workspaces.mjs --tenant SmokeTenant --confirm --confirm-tenant SmokeTenant
   ```
   Expected output: `{"region":"us-east-1",...,"created":N,"skippedExists":M,"errors":0}`
   
3. **Verify migration**:
   - **API:** `GET /workspaces` should return migrated workspaces (200, not 404)
   - **DynamoDB:** Query `pk=<tenant>, sk begins_with workspace#` shows canonical records
   - **Re-run tool:** Should show `created:0, skippedExists:N` (all already migrated)

**Notes:**
- Migration is **copy-only**: Legacy `type="view"` records remain untouched (safe for rollback)
- Tool is **idempotent**: Re-running skips existing workspace records (no duplicates)
- **Validation smoke:** `smoke:migrate-legacy-workspaces:creates-workspace` proves end-to-end migration
- Tool logs include `[DEBUG]` lines showing exact DynamoDB keys used (troubleshooting aid)

**Phase 4: Legacy Record Cleanup (Sprint AY+ — Optional)**
- Delete `type="view"` workspace-shaped records from database (after Phase 3 confirms no regressions)
- Update schema docs to remove workspace-shaped view references
- Archive migration tool (no longer needed)

**Timeline (Indicative):**
- Phase 1: ✅ Sprint AU (2026-01-05) — COMPLETE
- Phase 3: ✅ Sprint AY (2026-01-05) — COMPLETE (Removed fallback + dualwrite)
- Phase 2: Sprint AW (early Feb 2026) — Cutover after ≥3 days of <1% legacy reads (SKIPPED — Phase 1 telemetry showed no legacy usage)
- Phase 4: Sprint AZ+ (optional, if db cleanup needed) — Delete `type="view"` workspace-shaped records

**Monitoring Commands:**
```bash
# Check telemetry event distribution
grep "legacy_fallback_read_hit" <API-logs> | jq '.event, .op, .tenantId' | sort | uniq -c

# Run migration (dry-run first)
node ops/tools/migrate-legacy-workspaces.mjs --tenant <TENANT>
node ops/tools/migrate-legacy-workspaces.mjs --tenant <TENANT> --confirm --confirm-tenant <TENANT>

# Validate migration smoke (requires AWS creds)
node ops/smoke/smoke.mjs smoke:migrate-legacy-workspaces:creates-workspace
```

- **Mobile UX:** ViewsManageScreen rename/delete permission-gated by `PERM_VIEW_WRITE`; disabled buttons (opacity 0.5), 403 errors show clear permission messaging.
- **Web Workspace Hub:** Polished with view count, default view indicator, and "Open" buttons (WorkspacesListPage + WorkspaceDetailPage).
- **Filter Mapping:** Remains best-effort per entityType; unsupported filters warned in UI (e.g., "Some filters may not be supported for this entity type").
- **Phase 2 Scope:** Shared views, columns UI rendering, mobile list screen integration deferred to next sprint.

**Status Lifecycles:**
- Purchase Orders: `draft → submitted → approved → (partially-)received → fulfilled → closed` (also `cancelled`)
- Sales Orders: `draft → submitted → approved → (partially-)fulfilled → completed` (also `cancelled`)
- Inventory Movements: `pending → completed` (no cancellation)

**Hyphenation Convention:** Multi-word statuses use hyphens: `partially-received`, `partially-fulfilled`

**Timestamps:** All entities have `createdAt` (ISO 8601), mutating operations add `updatedAt`

**Reference IDs:** Cross-module references use consistent naming: `vendorId`, `productId`, `customerId`, `locationId`, `poId`, `soId`

### 2.5 Shared Line Editor Contract

**Purpose:** Ensure consistent line item identity and patch-lines behavior across SO/PO, web/mobile, create/edit flows.

**ID Fields:**
- `id` (string): Server-assigned persistent identity — MUST be stable `L{n}` pattern (e.g., `L1`, `L2`, `L3`, ...)
  - Present ONLY for lines already persisted by server
  - Never send client-generated temporary IDs (e.g., `tmp-*`) in the `id` field
- `cid` (string): Client-only temporary identity — MUST use `tmp-{uuid}` pattern
  - Present ONLY for new lines not yet saved to server
  - Used by patch-lines ops to identify which line to create
  - Never persisted; server replaces with stable `id` upon creation
- `_key` (string): UI-only React key — managed by LineArrayEditor component
  - Never sent to API
  - Ensures stable rendering during edits

**Patch-Lines Flow (Web + Mobile):**
```
Web Edit Page:
  1. Load server lines (have id: L1, L2, ...)
  2. User edits in LineArrayEditor (new lines get cid: tmp-*, existing keep id)
  3. Form submission → computePatchLinesDiff(serverLines, editedLines)
  4. Diff helper generates ops:
     - Remove: { op: "remove", id: "L1" }  (for server lines)
     - Remove: { op: "remove", cid: "tmp-xyz" }  (for client lines)
     - Upsert: { op: "upsert", id: "L1", patch: {...} }  (update existing)
     - Upsert: { op: "upsert", cid: "tmp-xyz", patch: {...} }  (create new)
  5. API receives ops → applyPatchLines() processes
  6. Server calls ensureLineIds() → assigns stable L{n} IDs to new lines
  7. Persist with guaranteed stable IDs
```

**Critical Rules (DO NOT VIOLATE):**
- ❌ NEVER generate fallback IDs (e.g., `L${idx}`) for lines without server id
- ❌ NEVER send `tmp-*` values in the `id` field (always use `cid`)
- ❌ NEVER send full line arrays as PUT payload (always use `computePatchLinesDiff` + PATCH ops)
- ✅ ALWAYS preserve server `id` exactly as provided
- ✅ ALWAYS use `cid` for client-only lines (generate via `tmp-${uuid}`)
- ✅ ALWAYS let server assign stable IDs via `ensureLineIds()`
- ✅ Canonical line identity is `id`; `lineId` is a deprecated compatibility alias during transition (accept on input only).

**Implementation Status (Sprint M → Sprint U):**
- ✅ API: `ensureLineIds()` helper ensures stable `L{n}` IDs (apps/api/src/shared/ensureLineIds.ts)
- ✅ API: `po-create-from-suggestion` uses `ensureLineIds()` (no more ad-hoc `ln_*` IDs)
- ✅ API: Action handlers (po-receive, so-reserve, so-release, so-fulfill) accept both `id` (canonical) and `lineId` (deprecated) on input, normalize internally to `id`, log legacy usage, always emit `id` in responses (Sprint E2)
- ✅ Web: `computePatchLinesDiff()` sends `cid` for new lines, `id` for updates (apps/web/src/lib/patchLinesDiff.ts)
- ✅ Web: Edit pages preserve server IDs, no fallback generation (EditSalesOrderPage, EditPurchaseOrderPage)
- ✅ Web: Forms have JSDoc pattern documentation to prevent regressions (SalesOrderForm, PurchaseOrderForm)
- ✅ Web: LineArrayEditor auto-generates `cid` for new lines, preserves `id` for existing
- ✅ Smoke tests: `smoke:po:create-from-suggestion:line-ids` validates `L{n}` pattern
- ✅ Smoke tests: `smoke:so:patch-lines:cid` validates cid → server id flow
- ✅ Mobile: Shared `computePatchLinesDiff` helper matches web semantics (apps/mobile/src/lib/patchLinesDiff.ts); shared RN `LineEditor` component used by SO/PO edit screens with cid tmp-* generation; broader RN line editor UX roll-out ongoing; PO/SO edit screens now share normalization helpers + PATCHABLE fields constant (itemId/qty/uom) and respect tmp-* cid rules (Sprint U)

**Files:**
- Spec: [spec/MBapp-Modules.yaml](../spec/MBapp-Modules.yaml) — PatchLinesOp schema defines `id` + `cid` fields
- API: [apps/api/src/shared/ensureLineIds.ts](../apps/api/src/shared/ensureLineIds.ts) — ID normalization
- API: [apps/api/src/shared/applyPatchLines.ts](../apps/api/src/shared/applyPatchLines.ts) — Patch ops processor
- Web: [apps/web/src/lib/patchLinesDiff.ts](../apps/web/src/lib/patchLinesDiff.ts) — Diff + ops generator
- Web: [apps/web/src/components/LineArrayEditor.tsx](../apps/web/src/components/LineArrayEditor.tsx) — Shared editor component
- Smokes: [ops/smoke/smoke.mjs](../ops/smoke/smoke.mjs) — Regression tests (lines 6672-6876)

**Status Guards (patch-lines):**
- Sales Orders: patch-lines **draft-only**; once submitted/approved, endpoint returns 409 with code `SO_NOT_EDITABLE` (body.details.code) and UI hides Edit when not draft.
- Purchase Orders: patch-lines **draft-only**; once submitted/approved, endpoint returns 409 with code `PO_NOT_EDITABLE` and UI hides Edit when not draft.

**Fulfill Idempotency (SO):**
- Dual-ledger idempotency matches PO receive pattern. Same Idempotency-Key replay returns 200 with current SO state and does **not** reapply movements or advance status.
- Idempotency-Key reuse with a different payload is **first-write-wins**: second call returns 200 with cached first result; no additional movements or fulfilledQty changes are applied.


**Line Editor Component Contract (Sprint W consolidation):**

**Stable Identity:**
- Every line has `id` (server-assigned L{n} pattern) OR `cid` (client tmp-* only)
- NEVER fabricate server ids (L{n} pattern) on client
- Use `generateCid()` from cidGeneration helper for new lines (tmp-{uuid} format)

**React Keying:**
- Use `getOrGenerateLineKey(line)` for stable React keys
- Prefers server `id`, falls back to `cid`, generates if missing
- Never use index-based keys (unstable on reorder/delete)

**Diff Algorithm:**
- Step 1: Remove ops (id for server lines, cid for client-only)
- Step 2: Upsert ops (id for updates, cid for new lines)
- Patchable fields limited to: itemId, qty, uom (INVARIANT 1)
- No-op skip: identical lines not sent (INVARIANT 5)

**Status Guards:**
- PO: draft-only (409 PO_NOT_EDITABLE if not draft)
- SO: draft|submitted|approved (409 SO_NOT_EDITABLE otherwise)

**Error UX (409 guard errors):**
- Detect via `isPatchLinesStatusGuardError(err)`
- Show context-aware message via `getPatchLinesErrorMessage(err, "SO"|"PO")`
- PO message: "Purchase order is not editable in this status (only Draft can be modified)"
- SO message: "Sales order is not editable in this status"
- ALWAYS preserve local edits in UI (no form clear, no auto-navigate)

**Validation:**
- Use `validateEditableLines(lines)` helper (web + mobile)
- Rules: itemId required (trim), uom required (trim), qty > 0
- Returns `{ ok: true }` OR `{ ok: false, message: "Line N: [error]" }`

**Key Files:**
- Mobile Editor: [apps/mobile/src/components/LineEditor.tsx](../apps/mobile/src/components/LineEditor.tsx)
- Web Editor: [apps/web/src/components/LineArrayEditor.tsx](../apps/web/src/components/LineArrayEditor.tsx)
- CID Generation (mobile): [apps/mobile/src/lib/cidGeneration.ts](../apps/mobile/src/lib/cidGeneration.ts)
- CID Generation (web): [apps/web/src/lib/cidGeneration.ts](../apps/web/src/lib/cidGeneration.ts)
- Diff Logic (mobile): [apps/mobile/src/lib/patchLinesDiff.ts](../apps/mobile/src/lib/patchLinesDiff.ts)
- Diff Logic (web): [apps/web/src/lib/patchLinesDiff.ts](../apps/web/src/lib/patchLinesDiff.ts)
- Error Handling (mobile): [apps/mobile/src/lib/patchLinesErrors.ts](../apps/mobile/src/lib/patchLinesErrors.ts)
- Error Handling (web): [apps/web/src/lib/patchLinesErrors.ts](../apps/web/src/lib/patchLinesErrors.ts)
- Validation (mobile): [apps/mobile/src/lib/validateEditableLines.ts](../apps/mobile/src/lib/validateEditableLines.ts)
- Validation (web): [apps/web/src/lib/validateEditableLines.ts](../apps/web/src/lib/validateEditableLines.ts)
### 2.6 Line Identity Contract (Canonical `id` vs. Deprecated `lineId`)

**Context:** Through Sprint M, the codebase used `lineId` to reference line items. Starting in Sprint O (E1-E5), the canonical identifier is now `id` (matching patch-lines semantics). This section documents the transition plan and guarantees.

**Canonical Rule:**
- **`id`** (string): Canonical line identity, always used in responses and client payloads
  - Assigned by server as stable `L{n}` pattern (e.g., `L1`, `L2`, `L3`)
  - Persisted and immutable once created
  - Must be sent by clients in all action requests (receive/reserve/release/fulfill)

**Deprecated Alias:**
- **`lineId`** (string): Legacy field, accepted on input during 1-sprint compatibility window (Sprint O)
  - Will be removed from API input schemas in Sprint P
  - **Never** included in API responses (responses always use `id` only)
  - Clients must migrate to use `id` within this sprint

**Affected Endpoints:**
- `POST /purchasing/po/{id}:receive` — Expects `{ lines: [{ id, deltaQty, ... }] }` (was `lineId`)
- `POST /sales/so/{id}:reserve` — Expects `{ lines: [{ id, deltaQty, ... }] }` (was `lineId`)
- `POST /sales/so/{id}:release` — Expects `{ lines: [{ id, deltaQty, reason? }] }` (was `lineId`)
- `POST /sales/so/{id}:fulfill` — Expects `{ lines: [{ id, deltaQty, ... }] }` (was `lineId`)
- All `{object}:patch-lines` endpoints — Already require `id` (or `cid` for new lines); never used `lineId`

**Transition Timeline:**
| Phase | When | Behavior |
|-------|------|----------|
| **Input Compat** | Sprint O (now) | API accepts both `id` and `lineId` on input; normalizes to `id`; logs legacy usage metrics |
| **Removal** | Sprint P | `lineId` removed from input schemas; clients must use `id` |
| **Cleanup** | Post-Sprint P | Telemetry queries show legacy usage rate; remove if ~0% |

**Implementation (Sprint O E1–E5):**
- ✅ **E1 (Spec):** spec/MBapp-Modules.yaml updated to canonicalize `id` in action payloads
- ✅ **E2 (API):** Action handlers normalize `lineId` → `id` on input; emit structured logs (`so-reserve.legacy_lineId`, `po-receive.legacy_lineId`, etc.); always respond with `id`
- ✅ **E3 (Smoke):** New test `smoke:line-identity:id-canonical` validates all action endpoints accept/emit `id`; existing action smokes updated to use `id` payloads
- ✅ **E4 (Web):** Web app payloads updated to send `id` (all action handlers)
- ✅ **E5 (Mobile):** Mobile app payloads updated to send `id` (all action handlers, type definitions)
- ✅ **E6 (Docs):** This section + Status/smoke-coverage updated

**Selection/Reading Helpers (Read-Side Fallback):**
During transition, helpers like `getPoLineId()` (web) and `pickBestMatchingLineId()` (mobile) retain fallback logic:
```typescript
// Web example
const lineId = String(line?.id ?? line?.lineId ?? "");  // prefer id, fallback lineId

// Mobile example  
getLineId: (line: any) => String(line?.id ?? line?.lineId ?? ""),  // prefer id, fallback lineId
```
This allows responses from legacy systems or test fixtures to still work. **Client payloads, however, always send `id`.**

**Files Modified (E1-E5):**
- Spec: [spec/MBapp-Modules.yaml](../spec/MBapp-Modules.yaml)
- API: [apps/api/src/purchasing/so-reserve.ts](../apps/api/src/purchasing/so-reserve.ts), [so-release.ts](../apps/api/src/sales/so-release.ts), [so-fulfill.ts](../apps/api/src/sales/so-fulfill.ts), [po-receive.ts](../apps/api/src/purchasing/po-receive.ts)
- Web: [apps/web/src/pages/PurchaseOrderDetailPage.tsx](../apps/web/src/pages/PurchaseOrderDetailPage.tsx), [SalesOrderDetailPage.tsx](../apps/web/src/pages/SalesOrderDetailPage.tsx)
- Mobile: [apps/mobile/src/screens/PurchaseOrderDetailScreen.tsx](../apps/mobile/src/screens/PurchaseOrderDetailScreen.tsx), [SalesOrderDetailScreen.tsx](../apps/mobile/src/screens/SalesOrderDetailScreen.tsx), [DevToolsScreen.tsx](../apps/mobile/src/screens/DevToolsScreen.tsx)
- Mobile Types: [apps/mobile/src/features/purchaseOrders/api.ts](../apps/mobile/src/features/purchaseOrders/api.ts), [salesOrders/api.ts](../apps/mobile/src/features/salesOrders/api.ts), [sales/api.ts](../apps/mobile/src/features/sales/api.ts), [purchasing/poActions.ts](../apps/mobile/src/features/purchasing/poActions.ts)

---

### 2.7 Line Editing Invariant (Patch-Lines Pattern)

**Context:** SO and PO support line-by-line edits via `{so,po}:patch-lines` endpoints. Both use a shared pattern to guarantee stable line ids and safe mutation sequences.

**Core Invariant:** `normalize → patch → re-normalize (ensureLineIds)`

**Pattern Overview:**
1. **Load** existing document (SO or PO) with current lines
2. **Validate Status** — patch-lines gated by status:
   - **SO patch-lines:** Allowed in `draft`, `submitted`, `committed` (per spec L4320)
   - **PO patch-lines:** Allowed in `draft` only (per spec L3999)
   - Any other status returns 409 `SO_NOT_EDITABLE` or `PO_NOT_EDITABLE`
3. **Apply Patch Ops** — client sends `PatchLineOp[]` array:
   ```typescript
   { op: "upsert", id: "L1", patch: { qty: 10 } }  // update existing line
   { op: "upsert", cid: "tmp-abc", patch: { itemId: "X", qty: 5 } }  // create new via temp cid
   { op: "remove", id: "L2" }  // delete line, reserve its id to prevent reuse
   ```
4. **Ensure Stable Ids** — defensive call to `ensureLineIds()` guarantees:
   - Existing ids preserved (L1, L2 unchanged)
   - New lines get fresh server-assigned ids (L3, L4, ...)
   - Removed ids are reserved (never reused in future patches)
   - All ids follow `L{n}` pattern (no client-fabricated ids leaked)

**Shared Implementation:**
- [apps/api/src/shared/line-editing.ts](../apps/api/src/shared/line-editing.ts) exports `applyPatchLinesAndEnsureIds<T>()` wrapper
- Both [so-patch-lines.ts](../apps/api/src/sales/so-patch-lines.ts) and [po-patch-lines.ts](../apps/api/src/purchasing/po-patch-lines.ts) call this helper
- Pattern eliminates duplication and enforces invariant consistently

**Status Gates by Entity:**

| Entity | Editable Statuses | Non-Editable → | Error Code | Notes |
|--------|---|---|---|---|
| SalesOrder | `draft`, `submitted`, `committed` | Any other | `SO_NOT_EDITABLE` | 409 Conflict |
| PurchaseOrder | `draft` | `submitted`, ... | `PO_NOT_EDITABLE` | 409 Conflict |

**Verification:**
- ✅ Smoke test `smoke:patch-lines:status-gates-and-ids` validates SO allows all 3 statuses, PO blocks non-draft, all returned lines have valid `L{n}` ids
- ✅ Existing tests `smoke:salesOrders:patch-lines` and `smoke:purchaseOrders:patch-lines` confirm id stability and no-reuse guarantees

**Files:**
- Spec: [spec/MBapp-Modules.yaml](../spec/MBapp-Modules.yaml) lines 4315–4325 (SO), 3993–4003 (PO)
- Shared: [apps/api/src/shared/line-editing.ts](../apps/api/src/shared/line-editing.ts), [patchLinesEngine.ts](../apps/api/src/shared/patchLinesEngine.ts), [ensureLineIds.ts](../apps/api/src/shared/ensureLineIds.ts)
- Handlers: [so-patch-lines.ts](../apps/api/src/sales/so-patch-lines.ts), [po-patch-lines.ts](../apps/api/src/purchasing/po-patch-lines.ts)
- Smokes: [ops/smoke/smoke.mjs](../ops/smoke/smoke.mjs) — `smoke:so:patch-lines:cid`, `smoke:po:patch-lines:cid` (expanded coverage: multi-op, status guard)

**Line Identity Resolution (Sprint AZ E2):**

**Canonical Helper:** [apps/api/src/shared/lineKey.ts](../apps/api/src/shared/lineKey.ts)

**Purpose:** Single source of truth for line id/cid matching across `patchLines.ts`, `ensureLineIds.ts`, and `patchLinesEngine.ts`. Prevents drift if line identity logic needs to change.

**Exported Functions:**

```typescript
// Prefer stable server id (non-tmp-*), fallback to cid, return null if neither
export function lineKey(line: LineLike | null | undefined): string | null

// Check if id matches client-only tmp-* pattern  
export function isClientOnlyId(id: string | undefined | null): boolean

// Trim and validate id value
export function trimId(id: unknown): string | undefined
```

**Usage Pattern:**

Instead of inline id/cid matching:
```typescript
// ❌ Before (duplicated across helpers)
const id = String(line.id || "").trim();
const cid = String(line.cid || "").trim();
if (id && !id.startsWith("tmp-")) return id;
if (cid) return cid;

// ✅ After (centralized)
const key = lineKey(line);  // Returns stable id, cid, or null
```

**Where Applied (Sprint AZ E2):**
- ✅ `patchLines.ts` — All remove/upsert op matching uses `lineKey()`
- ✅ `ensureLineIds.ts` — Existing line collection uses `lineKey()`
- ✅ `patchLinesEngine.ts` — Reserved ID collection uses `lineKey()`

**Guarantee:** All 3 helpers now use identical line identity logic; refactoring line identity semantics requires only one change (lineKey.ts)

---

### 2.8 Object Type Normalization

**Context:** API routes accept object types in path/query params (e.g., `/objects/{type}`, `/objects/{type}/{id}`) and must handle case-insensitive input while maintaining consistent DynamoDB storage.

**Core Invariant:** Route params are case-insensitive; SK prefixes always use canonical type.

**Canonical Type Rules:**
- **Case Normalization:** All types have a single canonical casing (e.g., `salesOrder`, `purchaseOrder`, `inventoryItem`, `backorderRequest`).
- **SK Prefix Consistency:** DynamoDB sort keys (SK) use canonical type: `{canonicalType}#{id}` (e.g., `salesOrder#abc123`, `inventoryItem#xyz789`).
- **Route Tolerance:** API routes accept any casing (`salesorder`, `SALESORDER`, `SalesOrder`) and normalize to canonical form before storage/query.

**Type Aliasing:**
- **inventory ↔ inventoryItem:** The `inventory` type is a legacy alias for canonical `inventoryItem`.
- **Canonical Write Policy:** All writes (POST /objects/inventory) store as `inventoryItem` with SK prefix `inventoryItem#{id}`.
- **Alias-Aware Reads:** GET/UPDATE/DELETE routes try canonical type first, then expand to aliases if not found.

**Normalization Helpers:**

```typescript
// apps/api/src/objects/type-alias.ts

// Normalize any casing to canonical type (or null if unknown)
function normalizeTypeParam(type: string | undefined): string | null {
  if (!type) return null;
  const lower = String(type).toLowerCase().trim();
  return CANONICAL_TYPE_BY_LOWER[lower] ?? null;
}

// Expand type to include aliases for fallback resolution
function expandTypeAliases(type: string): string[] {
  const canonical = normalizeTypeParam(type);
  if (!canonical) return [type];
  
  // inventoryItem → ["inventoryItem", "inventory"]
  if (canonical === "inventoryItem") return ["inventoryItem", "inventory"];
  
  return [canonical];
}
```

**Canonical Type Map (CANONICAL_TYPE_BY_LOWER):**

| Input Casing | Canonical Type |
|--------------|----------------|
| `salesorder`, `salesOrder`, `SALESORDER` | `salesOrder` |
| `purchaseorder`, `purchaseOrder`, `PURCHASEORDER` | `purchaseOrder` |
| `inventory`, `inventoryitem`, `inventoryItem` | `inventoryItem` |
| `backorderrequest`, `backorderRequest` | `backorderRequest` |
| `inventorymovement`, `inventoryMovement` | `inventoryMovement` |
| `product`, `PRODUCT` | `product` |
| `party`, `PARTY` | `party` |

**Usage Pattern:**

1. **Route Handler (Early Normalization):**
   ```typescript
   // apps/api/src/objects/create.ts
   const rawType = event.pathParameters?.type ?? "";
   const canonicalType = normalizeTypeParam(rawType) ?? rawType;
   
   // Use canonicalType for all type-specific logic
   if (canonicalType === "inventoryMovement") { /* validate */ }
   
   // Force canonical type in body before persist
   body.type = canonicalType;
   await createObject({ tenantId, type: canonicalType, body });
   ```

2. **Repo Layer (SK Prefix Building):**
   ```typescript
   // apps/api/src/objects/repo.ts
   export function computeKeys(tenantId: string, type: string, id: string) {
     const canonicalType = normalizeTypeParam(type) ?? type;
     return {
       pk: tenantId,
       sk: `${canonicalType}#${id}`,  // Always canonical
     };
   }
   ```

3. **Alias-Aware Resolution:**
   ```typescript
   // apps/api/src/objects/get.ts
   const resolved = await resolveObjectByIdWithAliases({ tenantId, type, id });
   // Tries: inventoryItem#123, then inventory#123 (if type="inventory")
   if (!resolved) return notFound("Not Found");
   return ok(resolved.obj);
   ```

4. **Type Comparisons (Hardened Inline Checks):**
   ```typescript
   // apps/api/src/purchasing/suggest-po.ts
   import { normalizeTypeParam } from "../objects/type-alias";
   
   // Protect against stored data with variant casing
   if (!bo || normalizeTypeParam(bo.type as string) !== "backorderRequest") {
     skipped.push({ backorderRequestId, reason: "NOT_FOUND" });
     continue;
   }
   ```

**Best Practices (Developer Guidelines):**
- ⚠️ **Never compare raw strings for doc.type/docType** — Always use `normalizeTypeParam()` for comparisons to protect against variant casing in stored data

---

### 2.9 Objects Contract Invariants

**Context:** Objects API (`/objects/{type}`, `/objects/{type}/{id}`, `/objects/{type}/search`) provides CRUD + search across all entity types (product, party, inventoryItem, salesOrder, etc.). These invariants govern type handling, storage keys, alias resolution, and update semantics.

**Core Invariants:**

1. **Type Normalization on Ingress:**
   - All incoming type parameters (path, query) are normalized via `normalizeTypeParam()` before storage or query building.
   - Route tolerates any casing (`salesorder`, `SALESORDER`, `SalesOrder`) → canonical (`salesOrder`).
   - Ensures consistent SK building and eliminates casing-related lookup failures.

2. **Storage Keys Use Canonical Type:**
   - DynamoDB `pk = tenantId`, `sk = {canonicalType}#{id}` (e.g., `salesOrder#abc123`, `inventoryItem#xyz789`).
   - All writes (POST, PUT) normalize type before calling `computeKeys()` to build SK.
   - Guarantees: single canonical SK per entity; no duplicates with variant casing.

3. **Inventory Alias Behavior (Legacy `inventory` ↔ Canonical `inventoryItem`):**
   - **Write Policy:** POST `/objects/inventory` stores as `inventoryItem` with SK `inventoryItem#{id}`.
   - **Read/List/Search Fallback:** GET/PUT/DELETE routes try canonical type first, then expand to aliases via `resolveObjectByIdWithAliases()`.
   - **Union Queries (List/Search):** When no pagination cursor present, `listObjectsWithAliases()` and `searchObjectsWithAliases()` perform union queries across alias types (e.g., query both `inventoryItem#*` and `inventory#*`), then deduplicate by id before sorting.
   - **Alias Expansion:** Only `inventoryItem` has a true alias (`inventory`); other types support casing variants (lowercase/uppercase) but map to single canonical type.

4. **Union Behavior Constraints:**
   - **Pagination Boundary:** When a pagination cursor (`next`) is present, union queries fall back to single-type query using cursor's type to avoid mixed-cursor issues.
   - **Deduplication:** If data corruption causes both `inventory#{id}` and `inventoryItem#{id}` SKs to exist, union helpers deduplicate by id (first occurrence wins) before sorting and returning results.
   - **Stable Sort:** Deduplicated results sorted by `updatedAt` desc (when present on both), then `id` ascending to ensure deterministic pagination across runs.

5. **Ordering Contract (LIST/SEARCH):**
   - **Without filters or q (simple path):** Results returned in DynamoDB SK order (`type#id` ascending). Efficient for large datasets; relies on natural key ordering.
   - **With filters or q (filtered path):** Results deduped by id, then sorted by `updatedAt` desc (when present), then `id` asc. Ensures deterministic ordering across pagination when in-memory filtering is applied.
   - **Union mode (alias types, no pagination cursor):** Results deduped by id, then sorted by `updatedAt` desc, then `id` asc. Matches filtered path ordering to avoid user confusion.
   - **Why:** Filtered/q path requires in-memory filtering, so we enforce consistent sorting to prevent arbitrary SK order from surfacing. Union mode already required sorting for deduplication, so aligning filtered/q with union provides uniform behavior.

6. **PUT Merge Semantics (Partial Update):**
   - **Behavior:** PUT `/objects/{type}/{id}` performs a **partial merge**, not full replacement.
   - **Semantics:** Only fields present in the request body are updated; omitted fields retain their existing values.
   - **Type-Specific Logic:** Handler applies type-specific guards (SKU lock for products, reservation overlap checks for reservations, role validation for parties, movement validation for inventoryMovement) before merge.
   - **Spec Alignment:** Spec reflects merge semantics with `operationId: updateObject` (not `replaceObject`) and explicit merge description.
   - **Developer Note:** To clear a field, send explicit `null` value; omitting a field preserves its current value.

**Permission Mapping:**
- `typeToPermissionPrefix()` in [apps/api/src/index.ts](../apps/api/src/index.ts) maps canonical types to module prefixes:
  - `salesOrder` → `sales`, `purchaseOrder` → `purchase`, `inventoryItem` → `inventory`
  - Falls back to canonical type for unknown types (e.g., `product` → `product`, `party` → `party`)
- Normalizes incoming type first to ensure consistent permission checks regardless of input casing.

**Alias Resolution Flow (GET/PUT/DELETE):**
```typescript
// 1. Try canonical type
const canonical = normalizeTypeParam(typeParam) ?? typeParam;
let obj = await getObject({ tenantId, type: canonical, id });

// 2. If not found and alias exists, try alias types
if (!obj) {
  const aliases = expandTypeAliases(canonical); // ["inventoryItem", "inventory"]
  for (const alias of aliases) {
    obj = await getObject({ tenantId, type: alias, id });
    if (obj) break;
  }
}
```

**Union Query Flow (LIST/SEARCH):**
```typescript
// 1. Check pagination cursor
if (next) {
  // Paginated: use single type from cursor
  return queryByType({ type: cursorType, tenantId, next, limit });
}

// 2. Union query across aliases
const aliases = expandTypeAliases(canonicalType);
const results = await Promise.all(
  aliases.map(alias => queryByType({ type: alias, tenantId, limit }))
);

// 3. Deduplicate by id (first occurrence wins)
const dedupMap = new Map<string, any>();
for (const item of results.flat()) {
  const itemId = item.id ?? item.itemId ?? item.sk?.split("#")[1];
  if (!dedupMap.has(itemId)) dedupMap.set(itemId, item);
}

// 4. Sort by id ascending
return Array.from(dedupMap.values()).sort((a, b) => a.id.localeCompare(b.id));
```

**Developer Guidelines:**
- Always use `normalizeTypeParam()` for type comparisons; never compare raw `doc.type` strings.
- Understand PUT is merge, not replace: omit fields to preserve, send `null` to clear.
- When paginating, avoid union queries to prevent mixed-cursor issues.
- Alias resolution is transparent to clients; both `/objects/inventory` and `/objects/inventoryItem` work correctly.
- ✅ Import `normalizeTypeParam` from `type-alias.ts` whenever checking object types in business logic
- ✅ Use canonical types in all type-specific conditionals (e.g., `if (canonicalType === "inventoryMovement")`)
- ❌ Avoid raw comparisons like `obj.docType === "inventoryMovement"` or `type.toLowerCase() === "salesorder"`

**Verification:**
- ✅ Smoke test `smoke:objects:type-casing-and-alias` validates:
  - SalesOrder GET works via `salesOrder`, `salesorder`, `SALESORDER` paths
  - BackorderRequest LIST/GET work via lowercase `backorderrequest` path
  - Inventory alias: Create via `inventoryItem`, GET via both `inventory` and `inventoryItem`
- ✅ Smoke test `smoke:objects:inventory-alias-update-delete` validates:
  - UPDATE operations work via both canonical (`inventoryItem`) and alias (`inventory`) routes
  - DELETE operations via canonical route return 404 on both routes post-deletion
  - Inventory alias behavior is consistent across all CRUD operations (GET/LIST/UPDATE/DELETE)
- ✅ Smoke test `smoke:inventory:canonical-write-legacy-compat` enforces:
  - POST `/objects/inventory` stores as canonical `inventoryItem` type with `inventoryItem#` SK prefix
  - Legacy route writes are readable via both alias and canonical routes
- ✅ All stored objects have canonical SK prefixes: `inventoryItem#`, `salesOrder#`, `backorderRequest#`
- ✅ Type-specific logic uses `normalizeTypeParam()` for casing-safe comparisons (enforced in CI via smokes)

**Files:**
- Normalization helpers: [apps/api/src/objects/type-alias.ts](../apps/api/src/objects/type-alias.ts)
- Repo layer (SK building): [apps/api/src/objects/repo.ts](../apps/api/src/objects/repo.ts)
- Route handlers: [create.ts](../apps/api/src/objects/create.ts), [get.ts](../apps/api/src/objects/get.ts), [update.ts](../apps/api/src/objects/update.ts), [delete.ts](../apps/api/src/objects/delete.ts)
- Type comparisons: [suggest-po.ts](../apps/api/src/purchasing/suggest-po.ts), [movements.ts](../apps/api/src/inventory/movements.ts)
- Smoke tests: [ops/smoke/smoke.mjs](../ops/smoke/smoke.mjs) — `smoke:objects:type-casing-and-alias`, `smoke:inventory:onhand`
- CI integration: [ops/ci-smokes.json](../ops/ci-smokes.json)

### 2.10 Objects Pagination Contracts & Telemetry (Sprint AS, 2026-01-05)

**Context:** Objects list/search operations support two distinct pagination strategies with different performance characteristics and cursor semantics. Sprint AS adds structured telemetry (optional logging) and cost visibility without changing behavior.

**Pagination Paths:**

1. **Simple Path (No Filters, No q):**
   - **Cursor Type:** DynamoDB key cursor (`{pk, sk}`), base64-encoded
   - **Operation:** Single DynamoDB Query per page; native pagination via ExclusiveStartKey
   - **Cost:** ~5-10 RCUs per page (depends on item size)
   - **Latency:** 10-50ms typical
   - **Efficiency:** ✅ Excellent — Each page operation minimal; no re-fetches
   - **Example:** `GET /objects/salesOrder?limit=20` returns DynamoDB SK order (`salesOrder#id` ascending)

2. **Filtered Path (Filters OR q Present):**
   - **Cursor Type:** Offset cursor (`{offset: N}`), base64-encoded
   - **Operation:** Full result set fetch (up to 10,000 items), then in-memory filter, sort, and slice
   - **Cost:** 100-500+ RCUs per page (depends on total items scanned)
   - **Latency:** 500ms - 5s+ (increases with dataset size)
   - **Efficiency:** ⚠️ Costly — Every paginated request re-fetches all matching items
   - **Example:** `GET /objects/backorderRequest?filter.soId=SO123&limit=20` scans all backorderRequests, filters in-memory, returns page 1
   - **Ordering:** Deterministic via in-memory sort: `updatedAt desc` (recent first), then `id asc` (tiebreaker)
   - **Rationale:** Consistent ordering across paginated requests when filtering is applied

3. **Union Path (Inventory Alias, No Pagination):**
   - **Cursor Type:** None (returns `next: null`)
   - **Operation:** Up to 2 DynamoDB Queries (one per alias type), fetch ≤50 items each, deduplicate, sort
   - **Cost:** 10-30 RCUs (limited blast radius)
   - **Latency:** 100-200ms typical
   - **Efficiency:** ✅ Bounded — Hard cap at 50 items/type

**Telemetry (Sprint AS):**

Structured telemetry logs JSON events to stdout for cost analysis and performance monitoring. Disabled by default; enable via:
```bash
export MBAPP_OBJECTS_QUERY_METRICS=1
node ops/smoke/smoke.mjs smoke:objects:list-filter-cursor-roundtrip
# Logs: {"event": "objects:list:filtered-cost", "pagesFetched": 3, "itemsFetched": 150, ...}
```

**Log Events (when MBAPP_OBJECTS_QUERY_METRICS=1):**
- `objects:list:path` / `objects:search:path`: Path selection (simple vs filtered), limit, timing
- `objects:list:filtered-cost` / `objects:search:filtered-cost`: DynamoDB pages fetched, items scanned, matched, offset depth, timing breakdown (dbFetchMs, dedupeMs, sortMs, totalMs)
- `objects:list:union` / `objects:search:union`: Union queries, items fetched per alias, deduped count

**Warning Thresholds (Always Logged, No Flag Required):**
- `objects:*:high-cost`: pagesFetched ≥20 OR itemsFetched ≥5,000 OR cap hit — identifies expensive queries
- `objects:*:deep-offset`: offset ≥500 — warns on deep pagination patterns
- `objects:*:union-pagination-rejected`: Union query with pagination cursor — falls back to single-type (logs why)

**Files:**
- Telemetry implementation: [apps/api/src/objects/repo.ts](../apps/api/src/objects/repo.ts) (listObjects/searchObjects), [apps/api/src/objects/type-alias.ts](../apps/api/src/objects/type-alias.ts) (union path)
- Env flag: `MBAPP_OBJECTS_QUERY_METRICS` (defaults to "0")
- Thresholds: Deep offset 500, high cost pages 20, high cost items 5,000
- Smoke test: [ops/smoke/smoke.mjs](../ops/smoke/smoke.mjs) `smoke:objects:list-simple-key-cursor` validates simple-path key cursor behavior

**Developer Notes:**
- Simple path queries are efficient; use them by omitting filters and q
- Filtered queries are costly; consider adding GSI for hot filters (future optimization)
- Offset pagination works but is inefficient; clients should avoid deep offsets (100+ pages)
- Enable telemetry during load testing to identify cost drivers
- Review `high-cost` warnings in production logs to guide optimization priorities

---



| Module | List Screen | Detail Screen | Create/Edit | Search/Filter | Status |
|--------|------------|---------------|-------------|---------------|--------|
| **Parties** | ✅ PartyListScreen | ✅ PartyDetailScreen | ❌ Missing | ✅ Search by name, role filter UI present | **Partial** — No create/edit forms |
| **Products** | ✅ ProductsListScreen | ✅ ProductDetailScreen | ❌ Missing | ✅ Search by q param | **Partial** — No create/edit forms |
| **Inventory** | ✅ InventoryListScreen | ✅ InventoryDetailScreen | ❌ Missing | ✅ Search by q | **Partial** — No create/edit, no adjust UI |
| **Purchase Orders** | ✅ PurchaseOrdersListScreen | ✅ PurchaseOrderDetailScreen | ❌ Missing | ✅ ViewPicker + SaveViewModal + viewId | **Partial** — Has receive line modal, no create/edit draft |
| **Sales Orders** | ✅ SalesOrdersListScreen | ✅ SalesOrderDetailScreen | ✅ Create draft button | ✅ ViewPicker + SaveViewModal + viewId | **Near-complete** — Missing edit/line management |
| **Backorders** | ✅ BackordersListScreen | ❌ No detail screen | ❌ Missing | ✅ Filter by vendor, SO, item, status | **Partial** — List-only, no detail/edit |
| **Events** | ✅ EventsListScreen | ✅ EventDetailScreen | ❌ Missing (has seed button in dev) | ❌ No filter UI | **Read-only** — Feature-flagged registrations section |
| **Registrations** | ✅ RegistrationsListScreen | ✅ RegistrationDetailScreen | ❌ Missing | ❌ No filter UI | **Read-only** — Feature flag OFF by default |
| **Reservations** | ✅ ReservationsListScreen | ✅ ReservationDetailScreen | ✅ CreateReservationScreen | ❌ No filter UI | **Feature-flagged** — Create exists, edit missing |
| **Resources** | ✅ ResourcesListScreen | ✅ ResourceDetailScreen | ❌ Missing | ❌ No filter UI | **Read-only** |
| **Route Plans** | ✅ RoutePlanListScreen | ✅ RoutePlanDetailScreen | ✅ Create plan button | ❌ No filter UI | **Partial** — Create exists, no edit |
| **Views** | ❌ Missing | ❌ Missing | ❌ Missing | ❌ N/A | **Not implemented** |
| **Workspaces** | ✅ WorkspaceHubScreen (hub only) | ❌ Missing | ❌ Missing | ✅ Search/filter in hub | **List-only** — No apply/detail/edit |

### Mobile API Integration Summary

**Features API modules exist for:**
- ✅ parties, products, inventory, purchaseOrders, salesOrders, backorders
- ✅ events, registrations, reservations, resources, routing, workspaces, views
- ✅ _shared utilities (http, config, fields, AutoCompleteField, Toast)

**Missing UI patterns:**
- **Create/Edit forms** for Parties, Products, Inventory, Purchase Orders
- **Line item editors** for SO/PO (add/remove/edit lines)
- **Filter UI** for most list screens (only Backorders has rich filters)
- **Bulk actions** (select multiple items, batch operations)
- **Validation feedback** (real-time field errors, required field indicators)

---

## 4. Web UI Patterns (apps/web/src)

NOTE: The block below reflected Sprint XXVI–XXVII state. As of 2025-12-25 web has real pages.

**Current Pages (as of 2025-12-25)**

| Page | Route |
|------|-------|
| Parties list/detail | /parties, /parties/:id |
| Products (forms) | /products/new, /products/:id/edit |
| Inventory list/detail | /inventory, /inventory/:id |
| Backorders list | /backorders |
| Purchase orders list/detail | /purchase-orders, /purchase-orders/:id |
| Locations list | /locations |

**Current Structure:**
```
apps/web/src/
  App.tsx          # Single test page with hardcoded CRUD operations
  main.tsx         # Entrypoint
  lib/
    api.ts         # Canonical API client (Objects CRUD only)
```

**UI Coverage:**

| Module | Status |
|--------|--------|
| **All Tier 1–4 modules** | ❌ **No screens exist** — Web has single test page only |

**App.tsx Functions:**
- `tenants()` — GET /tenants (test only)
- `create()` — POST /objects/{type}
- `getByQuery()`, `getByPath()` — GET /objects/{type}?id= or GET /objects/{type}/{id}
- `update()` — PUT /objects/{type}/{id}
- `del()` — DELETE /objects/{type}/{id}
- `doList()` — GET /objects/{type} with pagination
- `doSearch()` — POST /objects/{type}/search with body
- Manual input fields for type, name, tag, id

**Status:** ⚠️ **Web is stub-only** — No production screens, no routing, no layouts, no auth

---

## 5. Smoke Test Conventions

**File:** [ops/smoke/smoke.mjs](../ops/smoke/smoke.mjs)  
**Naming:** `smoke:{module}:{flow}` (e.g., `smoke:po:submit-approve-receive`)  
**Cleanup Rules:**
- Draft objects created during tests are automatically deleted by cleanup hooks
- Approved/submitted objects are left in place (require manual cleanup or separate archival script)
- Test isolation: Each smoke creates unique objects with timestamp-based names

**Structure Pattern:**
```javascript
export async function smoke_module_flow(API_BASE, authToken) {
  const ctx = { createdIds: [] };
  try {
    // 1. Setup
    const obj = await createDraft(...);
    ctx.createdIds.push(obj.id);
    
    // 2. Action sequence
    await submitDraft(obj.id);
    await performAction(obj.id);
    
    // 3. Assertions
    assert.strictEqual(obj.status, 'expected-status');
    
    return { pass: true };
  } catch (err) {
    return { pass: false, error: err.message };
  } finally {
    await cleanup(ctx.createdIds);
  }
}
```

**Opt-In Proofs:** Tests that verify specific guards/flags use descriptive names: `smoke:vendor-guard-enforced`, `smoke:po-receive-after-close-guard`

---

## 6. Spec & Types Generation Workflow

**Source of Truth:** [spec/MBapp-Modules.yaml](../spec/MBapp-Modules.yaml) (OpenAPI 3.0)  
**Type Generation:**
1. Edit `spec/MBapp-Modules.yaml` when adding/changing API contracts
2. Run `npm run generate-types` (in workspace root or `apps/api/`)
3. Generated types appear in `apps/api/src/generated/openapi-types.ts`
4. Import types in handlers: `import { PurchaseOrder, CreatePurchaseOrderRequest } from './generated/openapi-types';`

**Contract-First Workflow:**
- Spec changes happen BEFORE code changes (prevents drift)
- Breaking changes require version bumps (e.g., `/v2/purchase-orders`)
- Additive changes (new optional fields) are safe and preferred

**Validation:** All API handlers should validate request bodies against spec schemas using generated types

### 6.1 Permission Annotations

Permissions are annotated in the spec as vendor extensions (`x-mbapp-permission`) on operation objects:

```yaml
/purchasing/suggest-po:
  post:
    x-mbapp-permission: purchase:write
    summary: Build a PO draft from backorder requests
    # ... rest of operation definition
```

**Convention:**
- Vendor extension key: `x-mbapp-permission`
- Value: canonical permission key (`{type}:{action}`, e.g., `objects:write`, `purchase:approve`)
- Location: operation object (same level as `summary`, `parameters`, `responses`)
- Purpose: Single source of truth for permission requirements; used by API handlers for permission checks and documentation

**Permission keys in use:**
- `objects:write` (generic fallback for object mutations: backorder ignore/convert, location CRUD)
- `purchase:write` (purchase order creation and suggestion)
- `purchase:approve`, `purchase:receive`, `purchase:cancel`, `purchase:close` (granular PO state transitions)
- `sales:write`, `sales:commit`, `sales:reserve`, `sales:fulfill`, `sales:cancel`, `sales:close` (sales order state transitions, Sprint AC)
- `inventory:write`, `inventory:adjust` (inventory mutations)
- `inventory:read`, `inventory:write` (inventoryItem CRUD via requireObjectPerm(), Sprint AC)
- `party:write`, `product:write` (party/product mutations)

**Generated artifacts (Sprint X E2, expanded Sprint AC):**

The spec build pipeline automatically generates TypeScript and JSON permission artifacts from the annotations:

1. **Source:** [spec/MBapp-Modules.yaml](../spec/MBapp-Modules.yaml) (manual `x-mbapp-permission` annotations on operations)
2. **Generator:** [ops/tools/generate-permissions.mjs](../ops/tools/generate-permissions.mjs) (runs as part of `npm run spec:bundle`)
3. **Outputs:**
   - [spec/generated/permissions.json](../spec/generated/permissions.json) — JSON map of `"METHOD /path"` → `"permission:key"`
   - [spec/generated/permissions.ts](../spec/generated/permissions.ts) — TypeScript constants + types (31 endpoints, 18 permissions as of Sprint AC)
   - [apps/web/src/generated/permissions.ts](../apps/web/src/generated/permissions.ts) — Web convenience copy
   - [apps/mobile/src/generated/permissions.ts](../apps/mobile/src/generated/permissions.ts) — Mobile convenience copy

**Usage:**

```typescript
// Import from generated artifacts
import { PERMISSIONS_BY_ENDPOINT, ENDPOINTS_BY_PERMISSION } from '../generated/permissions';

// Example: Look up permission required for an endpoint
const requiredPerm = PERMISSIONS_BY_ENDPOINT['POST /purchasing/suggest-po']; // "purchase:write"

// Example: Find all endpoints requiring a specific permission
const purchaseEndpoints = ENDPOINTS_BY_PERMISSION['purchase:write'];
// ["POST /purchasing/po:create-from-suggestion", "POST /purchasing/suggest-po"]

// Ergonomic aliases (Sprint X E4, expanded Sprint AC): Use these for cleaner permission checks
import { PERM_OBJECTS_WRITE, PERM_PURCHASE_WRITE, PERM_SALES_COMMIT } from '../generated/permissions';

const canWrite = hasPerm(policy, PERM_OBJECTS_WRITE);  // cleaner than string literals
const canPurchase = hasPerm(policy, PERM_PURCHASE_WRITE);
const canCommitSO = hasPerm(policy, PERM_SALES_COMMIT);

// All available exports:
// - PERMISSIONS_BY_ENDPOINT (endpoint → permission map)
// - ENDPOINTS_BY_PERMISSION (permission → endpoints array)
// - PERM_OBJECTS_WRITE, PERM_PURCHASE_*, PERM_SALES_*, PERM_INVENTORY_*, etc. (ergonomic aliases)
// - PERMISSION_KEYS (array of all unique permission strings)
// - PermissionKey, EndpointKey (TypeScript types)
```

**Pipeline:**

```bash
npm run spec:bundle      # bundles spec AND generates permission artifacts
npm run spec:permissions # standalone permissions generation (if needed)
```

Artifacts are committed to the repo and should be regenerated whenever spec annotations change.

---

## 7. Archive: Sprint XXVI+ Report Notes (Historical)

<details>
<summary>Original Sprint XXVI-XXVII Foundations Report + Subsequent Addenda</summary>

### Sprint XLI: Inventory Putaway + Cycle Count Operations (2025-12-26) (Tier 1–4 MVP)

### 4.1 Objects CRUD (Foundation)

| Endpoint | Method | Status | Mobile | Web |
|----------|--------|--------|--------|-----|
| `/objects/{type}` | GET | ✅ Implemented | ✅ Used | ✅ Used |
| `/objects/{type}` | POST | ✅ Implemented | ✅ Used | ✅ Used |
| `/objects/{type}/{id}` | GET | ✅ Implemented | ✅ Used | ✅ Used |
| `/objects/{type}/{id}` | PUT | ✅ Implemented | ✅ Used | ✅ Used |
| `/objects/{type}/{id}` | DELETE | ✅ Implemented | ⚠️ Partial | ✅ Used |
| `/objects/{type}/search` | POST | ✅ Implemented | ✅ Used (parties) | ✅ Used |

**Notes:**
- Mobile uses search for `party` type with role filtering
- Filter params (`filter.soId`, `filter.itemId`, etc.) work via query params on GET /objects/{type}

---

### 4.2 Parties

| Endpoint | Method | Status | Mobile | Web | MVP Need |
|----------|--------|--------|--------|-----|----------|
| `/objects/party` | GET | ✅ | ✅ List | ❌ | **Required** |
| `/objects/party` | POST | ✅ | ❌ No form | ❌ | **Required** |
| `/objects/party/{id}` | GET | ✅ | ✅ Detail | ❌ | **Required** |
| `/objects/party/{id}` | PUT | ✅ | ❌ No form | ❌ | **Required** |
| `/objects/party/search` | POST | ✅ | ✅ Used | ❌ | **Required** |

**Mobile gaps:** Create/Edit party forms  
**Web gaps:** All screens  
**API complete:** ✅

---

### 4.3 Products

| Endpoint | Method | Status | Mobile | Web | MVP Need |
|----------|--------|--------|--------|-----|----------|
| `/objects/product` | GET | ✅ | ✅ List | ❌ | **Required** |
| `/objects/product` | POST | ✅ | ❌ No form | ❌ | **Required** |
| `/objects/product/{id}` | GET | ✅ | ✅ Detail | ❌ | **Required** |
| `/objects/product/{id}` | PUT | ✅ | ❌ No form | ❌ | **Required** |
| `/objects/product/search` | POST | ✅ | ❌ | ❌ | Optional |

**Mobile gaps:** Create/Edit product forms  
**Web gaps:** All screens  
**API complete:** ✅

---

### 4.4 Inventory

| Endpoint | Method | Status | Mobile | Web | MVP Need |
|----------|--------|--------|--------|-----|----------|
| `/objects/inventoryItem` | GET | ✅ | ✅ List | ❌ | **Required** |
| `/objects/inventoryItem` | POST | ✅ | ❌ No form | ❌ | **Required** |
| `/objects/inventoryItem/{id}` | GET | ✅ | ✅ Detail | ❌ | **Required** |
| `/inventory/{id}/onhand` | GET | ✅ | ✅ Used | ❌ | **Required** |
| `/inventory/{id}/movements` | GET | ✅ | ✅ Used | ❌ | **Required** |
| `/inventory/onhand:batch` | POST | ✅ | ❌ | ❌ | Optional |
| `/inventory/{id}/adjust` | POST | ✅ | ❌ No UI | ❌ | **Required for MVP** |
| `/inventory/search` | POST | ✅ | ❌ | ❌ | Optional |

**Mobile gaps:** Adjust inventory UI, create inventory item form  
**Web gaps:** All screens  
**API complete:** ✅

#### 4.4.1 Inventory Movement Indexing

**Canonical & Timeline Index (Dual-Write):**
- Each movement write creates two DynamoDB items:
  - **Canonical:** `pk=tenantId, sk=inventoryMovement#{movementId}` — source of truth by id
  - **Timeline:** `pk=tenantId, sk=inventoryMovementAt#{atIso}#{movementId}` — time-ordered retrieval
- Both items contain identical movement data (id, itemId, action, qty, locationId, lot, etc.)

**Why:** 
- List endpoints (`GET /inventory/movements?locationId=...`, `GET /inventory/{itemId}/movements`) query the timeline index for correct pagination semantics: movements are retrieved in chronological order, so filtering by locationId/itemId is O(limit) instead of O(sparse).
- Consistent reads on both queries ensure read-after-write correctness for newly created movements, eliminating transient gaps.

**Implementation:** [apps/api/src/inventory/movements.ts](../../apps/api/src/inventory/movements.ts#L359-L428) — `createMovement()` performs atomic `BatchWriteCommand` with both items; graceful error logging if timeline write fails (canonical item preserved for fallback scans).

#### 4.4.2 InventoryMovement Write Invariants

**Requirement:** All movement writes MUST use the shared helper `createMovement()` ([apps/api/src/inventory/movements.ts](../../apps/api/src/inventory/movements.ts#L359)).

**Why:**
- Direct `PutCommand` writes bypass dual-write logic, leaving movements invisible to timeline queries.
- This breaks `GET /inventory/{itemId}/onhand` (reads timeline index) and causes onhand checks to fail.
- Example: PO receive that writes only canonical item → onhand endpoint sees zero new qty → smoke:close-the-loop fails.

**Writers Using `createMovement()`:**
- `POST /inventory/{id}:putaway` — calls `createMovement()` with action "putaway"
- `POST /inventory/{id}/adjust` — calls `createMovement()` with action "adjust"
- `POST /inventory/{id}:cycle-count` — calls `createMovement()` with action "cycle_count"
- `POST /purchasing/po/{id}:receive` — calls `createMovement()` with action "receive"
- `POST /sales/so/{id}:reserve` — calls `createMovement()` with action "reserve"
- `POST /sales/so/{id}:release` — calls `createMovement()` with action "release"
- `POST /sales/so/{id}:fulfill` — calls `createMovement()` with action "fulfill"

**Validation:** `createMovement()` enforces `tenantId`, `itemId`, `qty`, and `action` at entry point (throws error if missing).

#### 4.4.3 Inventory Movement Read Fallback

**Defensive Pattern:**
- Readers (`listMovementsByItem()` and `listMovementsByLocation()`) query the **timeline index** first (`inventoryMovementAt#...`).
- If timeline returns **zero results and no pagination cursor**, the reader runs a **fallback query** against the **canonical index** (`inventoryMovement#...`).
- Fallback results are sorted, filtered, and returned with the same schema as timeline results.

**Why:**
- This guards against accidental bugs where a movement writer skips dual-write and writes only the canonical record.
- Without the fallback, such movements would be permanently invisible to clients until the bug is fixed and data is replayed.
- With the fallback, clients still receive correct data; the bug is surfaced via warning logs so it can be detected early.

**Logging:**
- When fallback is triggered, a warning is logged with:
  - `movementTimelineMissing=true`
  - `tenantId`, `itemId`, count of results recovered from canonical index
  - A note describing the probable cause
- Example: "Movements found in canonical index but missing from timeline index. A movement writer may have skipped dual-write."

**Non-Goal:**
- The fallback is **NOT a substitute for dual-write**. The contract remains: all writers MUST use `createMovement()`.
- The fallback is a **safety net** for operational resilience during troubleshooting and incident response.

---

### 4.5 Purchase Orders

| Endpoint | Method | Status | Mobile | Web | MVP Need |
|----------|--------|--------|--------|-----|----------|
| `/objects/purchaseOrder` | GET | ✅ | ✅ List | ❌ | **Required** |
| `/objects/purchaseOrder` | POST | ✅ | ❌ No form | ❌ | **Required** |
| `/objects/purchaseOrder/{id}` | GET | ✅ | ✅ Detail | ❌ | **Required** |
| `/objects/purchaseOrder/{id}` | PUT | ✅ | ❌ No form | ❌ | **Required** |
| `/purchasing/po/{id}:submit` | POST | ✅ | ✅ Used | ❌ | **Required** |
| `/purchasing/po/{id}:approve` | POST | ✅ | ✅ Used | ❌ | **Required** |
| `/purchasing/po/{id}:receive` | POST | ✅ | ✅ Modal | ❌ | **Required** |
| `/purchasing/po/{id}:cancel` | POST | ✅ | ❌ | ❌ | Optional |
| `/purchasing/po/{id}:close` | POST | ✅ | ✅ Used | ❌ | **Required** |
| `/purchasing/suggest-po` | POST | ✅ | ✅ Used | ❌ | **Required for backorders** |
| `/purchasing/po:create-from-suggestion` | POST | ✅ | ✅ Used | ❌ | **Required for backorders** |

**Mobile gaps:** Create/Edit PO draft forms, line item editor  
**Web gaps:** All screens  
**API complete:** ✅

---

### 4.6 Sales Orders

| Endpoint | Method | Status | Mobile | Web | MVP Need |
|----------|--------|--------|--------|-----|----------|
| `/objects/salesOrder` | GET | ✅ | ✅ List | ❌ | **Required** |
| `/objects/salesOrder` | POST | ✅ | ✅ Create draft | ❌ | **Required** |
| `/objects/salesOrder/{id}` | GET | ✅ | ✅ Detail | ❌ | **Required** |
| `/objects/salesOrder/{id}` | PUT | ✅ | ❌ No form | ❌ | **Required** |
| `/sales/so/{id}:submit` | POST | ✅ | ✅ Used | ❌ | **Required** |
| `/sales/so/{id}:commit` | POST | ✅ | ✅ Used | ❌ | **Required** |
| `/sales/so/{id}:reserve` | POST | ✅ | ✅ Used | ❌ | **Required** |
| `/sales/so/{id}:fulfill` | POST | ✅ | ✅ Used | ❌ | **Required** |
| `/sales/so/{id}:release` | POST | ✅ | ✅ Used | ❌ | Optional |
| `/sales/so/{id}:cancel` | POST | ✅ | ❌ | ❌ | Optional |
| `/sales/so/{id}:close` | POST | ✅ | ✅ Used | ❌ | **Required** |

**Mobile gaps:** Edit SO/lines UI (currently create-only)  

---

### Shared Line Editing Contract (patch-lines)

**Why:** Stable line identity with minimal diffs and a reusable editor model across web/mobile. Avoids full-array replacements, reduces payload size, and standardizes line edits.

**Contract:**
- **Server-authoritative `line.id`:** Stable `L{n}` format (L1, L2, L3...) assigned by `ensureLineIds()`. Server preserves existing IDs on updates and assigns new IDs starting from max+1.
- **Client `cid` key:** Optional temporary key for new lines before persistence; best-effort matching only when `id` is absent.
- **Normalize → patch → re-normalize:** Clients compute minimal ops, server applies `applyPatchLines()` without reordering, then runs `ensureLineIds()` to assign any missing IDs.
- **Reserved IDs guarantee:** Removed line IDs are reserved and **never reused** by `ensureLineIds()` to prevent identity churn. New lines always get fresh IDs beyond the max.
- **Sequencing (SO + PO):** Both endpoints use identical flow: `applyPatchLines()` → reserve removed IDs → `ensureLineIds(startAt: maxExisting+1)`.
- **Status guards:** Sales Orders allow patching in `draft|submitted|approved`; Purchase Orders are **draft-only**.
- **Error contract:** Non-editable states return `409 Conflict` with structured details: `{ code: "SO_NOT_EDITABLE" | "PO_NOT_EDITABLE", status: string }`.

**Where:**
- Shared utility: [apps/api/src/shared/patchLines.ts](../apps/api/src/shared/patchLines.ts)
- ID assignment: [apps/api/src/shared/ensureLineIds.ts](../apps/api/src/shared/ensureLineIds.ts)
- Sales endpoint: [apps/api/src/sales/so-patch-lines.ts](../apps/api/src/sales/so-patch-lines.ts)
- Purchasing endpoint: [apps/api/src/purchasing/po-patch-lines.ts](../apps/api/src/purchasing/po-patch-lines.ts)
- Spec: [spec/MBapp-Modules.yaml](../spec/MBapp-Modules.yaml)

**How to verify:**
- `smoke:salesOrders:patch-lines` — Validates update + add, ensures new lines receive server-assigned IDs.
- `smoke:purchaseOrders:patch-lines` — Mirrors SO behavior; CI-covered.

**Parity status:** ✅ **Complete (Sprint G)** — Both SO and PO handlers aligned with identical sequencing and error shapes.
**Web status:** SalesOrder and PurchaseOrder edit pages use patch-lines via shared helper; broader module screens remain pending.
**API complete:** ✅

---

### 4.7 Backorder Fulfillment & Visibility

**What triggers a BackorderRequest:**
- SO commit with `strict: false` and insufficient inventory creates BackorderRequest for each shortage line (status: `open`).
- BackorderRequest has fields: `{ id, soId, soLineId, itemId, qty, createdAt, status, preferredVendorId, fulfilledQty?, remainingQty? }`.
  - `fulfilledQty` and `remainingQty`: nullable, server-maintained during PO receive (not client-writable).
  - **No reverse index:** PO lines store `backorderRequestIds[]`; backorders do NOT store PO IDs (navigate via PO detail).
- Status lifecycle: `open` → (converted by suggest-po) → `converted` OR (user ignores) → `ignored` OR (PO partial receive) → `open/converted` OR (PO full receive) → `fulfilled`.

**suggest-po MOQ behavior (Sprint I):**
- `/purchasing/suggest-po` groups backorder requests by vendor and generates draft PO lines.
- **MOQ is applied regardless of vendor source:** `suggest-po` now loads `product.minOrderQty` after determining `vendorId` (whether from explicit override, backorder preference, or product derivation).
- When drafting a line from a backorder request qty < MOQ, the draft line qty is bumped to the MOQ with `adjustedFrom` tracking the original qty (for transparency).
- **Example:** Backorder qty=10, product minOrderQty=50 → draft line qty=50, adjustedFrom=10.
- Validation in smoke test: `smoke:suggest-po:moq` creates backorder qty=10 with minOrderQty=50 product, suggests PO, asserts draftQty=50.

**Partial PO receive behavior (Sprint I):**
- `/purchasing/po/{id}:receive` updates line-level `receivedQty` and decrements `backorderRequest.remainingQty`.
- Backorder status does NOT change to `fulfilled` until `remainingQty === 0`.
- If received qty < remaining qty, backorder stays `open` or `converted`; if received qty = remaining qty, status → `fulfilled`.
- **Example:** Backorder remainingQty=10, receive deltaQty=5 → remainingQty=5, status stays `open/converted`.
- Validation in smoke test: `smoke:backorders:partial-fulfill` creates backorder qty=10, receives qty=5, asserts status=`converted`, remainingQty=5, fulfilledQty=5.

**Visibility (Web + Mobile):**
- **Web backorder detail:** `/backorders/:id` shows full context (SO link, item link, vendor link), fulfillment progress bar (when fulfilledQty present), and ignore action button.
- **Mobile backorder detail:** `BackorderDetail` screen shows full context with navigate buttons, fulfillment progress, and ignore action with confirmation alert.
- **Web PO detail:** Shows linked backorder IDs per line; chips now link directly to `/backorders/:id` detail page.
- **Web SO detail:** Breakdown badges (open/converted/fulfilled/ignored) are clickable, linking to filtered backorders list by status.
- **Mobile SO detail:** Fetches all backorder statuses via `apiClient.post('/objects/backorderRequest/search', { filter: { soId } })` with status param loop; displays BackorderHeaderBadge with optional breakdown (open/converted/fulfilled/ignored with unit counts).
- **Mobile backorders list:** Tap row → detail; long-press → multi-select for bulk ignore/convert actions.
- **Web backorders list:** Row click → detail (stopPropagation on checkbox/actions to preserve multi-select).

**API complete:** ✅  
**Smoke coverage:** `smoke:backorders:partial-fulfill`, `smoke:suggest-po:moq`  
**Polish complete (Sprint I):** ✅

---

### 4.7 Views & Workspaces (Sprint III + Sprint Q Hardening)

| Endpoint | Method | Status | Mobile | Web | MVP Need |
|----------|--------|--------|--------|-----|----------|
| `/views` | GET | ✅ | ✅ (v1: PO/SO) | ✅ | **Required for saved filters** |
| `/views` | POST | ✅ | ✅ (v1: PO/SO) | ✅ | **Required** |
| `/views/{id}` | GET | ✅ | ✅ (v1: PO/SO) | ✅ | **Required** |
| `/views/{id}` | PATCH | ✅ | ✅ (v1: PO/SO) | ✅ | **Required** (Sprint Q: used for Update View; Sprint R mobile) |
| `/views/{id}` | DELETE | ✅ | ✅ (v1: manage) | ✅ | Optional |
| `/workspaces` | GET | ✅ (aliases views) | 🟨 (hub list only) | 🟨 (list/detail) | Optional (nice-to-have) |
| `/workspaces` | POST | ✅ (aliases views) | 🟨 (hub list only) | 🟨 (list/detail) | Optional |
| `/workspaces/{id}` | GET | ✅ (aliases views) | 🟨 (hub list only) | 🟨 (list/detail) | Optional |

- **Web Views:** Pages exist for list/new/detail/edit at `/views`, `/views/new`, `/views/:id`, `/views/:id/edit`.
- **Web Workspaces:** Pages exist for list/detail at `/workspaces`, `/workspaces/:id`; no create/edit UI.
- **Workspaces v1 model:** `/workspaces` endpoints currently read/write `type="view"` items (a “views hub” wrapper in v1); no distinct workspace storage yet.
- **Feature flags:** `FEATURE_VIEWS_ENABLED` / `X-Feature-Views-Enabled` are historical/client gating. Handlers use RBAC; no server-side flag guard today.

- **List pages:** Sales Orders, Purchase Orders, Inventory, Parties, Backorders, and Products can apply `?viewId` and save current filters as a View (optional shared flag) directly from the list UI.

**Sprint Q Hardening (2025-12-30):**
- ✅ **Server-side filter validation:** `/views` POST and PATCH endpoints validate filter shape (field: non-empty string, op: enum, value: type-appropriate). Returns 400 with clear message for invalid filters. No deep field-existence validation (deferred).
- ✅ **Web "Update View" affordance:** When a view is applied via `?viewId`, SaveViewButton shows "Update View" (primary) + "Save as New" (secondary) options. Uses PATCH `/views/{id}` to persist changes without creating duplicates (reduces view sprawl).
- ✅ **Columns stored but not rendered:** View `columns` array is persisted in API/DB but currently not used by web table rendering (UI ignores columns field; tables show default column set). Sort field is stored; whether applied depends on list page implementation.
- ✅ **Smoke coverage:** `smoke:views:apply-to-po-list` validates filter application constrains list results; `smoke:views:validate-filters` validates server-side filter rejection.

**Sprint R Mobile Save View v1 (2025-12-30):**
- ✅ **Mobile API support:** `useViewsApi()` hook extended with `create(payload)` and `patch(id, payload)` methods; auth token wired to AsyncStorage
- ✅ **PO/SO list UI:** SaveViewModal component added for save/update workflows; integrated into PurchaseOrdersListScreen and SalesOrdersListScreen with primary "Save"/"Update" button affordance
- ✅ **State mapping:** Bidirectional (applyView ↔ buildViewFromState) with round-trip guarantee; mapViewToMobileState applies filters, buildViewFromState reverses mapping for save
- ✅ **Supported fields (v1):**
  - **PO:** q (contains), status (eq), vendorId (eq), sort (createdAt/updatedAt only)
  - **SO:** q (contains), status (eq), sort (createdAt/updatedAt only)
  - **Sort:** Limited to `createdAt` or `updatedAt` fields with `asc`/`desc` direction (other fields dropped)
  - **Shared flag:** Defaults to false (if omitted from payload); not exposed in UI for v1
- ✅ **Implementation pattern:** Inverse mapper normalizes state → View.filters by dropping empty values, validating operators, and entity-specific field mappings
- ✅ **Limitations:** Inventory/Parties/Products list save not yet implemented; workspaces hub UI absent; columns array not applied to mobile lists

**Sprint S Mobile Views Management (2025-12-30):**
- ✅ **ViewsManageScreen:** Mobile screen to list/search/filter views (entityType chips + q) with pagination and rename/delete actions.
- ✅ **Lifecycle coverage:** Save/Update from list screens (Sprint R) plus rename/delete from management screen (Sprint S); mobile now supports full view lifecycle.
- ✅ **Safety:** Delete guarded by confirm dialog; rename requires non-empty name; pagination via load-more button.
- ✅ **Entry point:** WorkspaceHub exposes “Manage Views” button (passes entityType filter when selected).

**Mobile gaps (post-v1):** Inventory/Parties/Products list save; workspace hub/detail routing now opens member views via `viewId` and per-view `entityType`.  
**Web gaps:** Workspaces create/edit missing; view apply/save present for SO/PO/Inventory/Parties/Products, other modules pending.  
**API complete:** ✅ (v1 aliasing behavior as above)

---

## 5. Proposed Sprint XXVI Scope

### A. Config Unification (1–2 days)

**Goals:**
- Remove localhost fallback from smoke tests
- Create `.env.sample` files for web with AWS defaults
- Document environment setup in README

**Files to change:**
- [ops/smoke/smoke.mjs](../ops/smoke/smoke.mjs#L7) — Remove `?? "http://localhost:3000"` fallback
- `apps/web/.env.sample` — Create with `VITE_API_BASE` and `VITE_TENANT` examples
- `apps/web/README.md` — Add setup instructions

**Acceptance:**
- ✅ Smoke tests fail fast if `MBAPP_API_BASE` unset (no silent localhost)
- ✅ Web has documented .env setup matching mobile defaults

---

### B. Shared Patterns (2–3 days)

**Goals:**
- Create reusable fetch/error/pagination helpers for web
- Establish routing architecture (React Router or similar)
- Add auth context provider for web (bearer token management)
- Create base layout components (header, nav, content)

**Files to create:**
- `apps/web/src/lib/http.ts` — Axios or fetch wrapper with auth headers
- `apps/web/src/providers/AuthProvider.tsx` — Bearer token context
- `apps/web/src/components/Layout.tsx` — Base layout with nav
- `apps/web/src/components/ErrorBoundary.tsx` — Global error handling

**Acceptance:**
- ✅ Web can call authenticated API endpoints with bearer token
- ✅ Base layout with navigation menu renders
- ✅ Error states display user-friendly messages

---

### C. Vertical Slice Delivery (3–4 days)

**Recommended 2–3 vertical slices based on least missing pieces:**

#### Option 1: **Parties Module (Recommended)**
- **Why:** API complete, mobile has list/detail, no actions needed (pure CRUD)
- **Web deliverables:**
  - Parties list page with search/pagination
  - Party detail page (read-only)
  - Create party form (kind: person/organization, name, roles)
  - Edit party form
- **Mobile deliverables:**
  - Create party form screen
  - Edit party form screen
- **Acceptance:** CRUD party from both clients, smoke test coverage

#### Option 2: **Products Module**
- **Why:** API complete, mobile has list/detail, no complex actions
- **Web deliverables:**
  - Products list with search
  - Product detail page
  - Create/Edit product forms (name, sku, preferredVendorId, etc.)
- **Mobile deliverables:**
  - Create product form
  - Edit product form
- **Acceptance:** CRUD product from both clients

#### Option 3: **Inventory Items (Read-Only MVP)**
- **Why:** API complete for read operations
- **Web deliverables:**
  - Inventory list with search
  - Inventory detail with onHand/movements display
- **Mobile deliverables:**
  - No changes (list/detail already exist)
- **Acceptance:** View inventory onhand/movements from both clients

---

### D. Sprint XXVI Checklist

#### Config & Foundation
- [ ] Remove localhost fallback from [ops/smoke/smoke.mjs](../ops/smoke/smoke.mjs#L7)
- [ ] Create `apps/web/.env.sample` with AWS defaults
- [ ] Create `apps/web/src/lib/http.ts` (auth-aware fetch wrapper)
- [ ] Create `apps/web/src/providers/AuthProvider.tsx`
- [ ] Create `apps/web/src/components/Layout.tsx`
- [ ] Add React Router to `apps/web/package.json`

#### Parties Vertical Slice (Web)
- [ ] Create `apps/web/src/pages/PartiesListPage.tsx`
- [ ] Create `apps/web/src/pages/PartyDetailPage.tsx`
- [ ] Create `apps/web/src/pages/CreatePartyPage.tsx`
- [ ] Create `apps/web/src/pages/EditPartyPage.tsx`
- [ ] Create `apps/web/src/components/PartyForm.tsx` (shared form component)
- [ ] Wire routes in `apps/web/src/App.tsx`

#### Parties Vertical Slice (Mobile)
- [ ] Create `apps/mobile/src/screens/CreatePartyScreen.tsx`
- [ ] Create `apps/mobile/src/screens/EditPartyScreen.tsx`
- [ ] Add routes to [apps/mobile/src/navigation/RootStack.tsx](../apps/mobile/src/navigation/RootStack.tsx)
- [ ] Update [apps/mobile/src/screens/PartyListScreen.tsx](../apps/mobile/src/screens/PartyListScreen.tsx) with "Create Party" button
- [ ] Update [apps/mobile/src/screens/PartyDetailScreen.tsx](../apps/mobile/src/screens/PartyDetailScreen.tsx) with "Edit" button

#### Testing & Documentation
- [ ] Add `smoke:parties:create-edit` test to [ops/smoke/smoke.mjs](../ops/smoke/smoke.mjs)
- [ ] Update [docs/MBapp-Status.md](../docs/MBapp-Status.md) with Sprint XXVI summary
- [ ] Update [docs/smoke-coverage.md](../docs/smoke-coverage.md) with new test
- [ ] Verify web typecheck passes: `cd apps/web && npm run typecheck`
- [ ] Verify mobile typecheck passes: `cd apps/mobile && npm run typecheck`

---

## 6. Summary & Recommendations

### Current State
- **Mobile:** Rich screen coverage (20+ screens), missing create/edit forms for core modules
- **Web:** Stub-only (single test page), no production UI
- **API:** Tier 1–4 endpoints 95% complete, well-tested via 38/38 passing smoke tests

### Critical Gaps
1. **Web client:** No routing, no auth, no screens (100% gap)
2. **Mobile forms:** Missing create/edit for Parties, Products, Inventory, PO drafts
3. **Config inconsistency:** Smoke tests fallback to localhost (should fail fast)

### Sprint XXVI Strategy
**Focus:** Establish web foundation + deliver 1 complete vertical slice on both clients

**Rationale:**
- **Parties module** has fewest dependencies (no actions, pure CRUD)
- Establishes patterns for all other modules (routing, forms, auth, error handling)
- Mobile gets create/edit patterns reusable for Products, Inventory
- Web gets foundation reusable for all future modules

**Post-Sprint XXVI:**
- Sprint XXVII: Products + Inventory vertical slices
- Sprint XXVIII: Sales Orders (already has mobile create, add web + edit)
- Sprint XXIX: Purchase Orders + Backorders integration
- Sprint XXX: Views/Workspaces (saved filters, role-aware dashboards)

---

## 7. UI System & Design Direction

### 7.1 UI Technology Stack (Locked)

**Web UI Foundation:**
- **Framework:** React 18+ with TypeScript
- **Styling:** TailwindCSS (utility-first CSS framework)
- **Component Library:** shadcn/ui (copy-paste components built on Radix UI primitives)
- **Routing:** React Router v6
- **State Management:** React hooks + Context API (no global state library by default)

**Mobile UI Foundation:**
- **Framework:** React Native (Expo managed workflow)
- **Styling:** React Native StyleSheet API + useColors hook (custom theming)
- **Navigation:** React Navigation v6 (native stack navigator)
- **State Management:** React hooks + Context API

**Rationale:**
- **TailwindCSS:** Utility-first enables rapid prototyping without CSS file proliferation; tree-shaking ensures minimal bundle size.
- **shadcn/ui:** Copy-paste model means full control over components (no hidden dependencies); built on accessible Radix primitives.
- **No Material-UI/Ant Design:** Avoid opinionated design systems that constrain customization and bloat bundle size.

**Future Design Contract (Post-MVP):**
- Establish design tokens (colors, spacing, typography) shared between web and mobile.
- Formalize component API contracts (props, states, events) for cross-platform consistency where applicable.
- Mobile may adopt React Native Paper or similar if native component patterns diverge significantly from web.

**Status:** ✅ **Locked** — All new web UI must use TailwindCSS + shadcn/ui; no alternative styling approaches without architectural review.

---

### 7.2 Multi-UX Discipline (User Personas)

MBapp serves **three primary UX disciplines** with distinct interaction patterns:

#### A) Operator UX (Primary Focus)
**Target Users:** Warehouse operators, receiving clerks, inventory managers, fulfillment staff  
**Interaction Patterns:**
- High-frequency repetitive tasks (scan → verify → confirm)
- Touch-first mobile UI (large buttons, minimal text input)
- Bulk actions (select multiple → apply action)
- Defaults and auto-fill to minimize data entry
- Immediate feedback (success toasts, error alerts)
- Offline-capable where feasible (future: local queue + sync)

**Key Screens:**
- BackordersListScreen → bulk ignore/convert
- PurchaseOrderDetailScreen → quick receive with defaults
- InventoryListScreen → filters + quick navigation
- SalesOrderDetailScreen → backorder visibility + actions

**Design Principles:**
- **Speed over completeness:** Operators need fast, predictable flows (not comprehensive dashboards).
- **Error recovery:** Clear actionable messages; allow retry without losing context.
- **Keyboard/scan support:** Enter key submits forms; barcode scans auto-populate fields.

#### B) Manager/Analyst UX (Secondary)
**Target Users:** Purchasing managers, sales managers, operations analysts  
**Interaction Patterns:**
- Filtering and searching large datasets (views, saved filters)
- Batch operations (suggest PO from multiple backorders)
- Multi-step wizards (create PO → review → submit → approve)
- Reporting and status breakdowns (backorder lifecycle, PO approval queues)
- Cross-module navigation (SO → backorders → PO → inventory)

**Key Screens:**
- BackordersListPage (web) → vendor filter + suggest-PO modal
- PurchaseOrdersListPage (web) → status filters + bulk actions
- SalesOrderDetailPage → backorder breakdown badges (clickable to filtered list)

**Design Principles:**
- **Context preservation:** Deep links maintain filter state (shareable URLs).
- **Discoverability:** Related entities linked (SO → backorders → PO).
- **Batch transparency:** Show skipped items with reasons (suggest-PO modal).

#### C) Audit/Debug UX (Tertiary)
**Target Users:** System admins, support engineers, developers  
**Interaction Patterns:**
- Inspecting raw object state (ID, timestamps, status history)
- Tracing requests via requestId (error messages → CloudWatch logs)
- Testing feature flags (dev headers override backend flags)
- Smoke test execution and manifest inspection

**Key Screens:**
- DevToolsScreen (mobile) → feature flag toggles, environment display
- Error messages → include requestId for log correlation
- Smoke test runner → manifest output with created entity IDs

**Design Principles:**
- **Transparency:** Show underlying IDs, request metadata, error details.
- **Copy-friendly:** Long-press to copy IDs, error messages, log snippets.
- **Flag visibility:** Dev mode shows current flag states and overrides.

**Status:** ✅ **Active** — Operator UX is primary focus; Manager UX receives polish as needed; Audit UX is dev-only (no prod UI).

---

## 8. Telemetry & Analytics Foundations

### 8.1 Telemetry Stack (Locked)

**Product Analytics:**
- **Tool:** PostHog (self-hosted or cloud)
- **Scope:** User behavior tracking, feature adoption, funnel analysis
- **Events:** Domain events (backorder_ignored, po_received, SalesOrderReserved, SalesOrderFulfilled) + UX events (screen_viewed, button_clicked, so_reserve_clicked, so_fulfill_clicked)
- **Session replay:** Enabled for web (opt-in for mobile)

**Error Tracking:**
- **Tool:** Sentry
- **Scope:** Client-side errors (React/React Native), backend errors (Lambda exceptions)
- **Context:** Minimum tags: `tenantId`, `actorId`, `environment`, `release`
- **Breadcrumbs:** Navigation, API calls, user actions (sanitized, no PII)

**Observability (Future):**
- **Tool:** OpenTelemetry (OTEL) → AWS CloudWatch / Honeycomb / Datadog
- **Scope:** Distributed tracing (API Gateway → Lambda → DynamoDB)
- **Metrics:** Request latency, error rates, DynamoDB throttling
- **Status:** ⬜ Planned (post-MVP)

**Rationale:**
- **PostHog:** Open-source with self-hosting option; feature flags + A/B testing built-in; no vendor lock-in.
- **Sentry:** Industry standard for error tracking; excellent React/React Native integrations; affordable pricing.
- **OTEL:** Future-proof observability; AWS-native with CloudWatch integration; enables cross-service tracing.

**Status:** 🟨 **Partial** — Sentry integrated (backend + mobile); PostHog planned; OTEL not yet implemented.

**Implementation:**
- **Web helper:** `apps/web/src/lib/telemetry.ts` exports `track(eventName, properties)` (PostHog-backed)
- **Env vars:** `VITE_POSTHOG_API_KEY`, `VITE_POSTHOG_HOST` (optional, defaults to app.posthog.com)
- **Safe no-op:** If env vars missing, `track()` does nothing (no crashes)
- **Envelope fields:** Automatically includes `ts`, `source="web"`, `route` (location.pathname), `tenantId`/`actorId` when available from AuthProvider context

**Mobile scaffolding:**
- **Helper:** `apps/mobile/src/lib/telemetry.ts` exports `track(eventName, properties)` with envelope (`ts`, `source="mobile"`, `screen`, `tenantId`, optional `actorId`)
- **Env vars:** `EXPO_PUBLIC_POSTHOG_API_KEY`, `EXPO_PUBLIC_POSTHOG_HOST` (defaults to app.posthog.com)
- **Sentry:** Init if `EXPO_PUBLIC_SENTRY_DSN` present; tags `source="mobile"` and `tenantId` from DevAuthBootstrap (no unsafe actorId decoding)
- **Mobile PO edit instrumentation:** `screen_viewed` (screen `PurchaseOrderEdit`, includes `poId` + status) and `po_edit_submit` (`result=attempt|success|error`, `opCount`, `upsertCount`, `removeCount`, `httpStatus?`, `errorCode?`) fire from [apps/mobile/src/screens/EditPurchaseOrderScreen.tsx](../apps/mobile/src/screens/EditPurchaseOrderScreen.tsx); Sentry tags include `screen`, `route`, `objectType`, `objectId`, `poStatus` when present.
- **Safe no-op:** Missing keys → telemetry helpers are no-ops (no crashes)

**Instrumented Workflow (Example): Backorder Ignore (Web + Mobile)**
- **UX events:**
  - `BackorderDetail_Viewed` with `{ objectType: "backorderRequest", objectId }`
  - `BO_Ignore_Clicked` with `{ objectType: "backorderRequest", objectId, result: "success|fail", errorCode? }`
- **Domain event (API):**
  - `BackorderIgnored` emitted from backend with `{ objectType, objectId, soId, itemId, statusBefore, statusAfter, durationMs }`
- **PII rule:** IDs only in properties; no names/emails.

**Sprint P Telemetry Additions: SO Reserve/Fulfill**
- **Domain events (API):**
  - `SalesOrderReserved`: Emitted after inventory movements persist (success) or on error (INVALID_STATUS | INSUFFICIENT_AVAILABILITY). Payload: `{ objectType, objectId, lineCount, totalQtyReserved, statusBefore, statusAfter, result, errorCode? }`
  - `SalesOrderFulfilled`: Emitted after movements + line updates + status computed (success) or on error (INVALID_STATUS | OVER_FULFILLMENT). Payload: `{ objectType, objectId, lineCount, totalQtyFulfilled, statusBefore, statusAfter, result, errorCode? }`
- **UX events (Web + Mobile):**
  - `so_reserve_clicked`: Tracks reserve button clicks (attempt/success/fail). Payload: `{ objectType, objectId, lineCount, result, errorCode? }`
  - `so_fulfill_clicked`: Tracks fulfill button clicks (attempt/success/fail) and scan-to-fulfill path (scanMode=true). Payload: `{ objectType, objectId, lineCount, result, errorCode?, scanMode? }`
- **Pattern:** IDs + aggregated counts only; no lines array. Sentry integration adds tags (objectType, objectId, action) on failures.

---

### 8.2 Telemetry Contract (Event Envelope)

**Standard Event Shape:**
```typescript
type TelemetryEvent = {
  // Core identifiers (required)
  eventName: string;          // e.g., "backorder_ignored", "po_received"
  timestamp: string;          // ISO 8601 timestamp
  sessionId: string;          // Client-generated session UUID
  
  // Actor context (required)
  tenantId: string;           // Always present (multi-tenant isolation)
  actorId?: string;           // User ID (omit for anonymous/unauthenticated)
  
  // Object context (required for domain events)
  objectType?: string;        // e.g., "backorderRequest", "purchaseOrder"
  objectId?: string;          // e.g., "bo_abc123", "po_xyz789"
  
  // UX context (required for UX events)
  screen?: string;            // Mobile: "BackorderDetail", Web: route path
  component?: string;         // e.g., "IgnoreButton", "SuggestPoModal"
  
  // Additional metadata (optional)
  properties?: Record<string, any>;  // Event-specific data (sanitized)
  
  // Environment (required)
  platform: "web" | "mobile";  // Client platform
  appVersion?: string;         // Semantic version (e.g., "1.2.3")
  environment: "dev" | "staging" | "prod";  // Deployment environment
};
```

**Envelope Rules:**
1. **Never send PII:** No customer names, addresses, emails, phone numbers in `properties`. **Auto-enforced:** All telemetry helpers (`track()`, `emitDomainEvent()`) include built-in `sanitizeTelemetryProps()` that drops PII keys (name, email, phone, address, firstName, lastName, displayName) and nested objects/arrays.
2. **Always send tenant:** All events must include `tenantId` for isolation and filtering.
3. **Object references only:** Send object IDs, not full object payloads (query backend for details).
4. **Timestamps in UTC:** Always ISO 8601 format (`new Date().toISOString()`).
5. **Session continuity:** `sessionId` persists across screens/routes within a single app launch.

**Domain Events Helper (API):**
- **Location:** `apps/api/src/common/logger.ts` exports `emitDomainEvent(ctx, eventName, payload)`
- **Envelope (auto):** `eventName`, `ts`, `source="api"`, `tenantId`, `actorId` (or `actorType="system"`)
- **Payload (IDs only):** Use `objectType`, `objectId`, optional `soId`, `itemId`, `statusBefore`, `statusAfter`, `result`, `durationMs`, `errorCode`
- **Sanitization (auto):** Built-in PII filter drops name/email/phone/address keys and nested objects
- **Example:** `emitDomainEvent(ctx, "BackorderIgnored", { objectType: "backorderRequest", objectId: id, soId, itemId, statusBefore, statusAfter })`

---

### 8.3 Event Families & Examples

#### A) Domain Events (Business Logic)
**Purpose:** Track domain state transitions and user-driven workflows.

**Examples:**
```typescript
// Backorder ignored by operator
{
  eventName: "backorder_ignored",
  timestamp: "2025-12-29T10:30:00.000Z",
  sessionId: "sess_abc123",
  tenantId: "DemoTenant",
  actorId: "user_xyz",
  objectType: "backorderRequest",
  objectId: "bo_12345",
  properties: {
    previousStatus: "open",
    source: "detail_screen"  // vs "bulk_action"
  },
  platform: "mobile",
  environment: "prod"
}

// Sales Order committed (Sprint L)
{
  eventName: "SalesOrderCommitted",
  timestamp: "2025-12-29T14:20:00.000Z",
  sessionId: "sess_def456",
  tenantId: "DemoTenant",
  actorId: "user_xyz",
  objectType: "salesOrder",
  objectId: "so_78901",
  properties: {
    statusBefore: "approved",
    statusAfter: "committed",
    strict: false,
    shortagesCount: 2,
    movementsEmitted: 5,
    result: "success"
  },
  platform: "api",
  environment: "prod"
}

// Sales Order reserved (Sprint P)
{
  eventName: "SalesOrderReserved",
  timestamp: "2025-12-29T14:22:00.000Z",
  sessionId: "sess_def456",
  tenantId: "DemoTenant",
  actorId: "user_xyz",
  objectType: "salesOrder",
  objectId: "so_78901",
  properties: {
    lineCount: 2,
    totalQtyReserved: 50,
    statusBefore: "submitted",
    statusAfter: "submitted",
    result: "success"
  },
  platform: "api",
  environment: "prod"
}

// Sales Order fulfilled (Sprint P)
{
  eventName: "SalesOrderFulfilled",
  timestamp: "2025-12-29T14:30:00.000Z",
  sessionId: "sess_def456",
  tenantId: "DemoTenant",
  actorId: "user_xyz",
  objectType: "salesOrder",
  objectId: "so_78901",
  properties: {
    lineCount: 2,
    totalQtyFulfilled: 50,
    statusBefore: "committed",
    statusAfter: "fulfilled",
    result: "success"
  },
  platform: "api",
  environment: "prod"
}

// Purchase Order received (Sprint L)
{
  eventName: "PurchaseOrderReceived",
  timestamp: "2025-12-29T14:25:00.000Z",
  sessionId: "sess_ghi789",
  tenantId: "DemoTenant",
  actorId: "user_xyz",
  objectType: "purchaseOrder",
  objectId: "po_67890",
  properties: {
    lineCount: 3,
    totalQtyReceived: 150,
    statusBefore: "approved",
    statusAfter: "partially-received",
    result: "success"
  },
  platform: "api",
  environment: "prod"
}

// Purchase Order approved (Sprint L)
{
  eventName: "PurchaseOrderApproved",
  timestamp: "2025-12-29T14:15:00.000Z",
  sessionId: "sess_jkl012",
  tenantId: "DemoTenant",
  actorId: "user_xyz",
  objectType: "purchaseOrder",
  objectId: "po_67890",
  properties: {
    statusBefore: "submitted",
    statusAfter: "approved",
    result: "success"
  },
  platform: "api",
  environment: "prod"
}

// PO received (legacy example — partial or full)
{
  eventName: "po_received",
  timestamp: "2025-12-29T10:35:00.000Z",
  sessionId: "sess_abc123",
  tenantId: "DemoTenant",
  actorId: "user_xyz",
  objectType: "purchaseOrder",
  objectId: "po_67890",
  properties: {
    lineCount: 3,
    totalQtyReceived: 150,
    isPartialReceive: true,
    newStatus: "partially_received"
  },
  platform: "web",
  environment: "prod"
}

// Suggest-PO executed (multi-vendor)
{
  eventName: "suggest_po_executed",
  timestamp: "2025-12-29T10:40:00.000Z",
  sessionId: "sess_def456",
  tenantId: "DemoTenant",
  actorId: "user_xyz",
  properties: {
    backorderCount: 5,
    vendorCount: 2,
    draftCount: 2,
    skippedCount: 1,
    source: "backorders_list"  // vs "so_detail"
  },
  platform: "web",
  environment: "prod"
}
```

#### B) UX Events (Interaction Tracking)
**Purpose:** Track user navigation, feature discovery, and interaction patterns.

**Examples:**
```typescript
// Screen viewed (mobile)
{
  eventName: "screen_viewed",
  timestamp: "2025-12-29T10:25:00.000Z",
  sessionId: "sess_abc123",
  tenantId: "DemoTenant",
  actorId: "user_xyz",
  screen: "BackorderDetail",
  properties: {
    objectId: "bo_12345",
    referrer: "BackordersList"  // Previous screen
  },
  platform: "mobile",
  environment: "prod"
}

// Sales Order commit clicked (Sprint L — web)
{
  eventName: "SO_Commit_Clicked",
  timestamp: "2025-12-29T14:20:00.000Z",
  sessionId: "sess_def456",
  tenantId: "DemoTenant",
  actorId: "user_xyz",
  screen: "/sales-orders/so_78901",
  properties: {
    objectType: "salesOrder",
    objectId: "so_78901",
    strict: false,
    result: "success",  // or "attempt", "fail"
    shortagesCount: 0
  },
  platform: "web",
  environment: "prod"
}

// Sales Order reserve clicked (Sprint P — web)
{
  eventName: "so_reserve_clicked",
  timestamp: "2025-12-29T14:22:00.000Z",
  sessionId: "sess_def456",
  tenantId: "DemoTenant",
  actorId: "user_xyz",
  screen: "/sales-orders/so_78901",
  properties: {
    objectType: "salesOrder",
    objectId: "so_78901",
    lineCount: 2,
    result: "success",  // or "attempt", "fail"
    errorCode?: "INSUFFICIENT_AVAILABILITY"  // on fail
  },
  platform: "web",
  environment: "prod"
}

// Sales Order fulfill clicked (Sprint P — web)
{
  eventName: "so_fulfill_clicked",
  timestamp: "2025-12-29T14:23:00.000Z",
  sessionId: "sess_def456",
  tenantId: "DemoTenant",
  actorId: "user_xyz",
  screen: "/sales-orders/so_78901",
  properties: {
    objectType: "salesOrder",
    objectId: "so_78901",
    lineCount: 2,
    result: "success",  // or "attempt", "fail"
    errorCode?: "OVER_FULFILLMENT"  // on fail
  },
  platform: "web",
  environment: "prod"
}

// Purchase Order receive clicked (Sprint L — web)
{
  eventName: "PO_Receive_Clicked",
  timestamp: "2025-12-29T14:25:00.000Z",
  sessionId: "sess_ghi789",
  tenantId: "DemoTenant",
  actorId: "user_xyz",
  screen: "/purchase-orders/po_67890",
  properties: {
    objectType: "purchaseOrder",
    objectId: "po_67890",
    result: "success",  // or "attempt", "fail"
    lineCount: 3
  },
  platform: "web",
  environment: "prod"
}

// Purchase Order approve clicked (Sprint L — mobile)
{
  eventName: "PO_Approve_Clicked",
  timestamp: "2025-12-29T14:15:00.000Z",
  sessionId: "sess_jkl012",
  tenantId: "DemoTenant",
  actorId: "user_xyz",
  screen: "PurchaseOrderDetail",
  properties: {
    objectType: "purchaseOrder",
    objectId: "po_67890",
    result: "success"  // or "attempt", "fail"
  },
  platform: "mobile",
  environment: "prod"
}

// Purchase Order scan-receive submitted (Sprint L — mobile)
{
  eventName: "PO_ScanReceive_Submitted",
  timestamp: "2025-12-29T14:28:00.000Z",
  sessionId: "sess_mno345",
  tenantId: "DemoTenant",
  actorId: "user_xyz",
  screen: "PurchaseOrderDetail",
  properties: {
    objectType: "purchaseOrder",
    objectId: "po_67890",
    result: "success",  // or "attempt", "fail"
    lineCount: 5
  },
  platform: "mobile",
  environment: "prod"
}

// Button clicked (legacy example)
{
  eventName: "button_clicked",
  timestamp: "2025-12-29T10:30:00.000Z",
  sessionId: "sess_def456",
  tenantId: "DemoTenant",
  actorId: "user_xyz",
  screen: "/backorders/bo_12345",
  component: "IgnoreButton",
  properties: {
    objectId: "bo_12345"
  },
  platform: "web",
  environment: "prod"
}

// Filter applied
{
  eventName: "filter_applied",
  timestamp: "2025-12-29T10:28:00.000Z",
  sessionId: "sess_def456",
  tenantId: "DemoTenant",
  actorId: "user_xyz",
  screen: "/backorders",
  component: "VendorFilter",
  properties: {
    filterType: "vendorId",
    vendorId: "vendor_abc"  // Reference only, not vendor name
  },
  platform: "web",
  environment: "prod"
}
```

#### C) Error Events (Failure Tracking)
**Purpose:** Track client-side errors, API failures, and validation errors.

**Examples:**
```typescript
// API error (network failure)
{
  eventName: "api_error",
  timestamp: "2025-12-29T10:32:00.000Z",
  sessionId: "sess_abc123",
  tenantId: "DemoTenant",
  actorId: "user_xyz",
  screen: "BackorderDetail",
  properties: {
    endpoint: "/objects/backorderRequest/bo_12345:ignore",
    method: "POST",
    statusCode: 500,
    errorCode: "INTERNAL_SERVER_ERROR",
    requestId: "req_xyz123"  // For log correlation
  },
  platform: "mobile",
  environment: "prod"
}

// Validation error (user input)
{
  eventName: "validation_error",
  timestamp: "2025-12-29T10:33:00.000Z",
  sessionId: "sess_def456",
  tenantId: "DemoTenant",
  actorId: "user_xyz",
  screen: "/purchase-orders/po_67890",
  component: "ReceiveModal",
  properties: {
    fieldName: "deltaQty",
    errorCode: "RECEIVE_EXCEEDS_REMAINING",
    attemptedValue: 100,  // Sanitized numeric value
    maxAllowed: 50
  },
  platform: "web",
  environment: "prod"
}
```

---

### 8.4 Foundation-by-Accretion Rule (Telemetry)

**Principle:** Every sprint that adds domain behavior or UX surface area must also add telemetry instrumentation.

**Minimum Coverage per Sprint:**
1. **1–3 domain events** for new state transitions or workflows (e.g., backorder ignored, PO received).
2. **1–3 UX events** for new screens or primary user actions (e.g., screen viewed, button clicked).
3. **Error events** for any new API endpoints or validation rules (captured automatically by Sentry + error boundaries).

**Examples:**
- **Sprint J (Backorder Detail):** Added `backorder_ignored` (domain), `screen_viewed` (UX), `button_clicked` (UX).
- **Sprint I (PO Receive):** Added `po_received` (domain), `receive_modal_opened` (UX), `api_error` (automatic via Sentry).

**Guardrails:**
- **No event sprawl:** Limit to 3–5 events per feature; avoid logging every button click.
- **Event naming:** Use `snake_case` for event names (e.g., `backorder_ignored`, not `BackorderIgnored`).
- **Property discipline:** Only include properties that inform product decisions (not debugging data).

**Status:** 🟨 **Partial** — Domain events implemented for core workflows; UX events partially instrumented; full coverage planned for post-MVP.

---

### 8.5 Sentry Context Requirements (Minimum)

**All Sentry errors must include these tags/context:**

**Required Tags:**
```typescript
{
  tenantId: string;      // Always present (multi-tenant isolation)
  actorId?: string;      // User ID (if authenticated)
  environment: string;   // "dev" | "staging" | "prod"
  platform: string;      // "web" | "mobile" | "api"
}
```

**Required Context (where applicable):**
```typescript
{
  // Object context (for domain errors)
  objectType?: string;   // e.g., "backorderRequest", "purchaseOrder"
  objectId?: string;     // e.g., "bo_abc123", "po_xyz789"
  
  // Route/screen context
  route?: string;        // Web: "/backorders/bo_abc123", Mobile: "BackorderDetail"
  screen?: string;       // Mobile screen name
  
  // Request context (for API errors)
  requestId?: string;    // API Gateway request ID (from error response)
  endpoint?: string;     // e.g., "/objects/backorderRequest/bo_123:ignore"
  method?: string;       // HTTP method
}
```

**Implementation:**
- **Web:** Set Sentry context in AuthProvider (tenantId, actorId) + ErrorBoundary (route).
- **Mobile:** Set Sentry context in DevAuthBootstrap (tenantId, actorId) + navigation listener (screen).
- **API:** Lambda handler sets context from event (tenantId, actorId, requestId, route).

**Example (React Error Boundary):**
```typescript
import * as Sentry from "@sentry/react";

function ErrorBoundary({ children }: { children: React.ReactNode }) {
  const { tenantId, actorId } = useAuth();
  const location = useLocation();
  
  React.useEffect(() => {
    Sentry.setTag("tenantId", tenantId);
    Sentry.setTag("actorId", actorId || "anonymous");
    Sentry.setContext("route", { path: location.pathname });
  }, [tenantId, actorId, location]);
  
  return <Sentry.ErrorBoundary fallback={<ErrorFallback />}>{children}</Sentry.ErrorBoundary>;
}
```

**Status:** 🟨 **Partial** — Sentry integrated; minimum context implemented for backend; web/mobile context pending.

---

## Addendum — Purchasing & Receiving Foundations (Sprints XXXV–XXXIX, 2025-12-25)

- **Web purchasing vertical slice shipped:** Backorders workbench (list/filter/select/bulk ignore), suggest-PO, multi-vendor draft chooser, create-from-suggestion, and navigation into PO detail; Purchase Orders list/detail with submit/approve/receive/cancel/close gating; PO Activity feed sourced from inventory movements (per-line fetch + aggregation).
- **Status + guard correctness:** Partial receive transitions to `partially-received` (API hyphenated); Close requires `fulfilled` (API 409 otherwise); Cancel only for `draft|submitted`; Receive blocked after `closed|cancelled` with 409 `PO_STATUS_NOT_RECEIVABLE`; Vendor guard supported (FEATURE_ENFORCE_VENDOR_ROLE, non-prod override header X-Feature-Enforce-Vendor: 1) and validated via smoke.
- **Receiving fidelity:** Per-line receive payload supports `{ lineId, deltaQty, lot?, locationId? }`; lots/locations persist into inventory movements and can be queried with `GET /inventory/{itemId}/movements?refId={poId}&poLineId={lineId}`.
- **Smokes (opt-in proofs):** `smoke:close-the-loop`, `smoke:close-the-loop-multi-vendor`, `smoke:close-the-loop-partial-receive`, `smoke:vendor-guard-enforced`, `smoke:po-receive-after-close-guard`, `smoke:po-receive-after-cancel-guard`, `smoke:po-receive-lot-location-assertions`.
- **Web scan-to-receive (Sprint S, 2025-12-31):** Manual paste workflow integrated into PO detail uses `@mbapp/scan` resolver + `/epc/resolve` endpoint to classify and resolve EPCs to itemIds. Matching lines with remaining qty are candidates; single match stages immediately, multi-match shows modal chooser. Staged receives batch-submit with lot/locationId defaults from page state. Workflow: paste → resolve → stage → submit batch. Uses existing `receivePurchaseOrder` API and error patterns.

**End of Report**

</details>
