# Sprint XXVI Summary – Tier 1 Foundations: Web Client + AWS-Only Smokes

**Sprint Goal:** Stand up web client foundations (auth/router/http) + deliver first vertical slice (Parties CRUD) + enforce AWS-only smokes for deterministic testing.

---

## PR Summary

### Scope
- **Web app foundations**: HTTP client with bearer+tenant headers, auth context, layout with navigation, token setter UI.
- **Parties vertical slice**: Full CRUD on web (list/detail/create/edit) + forms with validation.
- **AWS-only smokes**: Remove localhost fallback, require `MBAPP_BEARER` at startup, fail fast if env missing.
- **New smoke**: `smoke:parties:crud` validates create → read → update → search with idempotency keys.
- **CI integration**: New smoke wired into ops/ci-smokes.json.

### Key Changes

#### Web Client (apps/web)
1. **Environment Config** ([.env.sample](.env.sample))
   - `VITE_API_BASE=https://ki8kgivz1f.execute-api.us-east-1.amazonaws.com`
   - `VITE_TENANT=DemoTenant`
   - `VITE_BEARER=` (optional dev-only)

2. **HTTP Client** ([src/lib/http.ts](apps/web/src/lib/http.ts))
   - `apiFetch<T>(path, opts)` wrapper
   - Injects `Authorization: Bearer {token}` and `x-tenant-id: {tenant}`
   - Normalizes errors (status + code + message)
   - No retry logic; fail fast on network errors

3. **Auth Provider** ([src/providers/AuthProvider.tsx](apps/web/src/providers/AuthProvider.tsx))
   - Context: `{ token, tenantId, apiBase, setToken }`
   - Token sourced from: localStorage → VITE_BEARER → null
   - `setToken()` persists to localStorage
   - Required env vars validated at startup

4. **Layout & Nav** ([src/components/Layout.tsx](apps/web/src/components/Layout.tsx))
   - Header with app name, tenant, token status
   - Token input + "Set Token" button (dev-friendly)
   - "Clear Token" button
   - Nav links: Home, Parties
   - Minimal CSS (no UI framework)

5. **Parties CRUD Pages**
   - [PartiesListPage.tsx](apps/web/src/pages/PartiesListPage.tsx): search, pagination, links to detail/create
   - [PartyDetailPage.tsx](apps/web/src/pages/PartyDetailPage.tsx): read-only view + edit CTA
   - [CreatePartyPage.tsx](apps/web/src/pages/CreatePartyPage.tsx): form → create → redirect to detail
   - [EditPartyPage.tsx](apps/web/src/pages/EditPartyPage.tsx): load → form → update → redirect to detail
   - [PartyForm.tsx](apps/web/src/components/PartyForm.tsx): shared form (name, kind, roles)

6. **Routing** ([src/App.tsx](apps/web/src/App.tsx), [src/main.tsx](apps/web/src/main.tsx))
   - React Router v6
   - Routes: `/`, `/parties`, `/parties/new`, `/parties/{id}`, `/parties/{id}/edit`
   - ErrorBoundary wrapper
   - AuthProvider + BrowserRouter wrapper

