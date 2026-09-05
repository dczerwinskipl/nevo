import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';

import { Badge } from './badge';
import { resolveLiveTokenComputed } from '@storybook-test-utils';

function BadgeGallery() {
  return (
    <div className="space-y-4 p-4">
      <Badge data-testid="test-badge">Status Token</Badge>
    </div>
  );
}

const meta: Meta<typeof BadgeGallery> = {
  title: 'Shared/UI/Badge',
  component: BadgeGallery,
  parameters: {
    layout: 'padded',
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const badge = canvas.getByTestId('test-badge');
    const badgeStyle = window.getComputedStyle(badge);
    expect(badgeStyle.color).toBe(resolveLiveTokenComputed('--color-fg-muted'));
    expect(badgeStyle.backgroundColor).toBe(resolveLiveTokenComputed('--color-surface-raised'));
    expect(badgeStyle.borderColor).toBe(resolveLiveTokenComputed('--color-border'));
  },
};
