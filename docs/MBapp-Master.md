# MBapp — Master Systems Doc (Nonprod)

\_Last updated: 2025-09-09\_SCAN=false\`).

## Env vars (expanded)

* **OBJECTS\_TABLE** = `mbapp_objects`
* **BY\_ID\_INDEX**  = `byId`
* **MAX\_LIST\_LIMIT** = `100`
* **MAX\_SEARCH\_LIMIT** = `50`
* **SEARCH\_ALLOW\_SCAN** = `false` (enable only temporarily in nonprod if needed)

## IAM permissions (nonprod)

* Lambda role **mbapp-nonprod-objects-lambda-role** must allow DynamoDB actions on `mbapp_objects`:

  * `dynamodb:GetItem`, `dynamodb:PutItem`, `dynamodb:UpdateItem`, `dynamodb:Query`
  * (Optional in nonprod only if `SEARCH_ALLOW_SCAN=true`) `dynamodb:Scan`
  * Resources: `arn:aws:dynamodb:us-east-1:<account>:table/mbapp_objects` and `.../table/mbapp_objects/index/*`
* **Default posture:** scans disabled; prefer queries (GSI `gsi2` for EPC/tag search; primary PK for type+name search).

## Listing & Search semantics

**List:** `GET /objects/{type}/list`

* **Query params:** `limit` (1..MAX\_LIST\_LIMIT; default 20), `cursor` (base64), `order` (`asc|desc`, default `desc`), filters: `name`, `namePrefix`.
* **Response:** `{ items: [], nextCursor?: string, prevCursor?: string, order: 'asc'|'desc' }`
* **Notes:** Uses primary key (`pk = TENANT#{tenantId}#TYPE#{type}`) with `begins_with(sk, 'ID#')`. No Scan.

**Search:** `GET /objects/search`

* **Preferred modes:**

  1. By EPC: `rfidEpc` → Query **GSI `gsi2`** (`gsi2pk=tag#{epc}`, `gsi2sk=tenant#{tenantId}`) + optional `type` filter.
  2. By type+name: `type` + (`name` contains or `namePrefix`) → Query primary PK and FilterExpression on `name`.
* **Fallback:** Scan only when `SEARCH_ALLOW_SCAN=true` (nonprod), with same filters.
* **Query params:** `type`, `rfidEpc`, `name`, `namePrefix`, `limit` (<= MAX\_SEARCH\_LIMIT), `cursor`, `order`.
* **Response:** `{ items: [], nextCursor?: string, prevCursor?: string, order: 'asc'|'desc' }`

## Post-merge checklist

* [x] Router wired for list/search; CJS bundle deployed to **mbapp-nonprod-objects**
* [x] Env set: `MAX_LIST_LIMIT`, `MAX_SEARCH_LIMIT`, `SEARCH_ALLOW_SCAN=false`
* [ ] (Optional) Add **CORS** helper for future web clients
* [ ] Normalize error envelope to `{ error, message }` everywhere
* [ ] CI: add typecheck + bundle on PRs to **MBapp-pub/main**
