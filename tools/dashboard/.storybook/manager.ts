import { addons } from 'storybook/manager-api';
import { create } from 'storybook/theming';

const darkTheme = create({
  base: 'dark',
  appBg: '#090a0d',
  appContentBg: '#090a0d',
  appPreviewBg: '#090a0d',
  barBg: '#0f1116',
  textColor: '#f1f3f5',
  textMutedColor: '#929baa',
  colorPrimary: '#3882f6',
  colorSecondary: '#3882f6',
  brandTitle: 'NEvo AI Storybook',
});

addons.setConfig({
  theme: darkTheme,
});
