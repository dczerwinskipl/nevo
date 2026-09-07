import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';

import { LoadingScreen } from './loading-screen';

const meta: Meta<typeof LoadingScreen> = {
  title: 'Shared/UI/LoadingScreen',
  component: LoadingScreen,
  parameters: {
    layout: 'padded',
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvasElement.querySelector('.animate-pulse')).not.toBeNull();
  },
};
