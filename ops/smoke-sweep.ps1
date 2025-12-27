# Sprint III Smoke Sweep
# Run all available smokes and collect results

$smokes = @(
  'smoke:close-the-loop',
  'smoke:close-the-loop-multi-vendor',
  'smoke:close-the-loop-partial-receive',
  'smoke:vendor-guard-enforced',
  'list',
  'smoke:ping',
  'smoke:po-receive-lot-location-assertions',
  'smoke:parties:happy',
  'smoke:parties:crud',
  'smoke:products:crud',
  'smoke:inventory:crud',
  'smoke:inventory:onhand',
  'smoke:inventory:guards',
  'smoke:inventory:onhand-batch',
  'smoke:inventory:list-movements',
  'smoke:locations:crud',
  'smoke:inventory:putaway',
  'smoke:inventory:cycle-count',
  'smoke:inventory:movements-by-location',
  'smoke:inventory:onhand-by-location',
  'smoke:inventory:adjust-negative',
  'smoke:sales:happy',
  'smoke:sales:guards',
  'smoke:sales:fulfill-with-location',
  'smoke:sales:reserve-with-location',
  'smoke:sales:commit-with-location',
  'smoke:salesOrders:commit-strict-shortage',
  'smoke:salesOrders:commit-nonstrict-backorder',
  'smoke:purchasing:happy',
  'smoke:purchasing:guards',
  'smoke:purchasing:suggest-po-skips',
  'smoke:po:save-from-suggest',
  'smoke:po:quick-receive',
  'smoke:po:receive-line',
  'smoke:po:receive-line-batch',
  'smoke:po:receive-line-idem-different-key',
  'smoke:po-receive-after-close-guard',
  'smoke:po-receive-after-cancel-guard',
  'smoke:objects:list-pagination',
  'smoke:objects:list-filter-soId',
  'smoke:objects:list-filter-status',
  'smoke:objects:list-filter-itemId',
  'smoke:objects:list-filter-soId-itemId',
  'smoke:movements:filter-by-poLine',
  'smoke:po:vendor-guard:on',
  'smoke:po:vendor-guard:off',
  'smoke:po:emit-events',
  'smoke:objects:pageInfo-present',
  'smoke:epc:resolve',
  'smoke:views:crud',
  'smoke:workspaces:list',
  'smoke:events:enabled-noop',
  'smoke:registrations:crud',
  'smoke:registrations:filters',
  'smoke:resources:crud',
  'smoke:reservations:crud',
  'smoke:reservations:conflicts',
  'smoke:common:pagination',
  'smoke:common:error-shapes'
)

$results = @()
$passed = 0
$failed = 0

Write-Host "=== Sprint III Smoke Sweep ===" -ForegroundColor Cyan
Write-Host "Running $($smokes.Count) smoke tests..." -ForegroundColor Cyan
Write-Host ""

foreach ($smoke in $smokes) {
  Write-Host "[RUN] $smoke" -ForegroundColor Yellow
  
  $output = node ops/smoke/smoke.mjs $smoke 2>&1 | Out-String
  $exitCode = $LASTEXITCODE
  
  # Try to parse JSON result from output
  $result = $null
  try {
    # Extract JSON from output (may have debug logs before JSON)
    $jsonMatch = $output | Select-String -Pattern '(?s)\{.*"test".*\}' -AllMatches
    if ($jsonMatch.Matches.Count -gt 0) {
      $jsonStr = $jsonMatch.Matches[0].Value
      $result = $jsonStr | ConvertFrom-Json
    }
  } catch {
    # JSON parse failed
  }
  
  if ($null -eq $result) {
    # Fallback: check exit code
    if ($exitCode -eq 0) {
      $result = @{ test = $smoke; result = "PASS" }
    } else {
      $result = @{ test = $smoke; result = "FAIL"; reason = "exit-code-$exitCode"; raw = $output }
    }
  }
  
  $results += $result
  
  if ($result.result -eq "PASS") {
    $passed++
    Write-Host "  [PASS] $smoke" -ForegroundColor Green
  } else {
    $failed++
    Write-Host "  [FAIL] $smoke" -ForegroundColor Red
    if ($result.reason) {
      Write-Host "    Reason: $($result.reason)" -ForegroundColor Red
    }
  }
  
  Write-Host ""
}

Write-Host "=== Summary ===" -ForegroundColor Cyan
Write-Host "Total:  $($smokes.Count)" -ForegroundColor White
Write-Host "Passed: $passed" -ForegroundColor Green
Write-Host "Failed: $failed" -ForegroundColor Red
Write-Host ""

# Save results to JSON file
$timestamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
$resultFile = "ops/smoke-sweep-results-$timestamp.json"
$results | ConvertTo-Json -Depth 10 | Set-Content $resultFile
Write-Host "Full results saved to: $resultFile" -ForegroundColor Cyan

# Output failed tests for review
if ($failed -gt 0) {
  Write-Host ""
  Write-Host "=== Failed Tests ===" -ForegroundColor Red
  foreach ($r in $results) {
    if ($r.result -eq "FAIL") {
      Write-Host "  - $($r.test)" -ForegroundColor Red
      if ($r.reason) { Write-Host "    Reason: $($r.reason)" -ForegroundColor Gray }
      if ($r.step) { Write-Host "    Step: $($r.step)" -ForegroundColor Gray }
    }
  }
}

exit $failed
