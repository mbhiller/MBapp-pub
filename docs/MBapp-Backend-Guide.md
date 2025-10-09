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
