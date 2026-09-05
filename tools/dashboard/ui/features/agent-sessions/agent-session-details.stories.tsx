import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor, within } from 'storybook/test';
import { Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  resolveLiveTokenComputed,
  resolveLiveTokenRgba,
  contrastRatio,
  getEffectiveBackgroundColor,
  hoverWithNoTransition,
  unhoverWithNoTransition,
} from '@storybook-test-utils';

function DeleteSessionDialogScenario() {
  return (
    <div className="max-w-md rounded-2xl bg-surface-raised p-6" data-testid="delete-session-wrapper">
      <div className="space-y-3 border-t border-border pt-4">
        <h3 className="text-xs font-bold tracking-wider text-action-destructive uppercase">Strefa niebezpieczna</h3>
        <div
          data-testid="delete-session-card"
          className="space-y-3 rounded-xl border border-action-destructive/30 bg-surface p-4"
        >
          <div>
            <p className="text-xs font-semibold text-fg-primary">Usuń sesję</p>
            <p className="mt-0.5 text-[11px] text-fg-muted">
              Usuwa historię sesji i powiązania z dysku lokalnego. Tej operacji nie można cofnąć.
            </p>
          </div>
          <Button data-testid="delete-session-btn" variant="destructive" className="w-full justify-center">
            <Trash2 className="mr-2 size-3.5" />
            Usuń sesję z dysku
          </Button>
        </div>
      </div>
    </div>
  );
}

const meta: Meta<typeof DeleteSessionDialogScenario> = {
  title: 'Features/AgentSessions/Details',
  component: DeleteSessionDialogScenario,
  parameters: {
    layout: 'padded',
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const DeleteSessionContext: Story = {
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
