import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';

import { Card } from './card';
import { resolveLiveTokenComputed } from '@storybook-test-utils';

function CardGallery() {
  return (
    <div className="max-w-md space-y-4 p-4">
      <Card data-testid="test-card" className="p-4">
        <p className="text-fg-primary">Card Surface Content</p>
        <p className="text-xs text-fg-muted">Subtext inside card</p>
      </Card>
    </div>
  );
}

const meta: Meta<typeof Card> = {
  title: 'Shared/UI/Card',
  component: Card,
  parameters: {
    layout: 'padded',
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => <CardGallery />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const card = canvas.getByTestId('test-card');
    const cardStyle = window.getComputedStyle(card);
    expect(cardStyle.backgroundColor).toBe(resolveLiveTokenComputed('--color-surface'));
    expect(cardStyle.borderColor).toBe(resolveLiveTokenComputed('--color-border'));
  },
};
