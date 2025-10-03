<# 
Publish-ObjectsLambda-Daily.ps1
Daily build & deploy for the Objects API Lambda using bootstrap entry.

What it does
- Builds: apps/api/src/bootstrap.ts → apps/api/dist/bootstrap.js (Node 18, CJS)
- Detects current Lambda handler (bootstrap.handler or dist/bootstrap.handler)
- Zips accordingly so handler↔ZIP layout always match
- Uploads code & waits until updated
- Smoke-tests GET {ApiBase}/health
- (optional) Auth smoke: POST /auth/login → GET /auth/policy

Usage
  .\Publish-ObjectsLambda-Daily.ps1 -FunctionName "mbapp-nonprod-objects" -Region "us-east-1" -ApiBase $Env:MBAPP_API_BASE
  .\Publish-ObjectsLambda-Daily.ps1 -FunctionName "mbapp-nonprod-objects" -Region "us-east-1" -ApiBase $Env:MBAPP_API_BASE -SetHandlerRoot
  .\Publish-ObjectsLambda-Daily.ps1 -FunctionName "mbapp-nonprod-objects" -Region "us-east-1" -ApiBase $Env:MBAPP_API_BASE -AuthSmoke -AuthTenant "DemoTenant"

Notes
- Requires AWS CLI and esbuild (or will use npx esbuild).
- Ensure jsonwebtoken is installed in apps/api (the script checks/installs if missing).
#>

[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$FunctionName,
  [Parameter(Mandatory=$true)][string]$Region,
  [string]$ApiBase,

  # Force-set handler before deploy (optional; pick one)
  [switch]$SetHandlerRoot,  # sets handler => "bootstrap.handler" (ZIP: bootstrap.js at root)
  [switch]$SetHandlerDist,  # sets handler => "dist/bootstrap.handler" (ZIP: includes dist/ folder)

  # Optional: do an auth smoke test after /health
  [switch]$AuthSmoke,
  [string]$AuthUserId = "dev-admin",
  [string]$AuthEmail  = "admin@example.com",
  [string[]]$AuthRoles = @("admin"),
  [string]$AuthTenant = "DemoTenant",
    # Optional: objects smoke test
  [switch]$ObjectsSmoke,
  [string]$ObjectsType   = "product",
  [string]$ObjectsTenant = "DemoTenant"

)

$ErrorActionPreference = "Stop"
Set-Location "C:\users\bryan\MBapp-pub"

function Get-Handler {
  (aws lambda get-function-configuration `
    --function-name $FunctionName `
    --query "Handler" `
    --output text `
    --region $Region).Trim()
}

function Ensure-JwtDep {
  Write-Host "Ensuring 'jsonwebtoken' is installed in apps/api ..." -ForegroundColor DarkCyan
  Push-Location apps/api
  try {
    $pkg = Get-Content package.json | ConvertFrom-Json
    if (-not ($pkg.dependencies -and $pkg.dependencies.jsonwebtoken)) {
      Write-Host "Installing jsonwebtoken ..." -ForegroundColor Yellow
      npm i jsonwebtoken | Out-Null
    }
    if (-not ($pkg.devDependencies -and $pkg.devDependencies."@types/jsonwebtoken")) {
      Write-Host "Installing @types/jsonwebtoken ..." -ForegroundColor Yellow
      npm i -D @types/jsonwebtoken | Out-Null
    }
  } finally { Pop-Location }
}

function Build-Bootstrap {
  Write-Host "Building apps/api/src/bootstrap.ts → apps/api/dist/bootstrap.js ..." -ForegroundColor DarkCyan
  $entry = "apps/api/src/bootstrap.ts"
  $outfile = "apps/api/dist/bootstrap.js"

  if (Get-Command esbuild -ErrorAction SilentlyContinue) {
    esbuild $entry --bundle --platform=node --target=node18 --format=cjs --outfile=$outfile --sourcemap --minify --external:aws-sdk
  } else {
    npx esbuild $entry --bundle --platform=node --target=node18 --format=cjs --outfile=$outfile --sourcemap --minify --external:aws-sdk
  }
  if (-not (Test-Path $outfile)) { throw "Build failed: $outfile not found" }
}

