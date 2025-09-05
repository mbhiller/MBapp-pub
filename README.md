# MBapp (public)

Monorepo for MBapp.

## Structure
- `apps/web` — Vite + React web app
- `apps/api` — API app (placeholder)
- `infra/terraform` — Infra as code (HTTP API + Lambda + DynamoDB + CloudFront)
- `scripts/` — smoke tests and helper scripts

## Dev quick start
```bash
npm install
npm run web:dev
