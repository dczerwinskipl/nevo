import type { Preview } from '@storybook/react-vite';
import { themes } from 'storybook/theming';
import '../ui/index.css';

const preview: Preview = {
  parameters: {
    docs: {
      theme: themes.dark,
    },
    layout: 'fullscreen',
  },
};

export default preview;
