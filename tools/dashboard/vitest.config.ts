import { defineConfig } from 'vitest/config';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { playwright } from '@vitest/browser-playwright';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { sharedAliases } from './.storybook/aliases.ts';

const dashboardRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: sharedAliases,
  },
  test: {
    projects: [
      {
        name: 'unit',
        test: {
          include: ['tests/**/*.test.tsx'],
          environment: 'jsdom',
          setupFiles: ['./.storybook/vitest.setup.ts'],
          alias: sharedAliases,
        },
      },
      {
        name: 'storybook',
        plugins: [
          storybookTest({
            configDir: resolve(dashboardRoot, '.storybook'),
          }),
        ],
        test: {
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: 'chromium' }],
          },
          alias: sharedAliases,
        },
      },
    ],
  },
});
