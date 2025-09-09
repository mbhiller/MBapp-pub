# MBapp — Master Systems Doc (Nonprod)

_Last updated: 2025-09-09_

## Overview
- **Region:** `us-east-1`
- **API Gateway ID:** `ki8kgivz1f`
- **Base URL:** `https://ki8kgivz1f.execute-api.us-east-1.amazonaws.com`
- **Primary Lambda (monolith):** `mbapp-nonprod-objects`
- **DynamoDB table:** `mbapp_objects`

---

## Env vars (expanded)
- **OBJECTS_TABLE** = `mbapp_objects`
- **BY_ID_INDEX**   = `byId`
- **MAX_LIST_LIMIT**   = `100`
- **MAX_SEARCH_LIMIT** = `50`
- **SEARCH_ALLOW_SCAN** = `false` (enable only temporarily in nonprod if needed)

---

## IAM permissions (nonprod)
- Lambda role **mbapp-nonprod-objects-lambda-role** must allow DynamoDB actions on `mbapp_objects`:
  - `dynamodb:GetItem`, `dynamodb:PutItem`, `dynamodb:UpdateItem`, `dynamodb:Query`
  - *(Optional in nonprod only if `SEARCH_ALLOW_SCAN=true`)* `dynamodb:Scan`
  - **Resources:**  
    `arn:aws:dynamodb:us-east-1:<account>:table/mbapp_objects`  
    `arn:aws:dynamodb:us-east-1:<account>:table/mbapp_objects/index/*`
- **Default posture:** scans disabled; prefer queries (GSI `gsi2` for EPC/tag search; primary PK for type+name search).

---

## Data model (DynamoDB)
- **PK/SK:**  
  `pk = TENANT#<tenantId>#TYPE#<type>`  
  `sk = ID#<uuid>`
- **Attributes:** `id`, `tenantId`, `type`, `name`, `tags`, `integrations`, `createdAt`, `updatedAt`, `id_tenant`
- **Legacy/aux GSIs (optional):**
  - `gsi1pk = type#<type>#tenant#<tenantId>`; `gsi1sk = <ISO timestamp>`
  - `gsi2pk = tag#<rfidEpc>`; `gsi2sk = tenant#<tenantId>` (for EPC lookup)
  - **BY_ID_INDEX** (`byId`) variations supported by code for type inference.

---

## Routes → Behavior
All routes are integrated to **mbapp-nonprod-objects** (AWS_PROXY).

| Route Key                      | Purpose                               | Notes |
|---|---|---|
| `POST /objects/{type}`         | Create object                         | Server generates `id`, returns 201 + `Location` |
| `GET /objects/{type}/{id}`     | Get object (canonical)                | Mobile client uses this |
| `GET /objects/{id}`            | Legacy get by id                      | 308 redirect to canonical if type known/inferred |
| `PUT /objects/{type}/{id}`     | Update object                         | Updates `name`, `tags`, `integrations` |
| `GET /objects/{type}/list`     | List by type                          | Pagination via `nextCursor` |
| `GET /objects/{type}`          | Alias to list                         | Same response shape |
| `GET /objects/search`          | Search                                | EPC via `gsi2`, or `type` + `name`/`namePrefix` via PK |
| `GET /tenants`                 | Simple stub                           | Returns `[ { id, name } ]` |
| `GET /objects`                 | Not implemented                       | Returns `{error:"NotImplemented",...}` |
| `DELETE /objects/{type}/{id}`  | Not implemented                       | Returns `{error:"NotImplemented",...}` |
| `$default`                     | Not implemented                       | Returns `{error:"NotImplemented",...}` |

---

## Response conventions
- **CORS:** `access-control-allow-origin: *`, `-methods: GET,POST,PUT,DELETE,OPTIONS`, `-headers: content-type,x-tenant-id`
- **Errors:** normalized as `{ "error": "<Kind>", "message": "<detail>" }`  
  Kinds: `BadRequest`, `NotFound`, `Conflict`, `NotImplemented`, `Internal`
- **Correlation:** every response includes **`x-request-id`** from API Gateway `requestContext.requestId`.

