param(
  [string]$ApiPath    = "apps/api",
  [string]$MobilePath = "apps/mobile"
)

$expectedApi = @(
  "package.json","tsconfig.json",
  "src/index.ts",
  "src/common/ddb.ts","src/common/env.ts","src/common/responses.ts",
  "src/objects/create.ts","src/objects/get.ts","src/objects/update.ts"
)
$expectedMobile = @(
  "package.json","tsconfig.json","app.json","app.config.ts","babel.config.js","metro.config.js",
  "src/api/client.ts","src/App.tsx"
)

function Test-Missing($root,$list){
  $list | ForEach-Object {
    $p = Join-Path $root $_
    [pscustomobject]@{ Path=$_; Present=(Test-Path $p) }
  }
}

$apiReport    = Test-Missing $ApiPath    $expectedApi
$mobileReport = Test-Missing $MobilePath $expectedMobile

"=== API files ==="
$apiReport | Format-Table -AutoSize
"`n=== Mobile files ==="
$mobileReport | Format-Table -AutoSize

$missing = @(
  $apiReport    | Where-Object { -not $_.Present } | ForEach-Object { "API: $($_.Path)" }
  $mobileReport | Where-Object { -not $_.Present } | ForEach-Object { "MOBILE: $($_.Path)" }
)
$new = "# Repo audit`n`n" + (($missing | ForEach-Object { "- $_" }) -join "`n")
if ($missing.Count -eq 0) { $new = "# Repo audit`n`nAll expected files present." }

New-Item -ItemType Directory -Force -Path docs | Out-Null
Set-Content -Encoding UTF8 -Path "docs/repo-audit.md" -Value $new
Write-Host "`nWrote docs/repo-audit.md"