function Zip-For-Handler([string]$handler, [string]$zipPath) {
  New-Item -ItemType Directory -Force -Path (Split-Path $zipPath) | Out-Null
  if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $dist = Resolve-Path "apps/api/dist"

  if ($handler -eq "bootstrap.handler") {
    # put bootstrap.js at ZIP root
    Write-Host "Packaging ZIP for handler 'bootstrap.handler' (bootstrap.js at ZIP root) ..." -ForegroundColor DarkCyan
    $tmpDir = Join-Path ([System.IO.Path]::GetTempPath()) ("mbapp-dist-" + [System.Guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Path $tmpDir | Out-Null
    Copy-Item -Path (Join-Path $dist "bootstrap.js") -Destination (Join-Path $tmpDir "bootstrap.js")
    if (Test-Path (Join-Path $dist "bootstrap.js.map")) {
      Copy-Item -Path (Join-Path $dist "bootstrap.js.map") -Destination (Join-Path $tmpDir "bootstrap.js.map")
    }
    [IO.Compression.ZipFile]::CreateFromDirectory($tmpDir, (Resolve-Path (Split-Path $zipPath -Parent)).Path + "\bundle.zip")
    Remove-Item $tmpDir -Recurse -Force
  }
  elseif ($handler -eq "dist/bootstrap.handler") {
    # keep dist/ folder inside ZIP
    Write-Host "Packaging ZIP for handler 'dist/bootstrap.handler' (dist/bootstrap.js inside ZIP) ..." -ForegroundColor DarkCyan
    [IO.Compression.ZipFile]::CreateFromDirectory($dist, (Resolve-Path (Split-Path $zipPath -Parent)).Path + "\bundle.zip")
  }
  else {
    throw "Unexpected handler '$handler'. Expected 'bootstrap.handler' or 'dist/bootstrap.handler'."
  }

  if (-not (Test-Path $zipPath)) { throw "ZIP not found at $zipPath (packaging step failed)" }

  # Validate presence of expected file inside ZIP
  $entries = [IO.Compression.ZipFile]::OpenRead((Resolve-Path $zipPath)).Entries
  $ok = if ($handler -eq "bootstrap.handler") {
    ($entries | Where-Object { $_.FullName -eq "bootstrap.js" }).Count -gt 0
  } else {
    ($entries | Where-Object { $_.FullName -eq "dist/bootstrap.js" }).Count -gt 0
  }
  if (-not $ok) {
    throw "ZIP/handler mismatch. Handler '$handler' but required file not present inside bundle.zip."
  }
}

function Upload-And-Wait([string]$zipPath) {
  Write-Host "Uploading code to $FunctionName ..." -ForegroundColor DarkCyan
  $zipAbs = (Resolve-Path $zipPath).Path
  aws lambda update-function-code --function-name $FunctionName --zip-file "fileb://$zipAbs" --region $Region | Out-Null
  Write-Host "Waiting for function-updated ..." -ForegroundColor DarkCyan
  aws lambda wait function-updated --function-name $FunctionName --region $Region
}

function Smoke-Test {
  if (-not $ApiBase) { Write-Host "Skip smoke test (no -ApiBase supplied)"; return }
  Write-Host "Smoke testing GET $ApiBase/health ..." -ForegroundColor DarkCyan
  try {
    $h = Invoke-RestMethod -Method GET -Uri "$ApiBase/health"
    if ($h.ok -ne $true) { throw "Unexpected response: $($h | ConvertTo-Json)" }
    Write-Host "Health OK: { ok: true }" -ForegroundColor Green
  } catch {
    Write-Host "Health failed. Tail logs:" -ForegroundColor Red
    Write-Host "aws logs tail /aws/lambda/$FunctionName --since 5m --follow --region $Region" -ForegroundColor Yellow
    throw
  }
}

function Auth-Smoke {
  if (-not $ApiBase) { Write-Host "Skip auth smoke (no -ApiBase supplied)"; return }
  Write-Host "Auth smoke: POST $ApiBase/auth/login → GET /auth/policy (tenant=$AuthTenant) ..." -ForegroundColor DarkCyan

  # Build JSON body safely
  $bodyObj = @{
    userId  = $AuthUserId
    email   = $AuthEmail
    roles   = $AuthRoles
    tenants = @($AuthTenant)
  }
  $bodyJson = $bodyObj | ConvertTo-Json -Depth 5

  try {
    Write-Host "Auth smoke: POST $ApiBase/auth/login (tenant=$AuthTenant)" -ForegroundColor DarkCyan
    $login = Invoke-RestMethod -Method POST -Uri "$ApiBase/auth/login" -ContentType "application/json" -Body $bodyJson
    if (-not $login.token) {
  Write-Host "Login raw response:" -ForegroundColor Yellow
  ($login | ConvertTo-Json -Depth 6)
  throw "Login response missing token"
}
    $Env:MBAPP_TOKEN = $login.token

    $headers = @{
      Authorization = "Bearer $($Env:MBAPP_TOKEN)"
      "x-tenant-id" = $AuthTenant
    }
    $policy = Invoke-RestMethod -Method GET -Uri "$ApiBase/auth/policy" -Headers $headers

    # Print compact summary
    $roles   = ($policy.roles   -join ", ")
    $tenants = ($policy.tenants -join ", ")
    Write-Host "Auth OK → roles=[$roles], tenants=[$tenants]" -ForegroundColor Green
  } catch {
    Write-Host "Auth smoke failed: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Tip: tail logs → aws logs tail /aws/lambda/$FunctionName --since 5m --follow --region $Region" -ForegroundColor Yellow
    throw
  }
}

function Objects-Smoke {
  if (-not $ApiBase) { Write-Host "Skip objects smoke (no -ApiBase supplied)"; return }
  # Ensure we have a token (use one from Auth-Smoke or login now)
  if (-not $Env:MBAPP_TOKEN) {
    Write-Host "No MBAPP_TOKEN in env; doing a quick dev login for objects smoke ..." -ForegroundColor Yellow
    $bodyObj = @{ userId="dev-admin"; email="admin@example.com"; roles=@("admin"); tenants=@($ObjectsTenant) }
    $bodyJson = $bodyObj | ConvertTo-Json -Depth 4
    $login = Invoke-RestMethod -Method POST -Uri "$ApiBase/auth/login" -ContentType "application/json" -Body $bodyJson
    if (-not $login.token) { throw "Objects smoke: login failed (no token)" }
    $Env:MBAPP_TOKEN = $login.token
  }

  $h = @{ Authorization = "Bearer $($Env:MBAPP_TOKEN)"; "x-tenant-id" = $ObjectsTenant }
  $type = $ObjectsType

  Write-Host "Objects smoke on '$type' (tenant=$ObjectsTenant) ..." -ForegroundColor DarkCyan

  # 1) List (limit=1) — should 200 even if empty
  $listUrl = "$ApiBase/objects/$type?limit=1"
  $list = Invoke-RestMethod -Method GET -Uri $listUrl -Headers $h
  Write-Host "List OK ($type, limit=1)" -ForegroundColor Green

  # 2) Create minimal test object (module-specific defaults)
  $guid = ([guid]::NewGuid().ToString("N")).Substring(0,8)
  switch ($type) {
    "product" {
      $createObj = @{
        name   = "Smoke Product $guid"
        status = "active"
        sku    = "SMK-$guid"     # product SKU must be unique
      }
    }
    "client" {
      $createObj = @{
        name   = "Smoke Client $guid"
        status = "active"
        email  = "smoke+$guid@example.com"
      }
    }
    "event" {
      $createObj = @{
        name       = "Smoke Event $guid"
        status     = "available"
        startsAt   = (Get-Date).ToString("o")
        endsAt     = (Get-Date).AddHours(2).ToString("o")
      }
    }
    default {
      # Generic shape: name + status if your modules follow that convention
      $createObj = @{
        name   = "Smoke $type $guid"
        status = "active"
      }
    }
  }

  $createJson = $createObj | ConvertTo-Json -Depth 6
  $create = Invoke-RestMethod -Method POST -Uri "$ApiBase/objects/$type" -Headers $h -ContentType "application/json" -Body $createJson
  if (-not $create.id) { throw "Create failed: no 'id' returned for $type" }
  $id = $create.id
  Write-Host "Create OK → id=$id" -ForegroundColor Green

  # 3) Get by id
  $got = Invoke-RestMethod -Method GET -Uri "$ApiBase/objects/$type/$id" -Headers $h
  if (-not $got.id) { throw "Get failed for $type/$id" }
  Write-Host "Get OK" -ForegroundColor Green

  # 4) Update (rename)
  $updateObj = @{ name = "$($createObj.name) (updated)" }
  $updateJson = $updateObj | ConvertTo-Json
  $upd = Invoke-RestMethod -Method PUT -Uri "$ApiBase/objects/$type/$id" -Headers $h -ContentType "application/json" -Body $updateJson
  Write-Host "Update OK" -ForegroundColor Green

  # 5) Delete (cleanup)
  $null = Invoke-RestMethod -Method DELETE -Uri "$ApiBase/objects/$type/$id" -Headers $h
  Write-Host "Delete OK (cleanup complete)" -ForegroundColor Green

  Write-Host "Objects smoke PASS for '$type'." -ForegroundColor Green
}


Write-Host "== Daily Publish: $FunctionName ($Region) ==" -ForegroundColor Cyan

# 0) Tooling & layout checks
if (-not (Get-Command aws -ErrorAction SilentlyContinue)) { throw "AWS CLI not found in PATH" }
if (-not (Test-Path "apps/api/src")) { throw "Expected apps/api/src (run from repo root)" }

# 1) Optional: force handler (choose one)
if ($SetHandlerRoot -and $SetHandlerDist) { throw "Use only one of -SetHandlerRoot or -SetHandlerDist" }
if ($SetHandlerRoot) {
  Write-Host "Setting Lambda handler → bootstrap.handler ..." -ForegroundColor Yellow
  aws lambda update-function-configuration --function-name $FunctionName --handler "bootstrap.handler" --runtime nodejs18.x --region $Region | Out-Null
}
if ($SetHandlerDist) {
  Write-Host "Setting Lambda handler → dist/bootstrap.handler ..." -ForegroundColor Yellow
  aws lambda update-function-configuration --function-name $FunctionName --handler "dist/bootstrap.handler" --runtime nodejs18.x --region $Region | Out-Null
}

# 2) Determine current handler
$handler = Get-Handler
Write-Host "Current handler: $handler" -ForegroundColor Gray
if ($handler -ne "bootstrap.handler" -and $handler -ne "dist/bootstrap.handler") {
  throw "Unsupported handler '$handler'. Set -SetHandlerRoot or -SetHandlerDist once, then re-run."
}

# 3) Ensure deps, build, package to match handler
Ensure-JwtDep
Build-Bootstrap

$zipPath = "apps/api/artifacts/bundle.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
New-Item -ItemType Directory -Force -Path (Split-Path $zipPath) | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem
Zip-For-Handler -handler $handler -zipPath $zipPath

# 4) Upload & wait
Upload-And-Wait -zipPath $zipPath

# 5) Smoke tests
Smoke-Test
if ($AuthSmoke) { Auth-Smoke }

# Write-Host "✓ Daily deploy complete." -ForegroundColor Green

if ($ObjectsSmoke) { Objects-Smoke }
