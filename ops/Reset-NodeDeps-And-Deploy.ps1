param(
  [string]$Region      = "us-east-1",
  [string]$Profile     = "mbapp-nonprod-admin",
  [string]$ApiId       = "ki8kgivz1f",
  [string]$LambdaName  = "mbapp-nonprod-objects",
  [string]$ExpoApiBase = "https://ki8kgivz1f.execute-api.us-east-1.amazonaws.com",
  [string]$TenantId    = "DemoTenant",
  [switch]$EnsureRoutes # add/verify HTTP API routes
)

function Info($msg){ Write-Host "== $msg" -ForegroundColor Cyan }
function Step($msg){ Write-Host "-> $msg" -ForegroundColor Yellow }
function Ok($msg){ Write-Host "✓ $msg" -ForegroundColor Green }
function Err($msg){ Write-Host "✗ $msg" -ForegroundColor Red }

# ---------- Reset & build API ----------
Info "Resetting and building apps/api"
Push-Location apps\api
Step "Clean node_modules + lockfile"
if (Test-Path node_modules) { Remove-Item -Recurse -Force node_modules }
if (Test-Path package-lock.json) { Remove-Item -Force package-lock.json }

Step "npm ci"
npm ci
if ($LASTEXITCODE -ne 0) { Err "npm ci failed (api)"; exit 1 }

Step "build api (esbuild)"
npm run build
if ($LASTEXITCODE -ne 0) { Err "npm run build failed (api)"; exit 1 }

Step "zip dist/index.js -> dist.zip"
if (Test-Path dist.zip) { Remove-Item -Force dist.zip }
Compress-Archive -Path .\dist\index.js -DestinationPath .\dist.zip -Force
Ok "api build packaged"

# ---------- Deploy Lambda ----------
Info "Deploying Lambda $LambdaName"
aws lambda update-function-code `
  --function-name $LambdaName `
  --zip-file fileb://dist.zip `
  --region $Region --profile $Profile | Out-Null

aws lambda wait function-updated `
  --function-name $LambdaName `
  --region $Region --profile $Profile
Ok "Lambda updated"

Pop-Location

# ---------- (Optional) Ensure HTTP API routes ----------
if ($EnsureRoutes) {
  Info "Ensuring HTTP API routes on $ApiId"
  $ints = aws apigatewayv2 get-integrations --api-id $ApiId --region $Region --profile $Profile | ConvertFrom-Json
  $int  = $ints.Items | Where-Object {
    $_.IntegrationUri -match $LambdaName -or $_.IntegrationType -eq "AWS_PROXY"
  } | Select-Object -First 1
  if (-not $int) { Err "No integration found for $LambdaName"; exit 1 }
  $target = "integrations/$($int.IntegrationId)"

  $routeKeys = @(
    'ANY /products','ANY /products/{id}','ANY /products/search',
    'ANY /events','ANY /events/{id}','ANY /events/{id}/registrations',
    'ANY /registrations','ANY /registrations/{id}',
    'ANY /objects','ANY /objects/{type}','ANY /objects/{type}/{id}',
    'ANY /__echo', '$default'
  )
  $existing = (aws apigatewayv2 get-routes --api-id $ApiId --region $Region --profile $Profile | ConvertFrom-Json).Items
  foreach($rk in $routeKeys){
    if($existing | Where-Object { $_.RouteKey -eq $rk }){
      Write-Host "Route exists: $rk" -ForegroundColor DarkGray
    } else {
      Step "Creating route: $rk"
      aws apigatewayv2 create-route --api-id $ApiId --route-key $rk --target $target --region $Region --profile $Profile | Out-Null
    }
  }
  Ok "Routes ensured"
}

# ---------- Reset & check Mobile ----------
Info "Resetting apps/mobile deps"
Push-Location apps\mobile

Step "Clean node_modules + lockfile"
if (Test-Path node_modules) { Remove-Item -Recurse -Force node_modules }
if (Test-Path package-lock.json) { Remove-Item -Force package-lock.json }

Step "npm ci (mobile)"
npm ci
if ($LASTEXITCODE -ne 0) { Err "npm ci failed (mobile)"; exit 1 }

Step "Typecheck (mobile)"
npx tsc --noEmit
if ($LASTEXITCODE -ne 0) { Err "Typecheck failed (mobile)"; exit 1 } else { Ok "Typecheck clean" }

Pop-Location

# ---------- Print handy env + smokes ----------
Info "Expo env to run locally:"
Write-Host ('$env:EXPO_PUBLIC_API_BASE = "' + $ExpoApiBase + '"')
Write-Host ('$env:EXPO_PUBLIC_TENANT_ID = "' + $TenantId + '"')
Write-Host 'npx expo start -c'
Write-Host ""

Info "API smoke commands:"
Write-Host ('$API="' + $ExpoApiBase + '"')
Write-Host ('$HDR=@{ "x-tenant-id"="' + $TenantId + '"; "content-type"="application/json" }')
Write-Host 'Invoke-RestMethod "$API/__echo"'
Write-Host '$p = Invoke-RestMethod -Method POST "$API/products" -Headers $HDR -Body (@{ name="Smoke Product" } | ConvertTo-Json)'
Write-Host 'Invoke-RestMethod "$API/products/$($p.id)" -Headers $HDR | ConvertTo-Json -Depth 4'
Write-Host '$e = Invoke-RestMethod -Method POST "$API/events" -Headers $HDR -Body (@{ name="Smoke Event" } | ConvertTo-Json)'
Write-Host 'Invoke-RestMethod "$API/events?sort=desc" -Headers $HDR | ConvertTo-Json -Depth 4'
Write-Host '$r = Invoke-RestMethod -Method POST "$API/registrations" -Headers $HDR -Body (@{ eventId=$e.id; accountId="acct-smoke" } | ConvertTo-Json)'
Write-Host 'Invoke-RestMethod "$API/events/$($e.id)/registrations" -Headers $HDR | ConvertTo-Json -Depth 4'
Ok "All done"
