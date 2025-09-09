# Refinements Backlog (nonprod)

Keep polish work here; pull items into a sprint as needed.

## Ready / Small
- Mobile: `toastFromError(e)` helper to show `{error, message}` + `x-request-id`
- API: tighten CORS allow-list (env-controlled origin)
- API: consistent error codes map (400/404/409) + docs cross-link
- CI: cache node_modules and esbuild for faster runs

## Ready / Medium
- API: DELETE `/objects/{type}/{id}` + soft-delete flag
- API: add `GET /objects/{type}/count` (Query with Select=COUNT)
- API: search by date range (`createdAt`/`updatedAt`) via GSI or filter
- IaC: codify API routes + Lambda + DDB indexes (CDK/SAM/Terraform)

## Later
- Observability: log JSON “event” for updates `{before, after, actor}`
- Auth: swap `x-tenant-id` for Cognito/JWT claims
- Mobile: offline cache for list/detail
