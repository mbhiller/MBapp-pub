# Revert-EventsReg-Deploy.ps1
$ErrorActionPreference = "Stop"

$Repo        = "C:\Users\bryan\MBapp-pub"
$Branch      = "feat/events-registration"
$AwsProfile  = "mbapp-nonprod-admin"
$AwsRegion   = "us-east-1"
$LambdaName  = "mbapp-nonprod-objects"

function Say($m,$c="Cyan"){Write-Host $m -ForegroundColor $c}
function Ensure-Tool($t,$h){if(!(Get-Command $t -Ea SilentlyContinue)){throw "Missing '$t'. $h"}}

Ensure-Tool git  "Install Git and retry."
Ensure-Tool node "Install Node.js 20.x and retry."
Ensure-Tool npm  "npm should be on PATH."
Ensure-Tool aws  "Install AWS CLI v2 and configure SSO for $AwsProfile."

aws sts get-caller-identity --profile $AwsProfile | Out-Null

Set-Location $Repo
Say "Fetching + switching to $Branch"
git fetch origin --prune | Out-Null
if (git status --porcelain) { git stash push -u -m "auto-stash $(Get-Date -Format s)" | Out-Null }
if (git show-ref --verify --quiet "refs/heads/$Branch") { git switch $Branch } else { git switch -c $Branch --track origin/$Branch }
git reset --hard origin/$Branch

function CleanNode($p){
  if(!(Test-Path $p)){return}
  Push-Location $p
  Say "Cleaning $p"
  Remove-Item node_modules,.expo,.cache,.turbo,dist,build,out,package-lock.json,yarn.lock,pnpm-lock.yaml,tsconfig.tsbuildinfo,dist.zip -Recurse -Force -Ea SilentlyContinue
  npm cache verify | Out-Null
  Pop-Location
}
function NpmInstall($p){ Push-Location $p; Say "Installing deps in $p"; npm install; Pop-Location }

# API: clean, install, ensure AWS SDK v3, build, zip (index.js at zip root), deploy
$Api = Join-Path $Repo "apps\api"
CleanNode $Api
NpmInstall $Api
Push-Location $Api
npm i @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb @aws-sdk/util-dynamodb
npm i -D esbuild typescript @types/node

Say "Typechecking API (no emit)…"
if (Test-Path .\tsconfig.json) { npx tsc --noEmit }

Say "Building API…"
npm run build

if (!(Test-Path .\dist\index.js)) { throw "Build missing dist\index.js" }
if (Test-Path .\dist.zip) { Remove-Item .\dist.zip -Force }

# Zip so index.js is at the ZIP ROOT (for handler index.handler)
Push-Location .\dist
Compress-Archive -Path .\index.js -DestinationPath ..\dist.zip -Force
Pop-Location

Say "Deploying Lambda $LambdaName…"
aws lambda update-function-code `
  --function-name $LambdaName `
  --zip-file fileb://dist.zip `
  --region $AwsRegion `
  --profile $AwsProfile | Out-Null

aws lambda wait function-updated `
  --function-name $LambdaName `
  --region $AwsRegion `
  --profile $AwsProfile
Say "Lambda updated." "Green"
Pop-Location

# Mobile: clean, install, expo align
$Mobile = Join-Path $Repo "apps\mobile"
CleanNode $Mobile
NpmInstall $Mobile
Push-Location $Mobile
try { npx expo install } catch { Say "expo install skipped or not needed." "Yellow" }
Pop-Location

Say "✅ Done. Branch: $Branch | Lambda: $LambdaName"
Say "Mobile tip: npx expo start -c" "Gray"
