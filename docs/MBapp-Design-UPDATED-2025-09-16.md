# MBapp — Design & Variables (Vision Doc) — Updated 2025‑09‑16

> **Purpose.** This document captures our *vision*, guiding principles, and the **authoritative variables** we rely on across API, Mobile (Expo), and Web (Vite). It complements **MBapp‑Master.md** (implementation + APIs) and stays stable across sprints.

---

## 1) Vision (concise)
A fast, minimal, modular platform for equine operations. One *objects* core, thin feature aliases (e.g., `/products`), and consistent UI/UX across mobile & web. We optimize for: **small surface area**, **clear contracts**, **typed code**, and **drop‑in changes**.

**Guiding principles**
- Prefer *one* canonical datastore & model; add thin aliases at the edges.
- Keep endpoints small, composable, and cursor‑paged (`limit` + `next`).
- All clients send `x-tenant-id`. Tenancy is explicit.
- Typed API clients & hooks; no ad‑hoc `fetch` littered in screens.
- Env‑first configuration (`EXPO_PUBLIC_*`, `VITE_*`) with safe nonprod defaults.
- Every change should be a drop‑in file or a documented script step.

---

## 2) Environments & tenancy
- **Tenancy header**: `x-tenant-id: <TenantKey>` (required). Default tenant may exist in nonprod; clients still send the header.
- **Nonprod defaults**: keep a working tenant and API base for local testing.
- **Stages**: NonProd (primary dev), Prod (later).

---

## 3) Variables registry (authoritative keys)
> **Note:** “Example” uses current nonprod values we’ve been working with. Adjust per account/stage.

### 3.1 Mobile (Expo)
| Name | Where | Purpose | Example (NonProd) | Required | Notes |
|---|---|---|---|---|---|
| `EXPO_PUBLIC_API_BASE` | `app.config.ts` / Expo env | API Gateway base URL | `https://ki8kgivz1f.execute-api.us-east-1.amazonaws.com` | ✔ | Previously also used `u0cuyphbv6` in smoke tests; pick one per stage. |
| `EXPO_PUBLIC_TENANT_ID` | `app.config.ts` / Expo env | Default tenant for requests | `DemoTenant` | ✔ | Mobile client sets `x-tenant-id` from this. |
| `EXPO_PUBLIC_TENANTS_BASE` | optional | Alternate `/tenants` listing base | `${EXPO_PUBLIC_API_BASE}/tenants` | ☐ | Only needed if Tenants UI hits a dedicated endpoint. |

### 3.2 Web (Vite)
| Name | Where | Purpose | Example (NonProd) | Required | Notes |
|---|---|---|---|---|---|
| `VITE_API_BASE` | `.env` or CI | API Gateway base URL | `https://ki8kgivz1f.execute-api.us-east-1.amazonaws.com` | ✔ | |
| `VITE_TENANT` | `.env` or CI | Default tenant | `DemoTenant` | ✔ | |

### 3.3 API (Lambda env)
| Name | Purpose | Example (NonProd) | Required | Notes |
|---|---|---|---|---|
| `OBJECTS_TABLE` | DynamoDB table name | `mbapp_objects` | ✔ | Primary objects bucket. |
| `MAX_LIST_LIMIT` | Safety cap for list ops | `50` | ☐ | Default if unset is a conservative value. |
| `DEFAULT_TENANT` | Nonprod fallback tenant | `DemoTenant` | ☐ | Clients still send explicit header. |
| `CORS_ALLOW_ORIGIN` | CORS | `*` | ☐ | Tighter in prod. |
| `LOG_LEVEL` | Logging level | `info` | ☐ | |

### 3.4 Identifiers (nonprod reference)
| Thing | Value |
|---|---|
| API Gateway (nonprod) | `ki8kgivz1f` (base: `https://ki8kgivz1f.execute-api.us-east-1.amazonaws.com`) |
| Lambda (objects) | `mbapp-nonprod-objects` |
| DynamoDB table | `mbapp_objects` |
| GSI | `byId` (and/or single GSI for type/tenant listing per MBapp‑Master.md) |
| Canonical tenant | `DemoTenant` |

> Keep this table updated whenever infra IDs change.

---

## 4) Canonical contracts (summary)
- **Headers**: `x-tenant-id` (required). Optional future: `Idempotency-Key` (not implemented yet).
- **Pagination**: `limit` (≤ `MAX_LIST_LIMIT`), `next` (cursor).
- **Errors**: `{ error, message }` with HTTP 400/404/409/500.
- **Aliases**: `/products`, `/events`, `/registrations` map to generic `/objects/:type` handlers.
- **Search**: preferred shape uses `type`, `sku?`, `q?`, `order?`. Legacy `GET /objects?type=...&q=...` remains available.

---

## 5) Modules (current & near‑term)
- **Products**: CRUD, search by `sku|q`, `kind = good|service`.
- **Inventory (MVP)**: `type=inventory` via generic objects; later add `/inventory/*` for movements & locations.
- **Events & Registrations**: CRUD + `GET /events/:id/registrations` filter.
- **Scan**: `t="mbapp/object-v1"`, default `intent="navigate"`. Future: `attach-epc`, `reserve-resource`, `assign-stall`, `check-in`.

---

## 6) Config matrix (quick reference)
| Concern | Mobile (Expo) | Web (Vite) | API |
|---|---|---|---|
| API base | `EXPO_PUBLIC_API_BASE` | `VITE_API_BASE` | n/a |
| Tenant | `EXPO_PUBLIC_TENANT_ID` | `VITE_TENANT` | `DEFAULT_TENANT` (nonprod only) |
| Objects table | n/a | n/a | `OBJECTS_TABLE` |
| Pagination | UI via React Query (cursor) | UI via client (cursor) | `MAX_LIST_LIMIT` |
| Scan intents | implemented (`navigate`) | n/a | n/a |

---

## 7) Secrets & .env handling
- Never commit `.env` with secrets/IDs. Use `.env.local` (gitignored) for dev, CI vars for pipelines.
- Mobile: prefer `app.config.ts` with `EXPO_PUBLIC_*` (non‑secret).
- Web: use `VITE_*` at build time (non‑secret). Backend secrets stay in Lambda env.

---

## 8) Operating notes
- **Drop‑in policy**: when we change clients, provide complete file replacements and include a “what changed” summary.
- **Validation**: keep server validations minimal but explicit (SKU uniqueness tokens, required fields per type).
- **Observability**: standard JSON logs with `requestId`, `tenant`, `type`, `route`, `durationMs`.

---

## 9) Variable change log
> Append entries whenever variables or IDs change.

### 2025‑09‑16
- Established authoritative variables for Mobile (`EXPO_PUBLIC_*`), Web (`VITE_*`), and API env (`OBJECTS_TABLE`, `DEFAULT_TENANT`, `MAX_LIST_LIMIT`).
- Documented current nonprod IDs (API `ki8kgivz1f`, Lambda `mbapp-nonprod-objects`, Table `mbapp_objects`, tenant `DemoTenant`).

---

*Owner:* Bryan Hiller • *Stewardship:* Keep this doc stable; reference it in sprints and PR descriptions when envs/IDs change.