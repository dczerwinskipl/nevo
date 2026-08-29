import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const dashboardRoot = fileURLToPath(new URL('.', import.meta.url));
const uiRoot = resolve(dashboardRoot, 'ui');

export default defineConfig({
  root: uiRoot,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': uiRoot,
    },
  },
  server: {
    host: process.env.NEVO_DASHBOARD_HOST || '127.0.0.1',
    port: Number(process.env.NEVO_DASHBOARD_PORT || 4317),
    strictPort: true,
    proxy: {
      '/api': {
        target: process.env.NEVO_DASHBOARD_API_URL || 'http://127.0.0.1:4318',
        changeOrigin: false,
      },
    },
  },
  build: {
    // `root` is now `ui/` — outDir must be given relative to the dashboard
    // package root explicitly (an absolute path), otherwise Vite would
    // resolve the default `'dist'` relative to `ui/` and nest the build
    // output at `ui/dist` instead of the package-level `dist/` the
    // production server (index.mjs) actually serves.
    outDir: resolve(dashboardRoot, 'dist'),
    emptyOutDir: true,
    sourcemap: true,
  },
});
