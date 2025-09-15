# Reset-NodeDeps-And-Deploy.ps1
# Cleans node_modules/ caches for apps/api & apps/mobile, reinstalls, typechecks, rebuilds,
# zips Lambda, and (optionally) deploys. Safe to run repeatedly.
# Requirements: PowerShell 7+, git, Node 20+, npm, AWS CLI v2 (profile configured).

$ErrorActionPreference = "Stop"
$Repo       = "C:\Users\bryan\MBapp-pub"    # per your note
$AwsProfile = "mbapp-nonprod-admin"
$AwsRegion  = "us-east-1"
$LambdaName = "mbapp-nonprod-objects"

function Say($m,$c="Cyan"){ Write-Host $m -ForegroundColor $c }
function Ensure-Tool($t,$h){ if(!(Get-Command $t -Ea SilentlyContinue)){ throw "Missing '$t'. $h" } }

Ensure-Tool node "Install Node.js 20.x and retry."
Ensure-Tool npm  "npm should be on PATH."
Ensure-Tool git  "Install Git and retry."
Ensure-Tool aws  "Install AWS CLI v2 and run 'aws configure sso' for $AwsProfile."

Set-Location $Repo
git rev-parse --abbrev-ref HEAD | Out-Null
Say "Repo: $Repo  |  Branch: $(git rev-parse --abbrev-ref HEAD)"

function CleanNode($p){
  if(!(Test-Path $p)){ return }
  Push-Location $p
  Say "Cleaning $p"
  # Common build outputs & caches
  Remove-Item node_modules,.expo,.cache,.turbo,dist,build,out,dist.zip -Recurse -Force -Ea SilentlyContinue
  # Lockfiles (we'll prefer npm install unless a lockfile exists)
  Remove-Item yarn.lock,pnpm-lock.yaml -Force -Ea SilentlyContinue
  # Metro cache (mobile)
  Remove-Item .\metro-cache -Recurse -Force -Ea SilentlyContinue
  npm cache verify | Out-Null
  Pop-Location
}

function SmartInstall($p){
  Push-Location $p
  if(Test-Path package-lock.json){
    Say "Installing with npm ci in $p"
    npm ci
  } else {
    Say "Installing with npm install in $p"
    npm install
  }
  Pop-Location
}

# --- API ---
$Api = Join-Path $Repo "apps\api"
CleanNode $Api
SmartInstall $Api

# Ensure AWS SDK v3 + TS toolchain present
Push-Location $Api
npm i @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb @aws-sdk/util-dynamodb
npm i -D esbuild typescript @types/node

Say "Typechecking API (no emit)…"
if (Test-Path .\tsconfig.json) { npx tsc --noEmit }

Say "Building API…"
npm run build
if (!(Test-Path .\dist\index.js)) { throw "Build missing dist\index.js" }
if (Test-Path .\dist.zip) { Remove-Item .\dist.zip -Force }
Push-Location .\dist
Compress-Archive -Path .\index.js -DestinationPath ..\dist.zip -Force
Pop-Location
Pop-Location

# --- MOBILE ---
$Mobile = Join-Path $Repo "apps\mobile"
CleanNode $Mobile
SmartInstall $Mobile
Push-Location $Mobile

# Align Expo-native deps (no-op if not needed)
try { npx expo install } catch { Say "expo install skipped (not needed?)" "Yellow" }

Say "Typechecking Mobile (no emit)…"
if (Test-Path .\tsconfig.json) { npx tsc --noEmit }

Pop-Location

# --- OPTIONAL: Deploy Lambda (uncomment to deploy automatically) ---
#Push-Location $Api
#Say "Deploying Lambda $LambdaName…"
#aws sts get-caller-identity --profile $AwsProfile | Out-Null
#aws lambda update-function-code `
#  --function-name $LambdaName `
#  --zip-file fileb://dist.zip `
#  --region $AwsRegion `
#  --profile $AwsProfile | Out-Null
#aws lambda wait function-updated `
#  --function-name $LambdaName `
#  --region $AwsRegion `
#  --profile $AwsProfile
#Say "Lambda updated." "Green"
#Pop-Location

Say "✅ Reset complete. Next:"
Say " - Mobile:  cd $Mobile ; npx expo start -c" "Gray"
Say " - API smoke: use your existing Invoke-RestMethod calls" "Gray"