### Structured logs (one per request)
```json
{"level":"info","requestId":"<id>","routeKey":"GET /objects/{type}/{id}","method":"GET","path":"/objects/horse/123","statusCode":200,"durationMs":58}
```

> **CloudWatch Logs Insights**
> - Per-route latency:
>   ```
>   fields @timestamp, routeKey, method, statusCode, durationMs
>   | filter ispresent(level)
>   | stats count() as calls, avg(durationMs) as avg_ms, pct(durationMs,95) as p95_ms by routeKey, method, statusCode
>   | sort by p95_ms desc
>   ```
> - Recent errors:
>   ```
>   fields @timestamp, routeKey, method, statusCode, durationMs
>   | filter statusCode >= 400
>   | sort @timestamp desc
>   | limit 50
>   ```

---

## Listing & Search semantics

### List — `GET /objects/{type}/list`
**Query params**
- `limit` (1..`MAX_LIST_LIMIT`, default 20)
- `cursor` (base64; pass through from `nextCursor`)
- `order` = `asc` \| `desc` (default `desc`)
- Filters: `name` (contains), `namePrefix` (prefix)

**Response**
```json
{
  "items": [ /* object items */ ],
  "nextCursor": "base64-encoded-key",
  "prevCursor": "echo of inbound cursor if present",
  "order": "asc|desc"
}
```

### Search — `GET /objects/search`
**Preferred modes**
1. **EPC**: `rfidEpc` → Query **GSI `gsi2`** (`gsi2pk=tag#<epc>`, `gsi2sk=tenant#<tenant>`) + optional `type` filter.
2. **Type+Name**: `type` + (`name` contains \| `namePrefix`) → Query primary PK (`TENANT#...#TYPE#...`) + filter on `name`.

**Fallback**
- Table **Scan** only when `SEARCH_ALLOW_SCAN=true` (nonprod), same filters.

**Query params**
- `type`, `rfidEpc`, `name`, `namePrefix`, `limit` (<= `MAX_SEARCH_LIMIT`), `cursor`, `order`

**Response**
_Same shape as list_

---

## Mobile client expectations
- Canonical GET: `/objects/{type}/{id}`
- List first: `/objects/{type}/list` (fallback to `/objects/{type}`)
- Error envelope `{ error, message }` and `x-request-id` surfaced by axios interceptor.

---

## Smoke (PowerShell)
```powershell
$API="https://ki8kgivz1f.execute-api.us-east-1.amazonaws.com"
$TENANT="DemoTenant"; $TYPE="horse"
$hdr=@{ "x-tenant-id"=$TENANT; "content-type"="application/json" }

# Create
$name = "Smoke $([DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss'))"
$create = Invoke-RestMethod -Method POST "$API/objects/$TYPE" -Headers $hdr -Body (@{ name=$name }|ConvertTo-Json)
$id = $create.id

# Get
$get = Invoke-RestMethod -Method GET "$API/objects/$TYPE/$id" -Headers $hdr

# List (filtered + paginate)
$list1 = Invoke-RestMethod -Method GET "$API/objects/$TYPE/list?limit=2&name=Smoke" -Headers $hdr
if ($list1.nextCursor) {
  $list2 = Invoke-RestMethod -Method GET "$API/objects/$TYPE/list?limit=2&cursor=$([uri]::EscapeDataString($list1.nextCursor))" -Headers $hdr
}

# Search
$search = Invoke-RestMethod -Method GET "$API/objects/search?type=$TYPE&name=Smoke&limit=3" -Headers $hdr
```

---

## Post-merge checklist
- [x] Router wired for list/search; CJS bundle deployed to **mbapp-nonprod-objects**
- [x] Env set: `MAX_LIST_LIMIT`, `MAX_SEARCH_LIMIT`, `SEARCH_ALLOW_SCAN=false`
- [x] CORS enabled (OPTIONS preflight + `access-control-allow-*` headers on all responses)
- [x] Normalized error envelope `{ error, message }` across handlers
- [x] CI added: typecheck api/mobile + bundle api on push/PR to `main`
- [x] Correlation-id header and structured logs
- [ ] (Optional) Retire legacy lambdas or rewire via IaC
