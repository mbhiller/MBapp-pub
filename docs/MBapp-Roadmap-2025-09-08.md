\# MBapp Roadmap \& Sprint Summary (as of Sep 8, 2025)



---



\## Sprint Summary (last 7–10 days)



\*\*Context:\*\* Working branch `feature/phase4-objects-api` with focus on Objects API hardening and Mobile Scan flow.



\### ✅ What we accomplished



\* \*\*API / Objects\*\*



&nbsp; \* `POST /objects/{type}` create with validation (e.g., \*\*name is required\*\*).

&nbsp; \* `GET /objects/{id}?type=…` flexible GET working (query param `type` required when ID-only path is used).

&nbsp; \* `PUT /objects/{type}/{id}` update implemented and verified.

&nbsp; \* Negative test: GET non-existent id returns 404 correctly.

&nbsp; \* \*\*Smoke test (robust v3)\*\* end‑to‑end: \*\*All steps green\*\* (2025‑09‑04).

\* \*\*Mobile (Expo RN)\*\*



&nbsp; \* `ScanScreen` with camera permissions and scanning on.

&nbsp; \* \*\*Scan buttons\*\*: header button + floating action button.

&nbsp; \* Create + Get flows verified against nonprod API.

&nbsp; \* Object detail currently renders “raw” JSON (Create view shows richer fields) — earmarked for UI uplift.

\* \*\*Repo \& Layout\*\*



&nbsp; \* Clean re‑clone and branch alignment; TypeScript errors addressed; monorepo sanity checks.



\### ⚠️ Items in progress / noted



\* `listByType` and `searchByTag` handlers referenced in `src/index.ts` to be (re)added.

\* Object detail UI normalization across Create/Get code paths.

\* Lightweight QR generator script requested (PowerShell) for local test payloads.



\### 📦 Deliverables in this update



\* \*\*New script:\*\* `tools/Make-JsonQr.ps1` (see below). Generates a PNG QR that encodes a JSON object with default demo values (includes \*\*name\*\*, \*\*type\*\*, \*\*tenant\*\*, \*\*id\*\*).



---



\## Roadmap (phase-driven)



\### Phase 4 – Objects API + Mobile scan (current)



\* \*\*Backend / API Gateway + Lambda (DynamoDB)\*\*



&nbsp; \* \[x] Create object: `POST /objects/{type}` (validates `name`).

&nbsp; \* \[x] Get object: `GET /objects/{id}?type=…` (query `type` required).

&nbsp; \* \[x] Update object: `PUT /objects/{type}/{id}`.

&nbsp; \* \[ ] \*\*List by type\*\*: `GET /objects/{type}?limit=\&nextToken=`.

&nbsp; \* \[ ] \*\*Search by tag\*\*: `GET /objects/search?tag=`.

&nbsp; \* \[ ] \*\*Scans ingest\*\*: `POST /scans` (QR/RFID events to `scans` table).

&nbsp; \* \[ ] \*\*Device registry (MVP)\*\*: `devices` table + attach scan source.

&nbsp; \* \[ ] Soft‑delete (`isDeleted`, optional `ttl`), optimistic concurrency.

\* \*\*Mobile (Expo React Native)\*\*



&nbsp; \* \[x] Scan button in header and FAB.

&nbsp; \* \[x] QR scan → Object fetch flow.

&nbsp; \* \[ ] \*\*ObjectDetailScreen:\*\* carded layout of core fields (name, type, id, createdAt, tags) instead of raw JSON.

&nbsp; \* \[ ] Error states, pull‑to‑refresh, skeletons.

&nbsp; \* \[ ] Offline cache (React Query persist) + simple retry.

&nbsp; \* \[ ] Share/export: generate QR for existing object.

\* \*\*Infra / CI\*\*



&nbsp; \* \[ ] Terraform module: Objects API (routes, stages, env) — one‑shot apply for nonprod.

&nbsp; \* \[ ] GitHub Actions: lint/test/package Lambdas; plan/apply with safe approvals.

&nbsp; \* \[ ] Artifact retention + S3 packaging for Lambdas.

\* \*\*Security \& Tenancy\*\*



&nbsp; \* \[x] us‑east‑1 region set as default.

&nbsp; \* \[ ] AppConfig toggles for feature flags.

&nbsp; \* \[ ] Nonprod ↔ prod workspaces via Terraform; SSM params for API base.

