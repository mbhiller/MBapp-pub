# MBapp Backend – Objects API (Starter)

This package provides a minimal **Objects API** for MBapp (Phase 4), implemented as a single Lambda with a tiny router.

## Endpoints (API Gateway HTTP API, payload v2)
- `POST /objects` – Create an object (`type`, `name`, optional `integrations`, `metadata`, `tags`)
- `GET /objects?type=horse` – List objects by type (per tenant)
- `GET /objects/{id}` – Get a specific object by ID
- `GET /objects/search?tag=rfid:3008_...` – Search by tag (rfid, qr, nfc)

## Required environment variables
- `OBJECTS_TABLE` – DynamoDB table name (e.g., `mbapp_objects`)

## Tenant resolution
- Reads tenant from one of:
  - `event.requestContext.authorizer.jwt.claims["custom:tenantId"]` (Cognito JWT custom claim), or
  - `X-Tenant-Id` header (for nonprod/dev), or
  - defaults to `"demo"` (helpful for bootstrapping)

## Build
```bash
cd backend
npm ci
npm run build
```

You can deploy using your preferred method (Terraform, SAM, CDK). The build artifacts will be in `backend/dist`.