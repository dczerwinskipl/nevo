import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { TanStackRouterVite } from '@tanstack/router-plugin/vite';
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const dashboardRoot = fileURLToPath(new URL('.', import.meta.url));
const uiRoot = resolve(dashboardRoot, 'ui');

export default defineConfig({
  root: uiRoot,
  plugins: [
    TanStackRouterVite({
      routesDirectory: resolve(uiRoot, 'routes'),
      generatedRouteTree: resolve(uiRoot, 'routeTree.gen.ts'),
      target: 'react',
      autoCodeSplitting: false,
      addExtensions: true,
    }),
    react(),
    tailwindcss(),
  ],
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
    outDir: resolve(dashboardRoot, 'dist'),
    emptyOutDir: true,
    sourcemap: true,
  },
});
