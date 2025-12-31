import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '../..');

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@mbapp/scan': resolve(repoRoot, 'packages/mbapp-scan/src/index.ts'),
      '@mbapp/scan/': resolve(repoRoot, 'packages/mbapp-scan/src/'),
    },
  },
});
