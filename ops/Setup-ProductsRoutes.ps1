param([string]$Profile="mbapp-nonprod-admin",[string]$Region="us-east-1",[string]$ApiId="ki8kgivz1f",[string]$IntegrationId="tdnoorp",[switch]$EnsureAutoDeploy=$true)
$ErrorActionPreference="Stop"
function Get-Routes(){ aws apigatewayv2 get-routes --api-id $ApiId --region $Region --profile $Profile | ConvertFrom-Json }
function Ensure-Route($k,$t){ $r=Get-Routes; $ex=$r.Items|?{ $_.RouteKey -eq $k }; if($null -eq $ex){ aws apigatewayv2 create-route --api-id $ApiId --region $Region --profile $Profile --route-key "$k" --target "$t" | Out-Null } elseif($ex.Target -ne $t){ aws apigatewayv2 update-route --api-id $ApiId --region $Region --profile $Profile --route-id $ex.RouteId --target "$t" | Out-Null } }
if($EnsureAutoDeploy){ aws apigatewayv2 update-stage --api-id $ApiId --region $Region --profile $Profile --stage-name '$default' --auto-deploy | Out-Null }
$t="integrations/$IntegrationId"
Ensure-Route "POST /products" $t; Ensure-Route "PUT /products/{id}" $t; Ensure-Route "GET /products/{id}" $t; Ensure-Route "GET /products" $t
(Get-Routes).Items | Select RouteKey,Target | Sort RouteKey | ft -Auto