\* \*\*Observability\*\*



&nbsp; \* \[ ] Structured JSON logs (pino) and trace IDs.

&nbsp; \* \[ ] CloudWatch alarms on 5xx/error rate; DLQ for failures.

\* \*\*Docs \& Ops\*\*



&nbsp; \* \[ ] Full‑stack runbook refresh (adds CloudFront section, mobile build steps).

&nbsp; \* \[ ] Postman collections (Objects, Scans) updated.



\### Phase 5 – Web Admin + Tagging



\* \[ ] Minimal web admin: tenants, types, tags.

\* \[ ] Tagging model (add/remove/search), batch operations.

\* \[ ] CloudFront in front of web (if not already deployed) + cache policy.



\### Phase 6 – RFID \& Device flow



\* \[ ] Device adapters, reader pairing.

\* \[ ] Scan normalization (QR/RFID), reconciliation to objects.

\* \[ ] Streaming ingest (Kinesis/SQS) and idempotency keys.



---



\## Concrete Checklist (running)



\*\*Objects API\*\*



\* \[x] POST /objects/{type}

\* \[x] GET /objects/{id}?type=…

\* \[x] PUT /objects/{type}/{id}

\* \[ ] GET /objects/{type} (listByType)

\* \[ ] GET /objects/search (searchByTag)

\* \[ ] POST /scans (ingest)

\* \[ ] Device registry (MVP)

\* \[ ] Soft‑delete + TTL



\*\*Mobile App\*\*



\* \[x] Scan UX (header + FAB)

\* \[x] Scan → fetch flow

\* \[ ] Object detail cards

\* \[ ] Error/loading/refresh states

\* \[ ] Offline cache

\* \[ ] Share/generate QR from object



\*\*Infra / CI/CD\*\*



\* \[ ] Terraform for Objects API

\* \[ ] GitHub Actions CI for Lambdas

\* \[ ] Nonprod workspace pipelines



\*\*Security \& Observability\*\*



\* \[x] Region locked to us‑east‑1

\* \[ ] AppConfig toggles

\* \[ ] Logs + alarms + DLQ



\*\*Docs / Tooling\*\*



\* \[x] Smoke tests (robust v3) passing

\* \[x] \*\*Make-JsonQr.ps1\*\* (delivered below)

\* \[ ] Runbook + Postman refresh



---



\## Next Steps (action plan)



1\. \*\*Finish list \& search\*\*



&nbsp;  \* Implement `src/objects/listByType.ts` and `src/objects/searchByTag.ts`; export from `src/index.ts`.

&nbsp;  \* DynamoDB: GSI on `tenantId + type` (partition) with `createdAt` (sort) for listing; optional GSI for `tenantId + tag` for search.

&nbsp;  \* Add smoke steps for list/search; redeploy.

2\. \*\*Upgrade ObjectDetailScreen\*\*



&nbsp;  \* Render cards for core fields; leave “Raw JSON” behind a collapsible for debugging.

3\. \*\*(Done here) Add QR generator script\*\*



&nbsp;  \* Commit `tools/Make-JsonQr.ps1`; wire a README and add to dev checklist.

4\. \*\*Terraformize nonprod Objects API\*\*



&nbsp;  \* Module for API, routes, env, IAM; backend state in S3+DDB; apply from nonprod.

5\. \*\*Logging \& Alarming (MVP)\*\*



&nbsp;  \* Structured logs + basic 5xx alarm per stage.



---



\## Deliverable: tools/Make-JsonQr.ps1



> \*\*Purpose:\*\* Generate a PNG QR that encodes JSON your app can scan to open object detail.



\*\*Usage\*\*



```powershell

\# From repo root

./tools/Make-JsonQr.ps1

\# or with overrides

./tools/Make-JsonQr.ps1 -Out "qr-horse.png" -Tenant "DemoTenant" -Type "horse" -Name "Test Horse"

```



\*\*What it creates\*\*



\* `qr-object.png` — PNG QR image

\* `qr-object.json` — the exact JSON encoded in the QR (for reference)



\*\*Script (drop‑in)\*\*



