import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor, within } from 'storybook/test';
import { Trash2 } from 'lucide-react';

import { Button } from './button';
import {
  resolveLiveTokenComputed,
  resolveLiveTokenRgba,
  contrastRatio,
  getEffectiveBackgroundColor,
  hoverWithNoTransition,
  unhoverWithNoTransition,
} from '@storybook-test-utils';

function ButtonGallery() {
  return (
    <div className="space-y-6 rounded-xl bg-surface-raised p-6" data-testid="button-suite">
      <div className="flex flex-wrap items-center gap-3">
        <Button data-testid="btn-default" variant="default">
          Default Accent
        </Button>
        <Button data-testid="btn-secondary" variant="secondary">
          Secondary Surface
        </Button>
        <Button data-testid="btn-ghost" variant="ghost">
          Ghost Neutral
        </Button>
        <Button data-testid="btn-destructive" variant="destructive">
          Destructive Action
        </Button>
        <Button data-testid="btn-disabled" variant="default" disabled>
          Disabled State
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button data-testid="btn-sm" size="sm" variant="secondary">
          Small Size
        </Button>
        <Button data-testid="btn-icon" size="icon" variant="ghost" aria-label="Delete">
          <Trash2 className="size-4" />
        </Button>
      </div>
    </div>
  );
}

const meta: Meta<typeof ButtonGallery> = {
  title: 'Shared/UI/Button',
  component: ButtonGallery,
  parameters: {
    layout: 'padded',
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Variants: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // 1. Default button: filled accent-solid with fg-on-accent text
    const btnDefault = canvas.getByTestId('btn-default');
    const styleDefault = window.getComputedStyle(btnDefault);
    expect(styleDefault.backgroundColor).toBe(resolveLiveTokenComputed('--color-accent-solid'));
    expect(styleDefault.color).toBe(resolveLiveTokenComputed('--color-fg-on-accent'));

    // 2. Secondary button: surface-raised with border and fg-primary
    const btnSecondary = canvas.getByTestId('btn-secondary');
    const styleSecondary = window.getComputedStyle(btnSecondary);
    expect(styleSecondary.backgroundColor).toBe(resolveLiveTokenComputed('--color-surface-raised'));
    expect(styleSecondary.borderColor).toBe(resolveLiveTokenComputed('--color-border'));
    expect(styleSecondary.color).toBe(resolveLiveTokenComputed('--color-fg-primary'));

    // 3. Ghost button: muted text, transparent background
    const btnGhost = canvas.getByTestId('btn-ghost');
    const styleGhost = window.getComputedStyle(btnGhost);
    expect(styleGhost.color).toBe(resolveLiveTokenComputed('--color-fg-muted'));

    // 4. Disabled button: opacity 50%
    const btnDisabled = canvas.getByTestId('btn-disabled');
    const styleDisabled = window.getComputedStyle(btnDisabled);
    expect(styleDisabled.opacity).toBe('0.5');

    // 5. Destructive button: outline with text-action-destructive and hover fill
    const btnDestructive = canvas.getByTestId('btn-destructive');
    const styleDestructive = window.getComputedStyle(btnDestructive);
    expect(styleDestructive.color).toBe(resolveLiveTokenComputed('--color-action-destructive'));

    const destructiveRgba = resolveLiveTokenRgba('--color-action-destructive');
    const fgDestructive: [number, number, number] = [destructiveRgba[0], destructiveRgba[1], destructiveRgba[2]];

    // Default contrast against effective background
    const defaultBg = getEffectiveBackgroundColor(btnDestructive);
    const defaultContrast = contrastRatio(fgDestructive, defaultBg);
    expect(defaultContrast).toBeGreaterThanOrEqual(4.5);

    // Deterministic hover contrast assertion
    await hoverWithNoTransition(btnDestructive);
    await waitFor(() => {
      const currentBg = window.getComputedStyle(btnDestructive).backgroundColor;
      expect(currentBg).not.toBe('transparent');
      expect(currentBg).not.toBe('rgba(0, 0, 0, 0)');
    });
    const hoverBg = getEffectiveBackgroundColor(btnDestructive);
    const hoverContrast = contrastRatio(fgDestructive, hoverBg);
    expect(hoverContrast).toBeGreaterThanOrEqual(4.5);
    await unhoverWithNoTransition(btnDestructive);
  },
};
