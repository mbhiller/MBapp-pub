param([string]$FunctionName="mbapp-nonprod-objects",[string]$Region="us-east-1",[string]$Profile="mbapp-nonprod-admin",[switch]$SkipInstall)
$ErrorActionPreference="Stop"
function Info($m){Write-Host $m -ForegroundColor Cyan} function Ok($m){Write-Host $m -ForegroundColor Green} function Die($m){throw $m}
$scriptDir=Split-Path -Parent $PSCommandPath; $repoRoot=Split-Path -Parent $scriptDir; $apiDir=Join-Path $repoRoot "apps\api"
if(!(Test-Path $apiDir)){Die "apps\api not found"}; Set-Location $apiDir
if(-not $SkipInstall){Info "npm ci"; npm ci}
if(Test-Path .\dist){Remove-Item .\dist -Recurse -Force}; New-Item .\dist -ItemType Directory | Out-Null
Info "esbuild src/index.ts -> dist/index.js"; npx --yes esbuild .\src\index.ts --bundle --platform=node --target=node20 --format=cjs --outfile=.\dist\index.js
if(!(Test-Path .\dist\index.js)){Die "dist/index.js missing"}
Info "npm prune --omit=dev"; npm prune --omit=dev
$stage=Join-Path $apiDir "bundle"; if(Test-Path $stage){Remove-Item $stage -Recurse -Force}; New-Item $stage -ItemType Directory | Out-Null
Copy-Item -Recurse dist $stage\dist; Copy-Item -Recurse node_modules $stage\node_modules; Copy-Item package.json $stage\package.json -ErrorAction SilentlyContinue
$zip=Join-Path $apiDir "mbapp-api.zip"; if(Test-Path $zip){Remove-Item $zip -Force}; Info "zip $zip"; Compress-Archive -Path "$stage\*" -DestinationPath $zip
Info "Upload $FunctionName"; $u=@("lambda","update-function-code","--function-name",$FunctionName,"--zip-file","fileb://$zip","--region",$Region); if($Profile){$u+="--profile",$Profile}; aws @u | Out-Null
$cfg=aws lambda get-function-configuration --function-name $FunctionName --region $Region --profile $Profile | ConvertFrom-Json
if($cfg.Handler -ne "dist/index.handler"){ aws lambda update-function-configuration --function-name $FunctionName --handler dist/index.handler --region $Region --profile $Profile | Out-Null }
$cfg=aws lambda get-function-configuration --function-name $FunctionName --region $Region --profile $Profile | ConvertFrom-Json
Ok ("Handler {0}  LastModified {1}" -f $cfg.Handler,$cfg.LastModified)
