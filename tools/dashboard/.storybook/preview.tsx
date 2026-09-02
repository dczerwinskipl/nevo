import type { Preview } from '@storybook/react';
import { create } from 'storybook/theming';
import '../ui/index.css';

const darkDocsTheme = create({
  base: 'dark',
  appBg: '#090a0d',
  appContentBg: '#090a0d',
  appPreviewBg: '#090a0d',
  barBg: '#0f1116',
  textColor: '#f1f3f5',
  textMutedColor: '#929baa',
  colorPrimary: '#3882f6',
  colorSecondary: '#3882f6',
});

const preview: Preview = {
  parameters: {
    backgrounds: {
      disable: true,
      default: 'dark',
      values: [
        { name: 'dark', value: '#090a0d' },
      ],
    },
    docs: {
      theme: darkDocsTheme,
    },
    layout: 'fullscreen',
  },
};

export default preview;
