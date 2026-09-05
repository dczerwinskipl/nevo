import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor, within } from 'storybook/test';
import { AgentSessionDetails } from './agent-session-details';
import {
  resolveLiveTokenComputed,
  resolveLiveTokenRgba,
  contrastRatio,
  getEffectiveBackgroundColor,
  hoverWithNoTransition,
  unhoverWithNoTransition,
} from '@storybook-test-utils';

const meta: Meta<typeof AgentSessionDetails> = {
  title: 'Features/Agent Sessions/Agent Session Details',
  component: AgentSessionDetails,
  parameters: {
    layout: 'padded',
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const DeleteSessionContext: Story = {
  render: () => (
    <div className="max-w-md rounded-2xl bg-surface-raised p-6" data-testid="delete-session-wrapper">
      <AgentSessionDetails
        specTitle="Semantic Color Tokens"
        provider="claude"
        mode="edit"
        tasks={['07-specs-lanes-and-remaining-ui']}
        onDelete={() => {}}
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const btn = canvas.getByTestId('delete-session-btn');
    const styleBtn = window.getComputedStyle(btn);
    expect(styleBtn.color).toBe(resolveLiveTokenComputed('--color-action-destructive'));

    const destructiveRgba = resolveLiveTokenRgba('--color-action-destructive');
    const fgDestructive: [number, number, number] = [destructiveRgba[0], destructiveRgba[1], destructiveRgba[2]];

    // Default state contrast in realistic delete-session container
    const defaultBg = getEffectiveBackgroundColor(btn);
    const defaultContrast = contrastRatio(fgDestructive, defaultBg);
    expect(defaultContrast).toBeGreaterThanOrEqual(4.5);

    // Deterministic hover state contrast in realistic container
    await hoverWithNoTransition(btn);
    await waitFor(() => {
      const currentBg = window.getComputedStyle(btn).backgroundColor;
      expect(currentBg).not.toBe('transparent');
      expect(currentBg).not.toBe('rgba(0, 0, 0, 0)');
    });
    const hoverBg = getEffectiveBackgroundColor(btn);
    const hoverContrast = contrastRatio(fgDestructive, hoverBg);
    expect(hoverContrast).toBeGreaterThanOrEqual(4.5);
    await unhoverWithNoTransition(btn);
  },
};