```powershell

param(

&nbsp; \[string]$Out = "qr-object.png",

&nbsp; \[string]$Tenant = "DemoTenant",

&nbsp; \[string]$Type = "horse",

&nbsp; \[string]$Name = "Test Horse",

&nbsp; \[string]$Id = $null,

&nbsp; \[switch]$OpenFile

)



function Require-Cmd($cmd, $installHint) {

&nbsp; $null = \& $cmd -v 2>$null

&nbsp; if ($LASTEXITCODE -ne 0) {

&nbsp;   Write-Error "`"$cmd`" not found. $installHint"; exit 1

&nbsp; }

}



Require-Cmd node "Install Node.js LTS from https://nodejs.org and re-run."



if (-not $Id) { $Id = \[guid]::NewGuid().ToString() }



$payloadObj = \[ordered]@{

&nbsp; v = 1

&nbsp; tenant = $Tenant

&nbsp; type = $Type

&nbsp; id = $Id

&nbsp; name = $Name  # server requires name

&nbsp; ts = \[DateTime]::UtcNow.ToString("o")

}



$here = Split-Path -Parent $MyInvocation.MyCommand.Path

$work = Join-Path $here ".qrwork"

$null = New-Item -ItemType Directory -Force -Path $work | Out-Null



$jsonPath = Join-Path $work "qr-object.json"

$payloadObj | ConvertTo-Json -Depth 8 | Out-File -Encoding UTF8 $jsonPath



\# Minimal node project in working folder (once)

if (-not (Test-Path (Join-Path $work "node\_modules/qrcode"))) {

&nbsp; Push-Location $work

&nbsp; if (-not (Test-Path "package.json")) { npm init -y | Out-Null }

&nbsp; npm install qrcode@^1 --no-audit --no-fund | Out-Null

&nbsp; Pop-Location

}



$jsPath = Join-Path $work "makeqr.js"

@'

const fs = require("fs");

const QRCode = require("qrcode");



const out = process.argv\[2];

const jsonPath = process.argv\[3];

const text = fs.readFileSync(jsonPath, "utf8");



QRCode.toFile(out, text, {

&nbsp; type: "png",

&nbsp; errorCorrectionLevel: "M",

&nbsp; margin: 1,

&nbsp; scale: 8

}, (err) => {

&nbsp; if (err) { console.error(err); process.exit(1); }

&nbsp; else { console.log("wrote", out); }

});

'@ | Out-File -Encoding UTF8 $jsPath



\# Write outputs next to script for convenience

$outPath = Join-Path $here $Out



Push-Location $work

node $jsPath $outPath $jsonPath | Write-Host

Pop-Location



Copy-Item $jsonPath (Join-Path $here "qr-object.json") -Force



if ($OpenFile) { \& $outPath }



Write-Host "\\n✅ QR written:" $outPath

Write-Host "🧾 JSON saved:" (Join-Path $here "qr-object.json")

```



\*\*Notes\*\*



\* The JSON includes `name`, satisfying the server-side validation (“name is required”).

\* You can adjust fields or add `tags` later; any extra fields will be carried through the QR payload and ignored by the backend unless used.



---



\## Object Detail UI (quick target)



> Goal: show core fields in a pleasant card UI and keep the raw JSON behind a collapsible.



\* Fields: \*\*name\*\*, \*\*type\*\*, \*\*id\*\*, \*\*tenant\*\*, \*\*createdAt/updatedAt\*\*, \*\*tags\*\* (if present)

\* Add a `copy`/`share` action and a button to \*\*Generate QR\*\* (which can call a local helper to open the QR image from the above script or a future in‑app generator).



---



\## Working Branch \& Commit Hints



\* Branch: `feature/phase4-objects-api`

\* Add: `apps/api/src/objects/listByType.ts`, `searchByTag.ts`, exports in `src/index.ts`.

\* Add: `tools/Make-JsonQr.ps1` + `tools/README.md` (usage \& examples).

\* Optional: `apps/mobile/src/screens/ObjectDetailScreen.tsx` uplift.



---



\## Quick Smoke (reference)



```powershell

node ./smoke-robust-v3-20250904-164502.mjs `

&nbsp; --api https://<api-id>.execute-api.us-east-1.amazonaws.com `

&nbsp; --tenant DemoTenant --type horse

```



---



\## Open Questions (log for later)



\* Do we want optimistic concurrency on updates now (etag via `updatedAt`), or later?

\* Tag search: prefer GSI or filter on listByType for MVP?

\* In‑app QR generation vs. external script — timing for parity?



