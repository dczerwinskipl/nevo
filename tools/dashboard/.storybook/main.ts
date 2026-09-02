import type { StorybookConfig } from '@storybook/react-vite';
import { mergeConfig } from 'vite';
import { sharedAliases, tailwindcss } from '../vite.config.ts';

const config: StorybookConfig = {
  stories: [
    '../ui/**/*.stories.@(js|jsx|mjs|ts|tsx)',
  ],
  addons: [
    '@storybook/addon-docs',
  ],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
  async viteFinal(config) {
    return mergeConfig(config, {
      resolve: {
        alias: sharedAliases,
      },
      plugins: [
        tailwindcss(),
      ],
    });
  },
};

export default config;
