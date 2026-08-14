import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
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
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
});
