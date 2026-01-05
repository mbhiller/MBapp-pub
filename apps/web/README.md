# MBapp Web Portal

React web application for the MBapp inventory management system.

## Quick Start

```bash
cd apps/web
npm install
npm run dev
```

Open http://localhost:5173

## Environment Configuration

Copy `.env.sample` to `.env` and configure:

### Local Development (Recommended - No CORS Preflight)

Use the Vite dev proxy to eliminate CORS preflight requests:

```bash
# .env
VITE_API_BASE=/api
VITE_API_PROXY_TARGET=https://ki8kgivz1f.execute-api.us-east-1.amazonaws.com
VITE_TENANT=DemoTenant
```

**How it works:**
- Vite dev server proxies `/api/*` → API Gateway
- Browser makes same-origin requests (no CORS preflight)
- All OPTIONS requests eliminated during local dev
- Faster dev experience, cleaner network logs

### Production / Direct API Mode

For testing direct API calls (with CORS):

```bash
# .env
VITE_API_BASE=https://ki8kgivz1f.execute-api.us-east-1.amazonaws.com
VITE_TENANT=DemoTenant
```

**Note:** This triggers CORS preflight (OPTIONS) for cross-origin requests.

## API Configuration Reference

| Variable | Description | Default |
|----------|-------------|---------|
| `VITE_API_BASE` | API endpoint URL. Use `/api` for local proxy, or full `https://...` URL for direct calls | Required |
| `VITE_API_PROXY_TARGET` | Proxy target (only used when `VITE_API_BASE=/api`) | `https://ki8kgivz1f.execute-api.us-east-1.amazonaws.com` |
| `VITE_TENANT` | Tenant ID sent as `x-tenant-id` header | `DemoTenant` |
| `VITE_BEARER` | Optional JWT token for dev auth (leave blank in prod) | (empty) |

## Development

### Run Dev Server

```bash
npm run dev
```

Starts Vite dev server on http://localhost:5173 with:
- Hot module replacement (HMR)
- API proxy (if `VITE_API_BASE=/api`)
- TypeScript type checking

### Build for Production

```bash
npm run build
```

Outputs to `dist/` directory.

### Preview Production Build

```bash
npm run preview
```

Serves the production build locally for testing.

### Type Check

```bash
npm run typecheck
```

## Vite Proxy Configuration

The Vite dev server includes a proxy that rewrites `/api/*` requests to the API Gateway:

```typescript
// vite.config.ts
server: {
  proxy: {
    '/api': {
      target: 'https://ki8kgivz1f.execute-api.us-east-1.amazonaws.com',
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/api/, ''),
    }
  }
}
```

**Example Request Flow:**

1. Frontend: `fetch('/api/objects/party?limit=10')`
2. Vite proxy: Rewrites to `https://ki8kgivz1f.../objects/party?limit=10`
3. Browser: Same-origin request (no preflight)
4. API Gateway: Returns response

**Benefits:**
- ✅ Zero CORS preflight requests during dev
- ✅ Faster dev server response times
- ✅ Cleaner browser network logs
- ✅ Identical to production API behavior

## Verifying CORS Elimination

With proxy enabled (`VITE_API_BASE=/api`):

1. Start dev server: `npm run dev`
2. Open http://localhost:5173
3. Open browser DevTools → Network tab
4. Navigate to any page (e.g., Parties, Products)
5. ✅ **No OPTIONS requests** should appear
6. All requests show as same-origin (`localhost:5173`)

Without proxy (direct API):

1. Set `VITE_API_BASE=https://ki8kgivz1f...` in `.env`
2. Restart dev server
3. Navigate to any page
4. ❌ **OPTIONS requests appear** before each GET/POST/PUT/DELETE

## Troubleshooting

### "Missing VITE_API_BASE" Error

**Cause:** `VITE_API_BASE` not set in `.env`

**Solution:**
```bash
cp .env.sample .env
# Edit .env and set VITE_API_BASE=/api
```

### Proxy Not Working

**Symptoms:** Still seeing OPTIONS requests, or 404 errors

**Solutions:**
1. Verify `.env` has `VITE_API_BASE=/api` (not full URL)
2. Restart Vite dev server after changing `.env`
3. Check `VITE_API_PROXY_TARGET` is set correctly
4. Check Vite console for proxy errors

### API Returns 403 Forbidden

**Cause:** Missing or invalid tenant ID / JWT token

**Solution:**
1. Verify `VITE_TENANT` matches your tenant in DynamoDB
2. Use `/auth/dev-login` to get a valid token (if DEV_LOGIN_ENABLED)
3. Set `VITE_BEARER` to the acquired token

## Project Structure

```
apps/web/
├── src/
│   ├── components/     # Reusable React components
│   ├── lib/           # API client, utilities
│   ├── pages/         # Route pages
│   ├── providers/     # Context providers (Auth, etc.)
│   └── App.tsx        # Root component
├── .env               # Local environment config (gitignored)
├── .env.sample        # Environment template
├── vite.config.ts     # Vite configuration (includes proxy)
└── package.json
```

## Related Documentation

- **API CORS Configuration:** [infra/API_GATEWAY_CORS_CONFIG.md](../../infra/API_GATEWAY_CORS_CONFIG.md)
- **Backend Guide:** [docs/MBapp-Backend-Guide.md](../../docs/MBapp-Backend-Guide.md)
- **Frontend Guide:** [docs/MBapp-Frontend-Guide.md](../../docs/MBapp-Frontend-Guide.md)

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start Vite dev server with HMR + proxy |
| `npm run build` | Build for production (outputs to `dist/`) |
| `npm run preview` | Preview production build locally |
| `npm run typecheck` | Run TypeScript type checking |
| `npm run lint` | Run ESLint (if configured) |

---

**Last Updated:** 2026-01-05
