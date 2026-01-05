# API Gateway CORS Configuration

**API Gateway ID:** `ki8kgivz1f`  
**Region:** us-east-1  
**Type:** HTTP API (API Gateway v2)

## Current Configuration

The API Gateway for MBapp is managed outside of Terraform (created manually via AWS Console or separate IaC). The gateway ID is referenced in Terraform via the `http_api_id` variable but the gateway itself is not managed by this codebase.

## Required CORS Configuration

### Gateway-Level CORS Settings

To ensure OPTIONS preflight requests are handled efficiently at the gateway level (before Lambda invocation):

1. **Navigate to API Gateway Console:**
   - Service: API Gateway
   - Select HTTP API: `ki8kgivz1f`
   - Go to: **CORS** settings

2. **Configure CORS:**
   ```
   Access-Control-Allow-Origin: *
   Access-Control-Allow-Headers: *
   Access-Control-Allow-Methods: GET,POST,OPTIONS,PUT,DELETE
   Access-Control-Max-Age: 600
   ```

3. **Enable Automatic OPTIONS:**
   - HTTP APIs (v2) automatically handle OPTIONS when CORS is configured
   - This bypasses Lambda invocation for preflight requests
   - Reduces latency and cost for CORS preflight

### Route-Level Authorization Bypass

**Current State:** The API Gateway likely has a default authorizer attached to all routes.

**Recommended Configuration:**

For optimal performance, OPTIONS requests should NOT invoke the authorizer:

1. **Navigate to:** Routes → ANY `/{proxy+}` (or your catch-all route)
2. **Authorization settings:**
   - Ensure OPTIONS method does NOT require authorization
   - If using a default authorizer, add an override for OPTIONS to use "NONE"

**Alternative (if routes are individually defined):**

For each route (e.g., `/objects/{type}/{id}`):
- Method: OPTIONS
- Authorization: NONE
- Integration: MOCK (returns 204 immediately) or Lambda (if CORS headers in Lambda are preferred)

### Lambda-Level CORS (Current Implementation)

**Location:** [apps/api/src/index.ts](../apps/api/src/index.ts#L128-L141)

The Lambda handler includes a fast-path CORS implementation that returns immediately for OPTIONS requests:

```typescript
export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  try {
    if (isPreflight(event)) return corsOk(); // Line 238 - BEFORE auth
    
    // ... rest of handler (auth, routing, etc.)
  }
}
```

**CORS Response:**
- Status: 204 No Content
- Headers:
  - `Access-Control-Allow-Origin: *`
  - `Access-Control-Allow-Methods: GET,POST,OPTIONS,PUT,DELETE`
  - `Access-Control-Allow-Headers: *`
  - `Access-Control-Max-Age: 600`

## Verification

### 1. Gateway-Level CORS Check

Using AWS CLI:
```powershell
aws apigatewayv2 get-api --api-id ki8kgivz1f --region us-east-1 --query 'CorsConfiguration'
```

Expected output:
```json
{
  "AllowOrigins": ["*"],
  "AllowMethods": ["GET", "POST", "OPTIONS", "PUT", "DELETE"],
  "AllowHeaders": ["*"],
  "MaxAge": 600
}
```

### 2. End-to-End Preflight Test

Using PowerShell:
```powershell
Invoke-WebRequest -Method OPTIONS `
  -Uri "https://ki8kgivz1f.execute-api.us-east-1.amazonaws.com/objects/party/test123" `
  -Headers @{
    "Origin" = "http://localhost:5173"
    "Access-Control-Request-Method" = "GET"
    "Access-Control-Request-Headers" = "authorization,x-tenant-id"
  }
```

Expected response:
- Status: 204 (or 200)
- Headers include:
  - `access-control-allow-origin: *`
  - `access-control-allow-methods: GET,POST,OPTIONS,PUT,DELETE`
  - `access-control-allow-headers: *`
  - `access-control-max-age: 600`

### 3. Smoke Test

Run the automated smoke test:
```bash
node ops/smoke/smoke.mjs smoke:cors:preflight-objects-detail
```

This test validates:
- OPTIONS requests return 200/204
- All required CORS headers are present
- No authentication is required

## Troubleshooting

### OPTIONS Returns 403 Forbidden

**Cause:** Authorizer is invoked for OPTIONS requests  
**Solution:** Update route authorization to NONE for OPTIONS method

### OPTIONS Returns 503 Under Load

**Cause:** Lambda cold starts or throttling during burst traffic  
**Solution:** 
1. Configure gateway-level CORS (automatic OPTIONS handling)
2. Enable Lambda reserved concurrency if needed

### Missing CORS Headers

**Cause:** Gateway CORS not configured or Lambda preflight guard not triggered  
**Solution:** 
1. Verify gateway CORS configuration
2. Check Lambda logs to ensure `isPreflight()` is returning true

## Best Practices

1. **Gateway-Level First:** Configure CORS at the API Gateway level for best performance
2. **Lambda Fallback:** Keep Lambda CORS implementation as a safety net
3. **Monitor OPTIONS:** Track OPTIONS request metrics to ensure proper gateway handling
4. **Max-Age:** 600 seconds (10 minutes) reduces preflight frequency for same origin/headers

## Related Documentation

- Lambda CORS Implementation: [apps/api/src/index.ts](../apps/api/src/index.ts#L128-L141)
- CORS Smoke Test: [ops/smoke/smoke.mjs](../ops/smoke/smoke.mjs) - `smoke:cors:preflight-objects-detail`
- Spec Delta: [docs/spec-implementation-delta.md](../docs/spec-implementation-delta.md#L394-L407)

## Manual Configuration Checklist

Since the API Gateway is not managed by Terraform, use this checklist for manual updates:

- [ ] Gateway CORS configured (Allow-Origin: *, Allow-Methods: GET,POST,OPTIONS,PUT,DELETE, Allow-Headers: *, Max-Age: 600)
- [ ] OPTIONS routes do NOT require authorization
- [ ] Lambda preflight guard tested (smoke test passes)
- [ ] CloudWatch metrics show OPTIONS requests NOT invoking Lambda (if gateway CORS enabled)
- [ ] Preflight latency < 50ms (gateway-level handling)
- [ ] No 503 errors during burst traffic

---

**Last Updated:** 2026-01-05  
**Configuration Owner:** Infrastructure/DevOps Team  
**Gateway ID:** ki8kgivz1f (nonprod)
