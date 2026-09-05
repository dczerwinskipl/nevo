import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor, within } from 'storybook/test';

import { StatusCard, RetryButton } from './status-card';
import {
  resolveLiveTokenComputed,
  resolveLiveTokenRgba,
  parseCssColor,
  contrastRatio,
  getEffectiveBackgroundColor,
  hoverWithNoTransition,
  unhoverWithNoTransition,
} from '@storybook-test-utils';

function StatusCardGallery() {
  return (
    <div className="max-w-xl space-y-4 p-4">
      <StatusCard
        variant="error"
        title="Błąd połączenia"
        description="Wystąpił problem z komunikacją z serwerem."
        onRetry={() => {}}
        data-testid="card-error"
      />
      <StatusCard
        variant="warning"
        title="Ostrzeżenie"
        description="Zasób wymaga uwagi."
        size="sm"
        data-testid="card-warning"
      />
      <StatusCard
        variant="info"
        title="Informacja"
        description="Aktualizacja zakończona pomyślnie."
        data-testid="card-info"
      />
      <div className="flex items-center gap-3 rounded-xl bg-surface p-4">
        <RetryButton data-testid="retry-btn-icon" size="icon" />
        <RetryButton data-testid="retry-btn-loading" loading label="Odświeżanie" />
      </div>
    </div>
  );
}

const meta: Meta<typeof StatusCardGallery> = {
  title: 'Components/UI/StatusCard',
  component: StatusCardGallery,
  parameters: {
    layout: 'padded',
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Variants: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // 1. Error variant assertions
    const cardError = canvas.getByTestId('card-error');
    const styleError = window.getComputedStyle(cardError);
    expect(styleError.color).toBe(resolveLiveTokenComputed('--color-status-error'));
    const errorRgb = resolveLiveTokenRgba('--color-status-error');
    const errorBg = parseCssColor(styleError.backgroundColor);
    expect(errorBg[3]).toBeCloseTo(0.05, 2);
    expect([errorBg[0], errorBg[1], errorBg[2]]).toEqual([errorRgb[0], errorRgb[1], errorRgb[2]]);
    const errorBorder = parseCssColor(styleError.borderColor);
    expect(errorBorder[3]).toBeCloseTo(0.25, 2);
    expect([errorBorder[0], errorBorder[1], errorBorder[2]]).toEqual([errorRgb[0], errorRgb[1], errorRgb[2]]);

    const errorIconBadge = cardError.querySelector('.shrink-0.rounded-lg') as HTMLElement;
    expect(errorIconBadge).not.toBeNull();
    const errorIconStyle = window.getComputedStyle(errorIconBadge);
    expect(errorIconStyle.color).toBe(resolveLiveTokenComputed('--color-status-error'));
    const errorIconBg = parseCssColor(errorIconStyle.backgroundColor);
    expect(errorIconBg[3]).toBeCloseTo(0.1, 2);
    expect([errorIconBg[0], errorIconBg[1], errorIconBg[2]]).toEqual([errorRgb[0], errorRgb[1], errorRgb[2]]);

    // 2. Warning variant assertions
    const cardWarning = canvas.getByTestId('card-warning');
    const styleWarning = window.getComputedStyle(cardWarning);
    expect(styleWarning.color).toBe(resolveLiveTokenComputed('--color-status-warning'));
    const warningRgb = resolveLiveTokenRgba('--color-status-warning');
    const warningBg = parseCssColor(styleWarning.backgroundColor);
    expect(warningBg[3]).toBeCloseTo(0.05, 2);
    expect([warningBg[0], warningBg[1], warningBg[2]]).toEqual([warningRgb[0], warningRgb[1], warningRgb[2]]);
    const warningBorder = parseCssColor(styleWarning.borderColor);
    expect(warningBorder[3]).toBeCloseTo(0.25, 2);
    expect([warningBorder[0], warningBorder[1], warningBorder[2]]).toEqual([
      warningRgb[0],
      warningRgb[1],
      warningRgb[2],
    ]);

    const warningIconBadge = cardWarning.querySelector('.shrink-0.rounded-lg') as HTMLElement;
    expect(warningIconBadge).not.toBeNull();
    const warningIconStyle = window.getComputedStyle(warningIconBadge);
    expect(warningIconStyle.color).toBe(resolveLiveTokenComputed('--color-status-warning'));
    const warningIconBg = parseCssColor(warningIconStyle.backgroundColor);
    expect(warningIconBg[3]).toBeCloseTo(0.1, 2);
    expect([warningIconBg[0], warningIconBg[1], warningIconBg[2]]).toEqual([
      warningRgb[0],
      warningRgb[1],
      warningRgb[2],
    ]);

    // 3. Info variant assertions
    const cardInfo = canvas.getByTestId('card-info');
    const styleInfo = window.getComputedStyle(cardInfo);
    expect(styleInfo.color).toBe(resolveLiveTokenComputed('--color-fg-primary'));
    expect(styleInfo.backgroundColor).toBe(resolveLiveTokenComputed('--color-surface'));
    expect(styleInfo.borderColor).toBe(resolveLiveTokenComputed('--color-border'));

    const infoIconBadge = cardInfo.querySelector('.shrink-0.rounded-lg') as HTMLElement;
    expect(infoIconBadge).not.toBeNull();
    const infoIconStyle = window.getComputedStyle(infoIconBadge);
    expect(infoIconStyle.backgroundColor).toBe(resolveLiveTokenComputed('--color-surface-raised'));
    expect(infoIconStyle.borderColor).toBe(resolveLiveTokenComputed('--color-border'));
    const infoIconSvg = infoIconBadge.querySelector('svg') as SVGElement;
    expect(infoIconSvg).not.toBeNull();
    expect(window.getComputedStyle(infoIconSvg).color).toBe(resolveLiveTokenComputed('--color-accent'));

    // 4. RetryButton icon contrast (default & deterministic hover)
    const iconBtn = canvas.getByTestId('retry-btn-icon');
    const iconStyle = window.getComputedStyle(iconBtn);
    expect(iconStyle.color).toBe(resolveLiveTokenComputed('--color-accent'));

    const accentRgb = resolveLiveTokenRgba('--color-accent');
    const fgAccent: [number, number, number] = [accentRgb[0], accentRgb[1], accentRgb[2]];

    const defaultBg = getEffectiveBackgroundColor(iconBtn);
    expect(contrastRatio(fgAccent, defaultBg)).toBeGreaterThanOrEqual(4.5);

    await hoverWithNoTransition(iconBtn);
    await waitFor(() => {
      const currentBg = window.getComputedStyle(iconBtn).backgroundColor;
      expect(currentBg).not.toBe('transparent');
      expect(currentBg).not.toBe('rgba(0, 0, 0, 0)');
    });
    const hoverBg = getEffectiveBackgroundColor(iconBtn);
    expect(contrastRatio(fgAccent, hoverBg)).toBeGreaterThanOrEqual(4.5);
    await unhoverWithNoTransition(iconBtn);

    // 5. Loading state icon rotation
    const loadingBtn = canvas.getByTestId('retry-btn-loading');
    const spinIcon = loadingBtn.querySelector('.animate-spin');
    expect(spinIcon).not.toBeNull();
  },
};