#### Smokes (ops/smoke)
1. **AWS-Only Enforcement** ([ops/smoke/smoke.mjs](ops/smoke/smoke.mjs#L7-L21))
   - `MBAPP_API_BASE` required; exits(2) if missing or not HTTPS
   - `MBAPP_BEARER` required; exits(2) if missing or empty
   - Removed localhost fallback
   - Removed dev-login fallback

2. **New Smoke: parties:crud** ([ops/smoke/smoke.mjs](ops/smoke/smoke.mjs#L193-L240))
   - Create party with `kind="org"`, `name=SmokeParty-{ts}`, `roles=["customer"]`
   - GET /objects/party/{id} → assert name matches
   - PUT /objects/party/{id} → update name to `{name}-Updated`
   - GET again → assert updated name
   - POST /objects/party/search → search for updated name (5 retries × 200ms for eventual consistency)
   - All mutations use `Idempotency-Key` header
   - Return PASS/FAIL with full artifact capture

#### CI Config
1. **ops/ci-smokes.json** ([ops/ci-smokes.json](ops/ci-smokes.json))
   - Added `"smoke:parties:crud"` before `"smoke:close-the-loop"`
   - Result: 39 tests in CI (38 baseline + 1 new)

#### Docs Updates
1. **docs/MBapp-Working.md**: Sprint XXVI entry with deliverables, files changed, acceptance criteria
2. **docs/smoke-coverage.md**: smoke:parties:crud entry with steps, assertions, endpoints
3. **docs/MBapp-Backend-Guide.md**: Smoke env requirements section with example commands

---

## How to Run Locally

### Web App vs AWS

Set environment:
```bash
cd apps/web

# Copy sample to .env and fill in AWS base
cp .env.sample .env
# Edit .env:
#   VITE_API_BASE=https://ki8kgivz1f.execute-api.us-east-1.amazonaws.com
#   VITE_TENANT=DemoTenant
#   VITE_BEARER=<optional dev-only token>

# Install + typecheck
npm install
npm run typecheck

# Start dev server
npm run dev
```

Then in browser:
1. Navigate to `http://localhost:5173`
2. Paste bearer token in header input if not already set via env
3. Click "Set Token"
4. Navigate to Parties via header link or "Go to Parties" CTA
5. List, search, create, edit parties end-to-end

### Smoke Tests vs AWS

Set environment:
```bash
cd c:\Users\bryan\MBapp-pub

# PowerShell example
$env:MBAPP_API_BASE="https://ki8kgivz1f.execute-api.us-east-1.amazonaws.com"
$env:MBAPP_TENANT_ID="DemoTenant"
$env:MBAPP_BEARER="<your-bearer-token>"

# Run individual smoke
node ops/smoke/smoke.mjs smoke:parties:crud

# Run all CI flows
node ops/smoke/smoke.mjs smoke:parties:crud
node ops/smoke/smoke.mjs smoke:close-the-loop
```

Expected output for smoke:parties:crud:
```json
{
  "test": "parties-crud",
  "result": "PASS",
  "create": { "ok": true, "status": 200, "body": { "id": "...", "name": "SmokeParty-..." } },
  "get1": { "ok": true, "status": 200, "body": { "name": "SmokeParty-..." } },
  "update": { "ok": true, "status": 200 },
  "get2": { "ok": true, "status": 200, "body": { "name": "SmokeParty-...-Updated" } },
  "searchOrList": { "ok": true, "status": 200, "body": { "items": [...] } },
  "found": true
}
```

---

## Acceptance Criteria

✅ **Web Client**
- [ ] npm run typecheck passes (apps/web)
- [ ] Web app loads at http://localhost:5173
- [ ] Header shows tenant, token status, token input, Set/Clear buttons
- [ ] Home page has "Go to Parties" link
- [ ] Parties list loads with search/pagination
- [ ] Parties detail shows all fields + Edit link
- [ ] Create party form has name/kind/roles + validation
- [ ] Edit party form loads current values + saves changes
- [ ] All requests include `Authorization: Bearer {token}` and `X-Tenant-Id: {tenant}`

✅ **AWS-Only Smokes**
- [ ] `node ops/smoke/smoke.mjs smoke:parties:crud` returns PASS
- [ ] If `MBAPP_API_BASE` missing, exits(2) with clear error message
- [ ] If `MBAPP_BEARER` missing, exits(2) with clear error message
- [ ] No localhost fallback anywhere in codebase
- [ ] No dev-login fallback in header builders

✅ **CI**
- [ ] ops/ci-smokes.json has smoke:parties:crud + close-the-loop
- [ ] Both smokes pass in CI environment

---

## Notable Design Decisions

1. **No UI Framework**: Web client uses plain HTML/CSS to keep minimal and portable. Easy to migrate to Material-UI / Tailwind later.
2. **Bearer Token UI**: Dev-friendly token setter in header avoids need to edit .env during local testing; stored in localStorage so persists across page reloads.
3. **Eventual Consistency Retry**: Search test includes tiny 5×200ms retry loop to handle DDB eventual consistency without flakiness.
4. **Idempotency Keys**: All create/update smokes include `Idempotency-Key` header to prove safe replay.
5. **AWS-First**: No localhost, no dev-login. Forces deterministic testing against real AWS; if you want local testing, stand up a real API.

---

## Files Changed (Git Summary)

```
apps/web/.env.sample                           [new]
apps/web/src/lib/http.ts                       [new]
apps/web/src/providers/AuthProvider.tsx        [new]
apps/web/src/components/Layout.tsx             [new]
apps/web/src/components/ErrorBoundary.tsx      [new]
apps/web/src/components/PartyForm.tsx          [new]
apps/web/src/pages/PartiesListPage.tsx         [new]
apps/web/src/pages/PartyDetailPage.tsx         [new]
apps/web/src/pages/CreatePartyPage.tsx         [new]
apps/web/src/pages/EditPartyPage.tsx           [new]
apps/web/src/App.tsx                           [modified]
apps/web/src/main.tsx                          [modified]
apps/web/package.json                          [modified: added react-router-dom]
ops/smoke/smoke.mjs                            [modified: AWS-only + parties:crud]
ops/ci-smokes.json                             [modified: added parties:crud]
docs/MBapp-Working.md                          [modified: Sprint XXVI entry]
docs/smoke-coverage.md                         [modified: parties:crud + Parties row]
docs/MBapp-Backend-Guide.md                    [modified: smoke env requirements]
```

---

## Next Steps (Sprint XXVII)

1. **Products + Inventory**: Add CRUD forms to web; Products List/Detail/Create/Edit; Inventory List/Detail (read-only).
2. **Mobile Parties**: Create/Edit party screens on mobile; route wiring.
3. **Sales Order Surfaces**: Read-only SO detail links visible from inventory/backorder lists.
4. **Docs**: Update roadmap sprint sequence post-XXVI delivery.

---

**Date:** 2025-12-23  
**Status:** Ready for merge to `feat/tier1-sprint-XXVI`
