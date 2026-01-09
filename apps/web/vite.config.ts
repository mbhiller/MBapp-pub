import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '../..');

// API proxy target (read from env, fallback to AWS nonprod gateway)
const apiTarget = process.env.VITE_API_PROXY_TARGET || 'https://ki8kgivz1f.execute-api.us-east-1.amazonaws.com';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      '@mbapp/scan': resolve(repoRoot, 'packages/mbapp-scan/src/index.ts'),
      '@mbapp/scan/': resolve(repoRoot, 'packages/mbapp-scan/src/'),
    },
  },
  server: {
    proxy: {
      // Proxy /api/* -> API Gateway (eliminates CORS preflight during local dev)
      '/api': {
        target: apiTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
        configure: (proxy, _options) => {
          proxy.on('error', (err, _req, _res) => {
            console.log('[vite proxy] error:', err);
          });
          proxy.on('proxyReq', (proxyReq, req, _res) => {
            console.log('[vite proxy]', req.method, req.url, '->', proxyReq.path);
          });
        },
      },
    },
  },
});
