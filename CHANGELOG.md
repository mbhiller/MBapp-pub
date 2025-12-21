# MBapp Changelog

## v0.4.0 — 2025-12-20

### Added
- **Registrations v1 (Tier 1 foundation)**: CRUD + filters (eventId, partyId, status); feature-flagged via `FEATURE_REGISTRATIONS_ENABLED` (default OFF)
- **API Endpoints**:
  - `POST /registrations` — Create registration (201)
  - `GET /registrations` — List with filters (200)
  - `GET /registrations/{id}` — Get single (200)
  - `PUT /registrations/{id}` — Update (200)
  - `DELETE /registrations/{id}` — Delete (204 No Content)
- **Schema**: Registration { eventId, partyId, division?, class?, status, fees[], notes? }
- **Smoke tests**: `smoke:registrations:crud`, `smoke:registrations:filters` (both PASS)

### Changed
- **API**: DELETE operations now return 204 No Content (RFC 7231 compliant; no response body)
- **Response helpers**: Added `noContent()` to `apps/api/src/common/responses.ts`

### Technical
- **Storage**: Objects-repo pattern; tenant/RBAC enforcement (registration:read, registration:write)
- **Filters**: In-memory post-query filtering (no schema migrations)
- **No breaking changes**: Feature-flagged; disabled by default

---

## v0.3.0 — 2025-12-19

### Added
- **Views v1**: CRUD endpoints for saved user views (filters, sort, columns)
- **Workspaces v1**: List workspaces (minimal v1; returns saved Views)
- **Event dispatcher**: Noop/simulate path (no external publish yet)
- **Feature flags**: `FEATURE_VIEWS_ENABLED`, `FEATURE_EVENT_DISPATCH_ENABLED`, `FEATURE_EVENT_DISPATCH_SIMULATE`
- **Smoke tests**: `smoke:views:crud`, `smoke:workspaces:list`, `smoke:events:enabled-noop`

### Changed
- **Spec**: Added View and Workspace schemas to `spec/MBapp-Modules.yaml`

---

## Earlier Releases

See [docs/MBapp-Working.md](docs/MBapp-Working.md) for Sprint A–III summaries.
