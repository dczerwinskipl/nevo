import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { useState } from 'react';
import { Trash2 } from 'lucide-react';

import { Button } from './button';
import { Badge } from './badge';
import { Card } from './card';
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './dialog';
import { Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle, SheetDescription } from './sheet';
import { StatusCard, RetryButton } from './status-card';
import { Progress } from './progress';
import { LoadingScreen } from '@/shared/ui/loading-screen';
import {
  resolveLiveTokenComputed,
  resolveLiveTokenRgba,
  parseCssColor,
  contrastRatio,
  getEffectiveBackgroundColor,
  hoverWithNoTransition,
  unhoverWithNoTransition,
} from './storybook-test-helpers';

const meta: Meta = {
  title: 'Components/UI/SharedPrimitives',
  parameters: {
    layout: 'padded',
  },
};

export default meta;
type Story = StoryObj;

// --- Story 1: Button Variants & Contrast ---

export const Buttons: Story = {
  render: () => (
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
  ),
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

// --- Story 2: Realistic Delete Session Context (Task 06 Planning) ---

export const DeleteSessionContext: Story = {
  render: () => (
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

// --- Story 3: Badge & Card Primitives ---

export const BadgeAndCard: Story = {
  render: () => (
    <div className="space-y-4">
      <Badge data-testid="test-badge">Status Token</Badge>
      <Card data-testid="test-card" className="p-4">
        <p className="text-fg-primary">Card Surface Content</p>
        <p className="text-xs text-fg-muted">Subtext inside card</p>
      </Card>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const badge = canvas.getByTestId('test-badge');
    const badgeStyle = window.getComputedStyle(badge);
    expect(badgeStyle.color).toBe(resolveLiveTokenComputed('--color-fg-muted'));
    expect(badgeStyle.backgroundColor).toBe(resolveLiveTokenComputed('--color-surface-raised'));
    expect(badgeStyle.borderColor).toBe(resolveLiveTokenComputed('--color-border'));

    const card = canvas.getByTestId('test-card');
    const cardStyle = window.getComputedStyle(card);
    expect(cardStyle.backgroundColor).toBe(resolveLiveTokenComputed('--color-surface'));
    expect(cardStyle.borderColor).toBe(resolveLiveTokenComputed('--color-border'));
  },
};

// --- Story 4: Dialog Interaction & Overlay Token ---

function DialogDemo() {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button data-testid="open-dialog-btn" variant="secondary">
          Otwórz okno dialogowe
        </Button>
      </DialogTrigger>
      <DialogContent data-testid="dialog-content">
        <DialogHeader>
          <DialogTitle data-testid="dialog-title">Tytuł okna dialogowego</DialogTitle>
          <DialogDescription data-testid="dialog-desc">
            To jest opis okna dialogowego weryfikujący tokeny semantyczne.
          </DialogDescription>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  );
}

export const DialogInteractive: Story = {
  render: () => <DialogDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const openBtn = canvas.getByTestId('open-dialog-btn');

    // 1. Initially closed
    expect(document.querySelector('[data-testid="dialog-content"]')).toBeNull();

    // 2. Open dialog
    await userEvent.click(openBtn);
    const content = await within(document.body).findByTestId('dialog-content');
    expect(content).not.toBeNull();

    // 3. Scoped portal selectors for overlay token
    const portalContainer = content.parentElement;
    expect(portalContainer).not.toBeNull();
    const overlay = portalContainer!.querySelector('.bg-backdrop') as HTMLElement;
    expect(overlay).not.toBeNull();
    const overlayColor = parseCssColor(window.getComputedStyle(overlay).backgroundColor);
    const expectedBackdrop = resolveLiveTokenRgba('--color-backdrop');
    expect(overlayColor[0]).toBe(expectedBackdrop[0]);
    expect(overlayColor[1]).toBe(expectedBackdrop[1]);
    expect(overlayColor[2]).toBe(expectedBackdrop[2]);
    expect(overlayColor[3]).toBeCloseTo(expectedBackdrop[3], 2);

    // 4. Scoped title and description colors
    const title = within(content).getByTestId('dialog-title');
    expect(window.getComputedStyle(title).color).toBe(resolveLiveTokenComputed('--color-fg-primary'));

    const desc = within(content).getByTestId('dialog-desc');
    expect(window.getComputedStyle(desc).color).toBe(resolveLiveTokenComputed('--color-fg-muted'));

    // 5. Close dialog and assert content is removed from DOM
    const closeBtn = within(content).getByRole('button', { name: 'Zamknij' });
    await userEvent.click(closeBtn);
    await waitFor(() => {
      expect(document.querySelector('[data-testid="dialog-content"]')).toBeNull();
    });
  },
};

// --- Story 5: Sheet Interaction & Overlay Token ---

function SheetDemo() {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button data-testid="open-sheet-btn" variant="secondary">
          Otwórz boczny arkusz
        </Button>
      </SheetTrigger>
      <SheetContent side="right" data-testid="sheet-content">
        <SheetHeader>
          <SheetTitle data-testid="sheet-title">Tytuł arkusza</SheetTitle>
          <SheetDescription data-testid="sheet-desc">Boczny arkusz z semantycznym tłem i nakładką.</SheetDescription>
        </SheetHeader>
      </SheetContent>
    </Sheet>
  );
}

export const SheetInteractive: Story = {
  render: () => <SheetDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const openBtn = canvas.getByTestId('open-sheet-btn');

    // 1. Initially closed
    expect(document.querySelector('[data-testid="sheet-content"]')).toBeNull();

    // 2. Open sheet
    await userEvent.click(openBtn);
    const content = await within(document.body).findByTestId('sheet-content');
    expect(content).not.toBeNull();

    // 3. Scoped portal selectors for overlay token
    const portalContainer = content.parentElement;
    expect(portalContainer).not.toBeNull();
    const overlay = portalContainer!.querySelector('.bg-backdrop') as HTMLElement;
    expect(overlay).not.toBeNull();
    const overlayColor = parseCssColor(window.getComputedStyle(overlay).backgroundColor);
    const expectedBackdrop = resolveLiveTokenRgba('--color-backdrop');
    expect(overlayColor[0]).toBe(expectedBackdrop[0]);
    expect(overlayColor[1]).toBe(expectedBackdrop[1]);
    expect(overlayColor[2]).toBe(expectedBackdrop[2]);
    expect(overlayColor[3]).toBeCloseTo(expectedBackdrop[3], 2);

    // 4. Verify sheet content uses surface-raised
    const contentStyle = window.getComputedStyle(content);
    expect(contentStyle.backgroundColor).toBe(resolveLiveTokenComputed('--color-surface-raised'));

    // 5. Close sheet and assert content is removed from DOM
    const closeBtn = within(content).getByRole('button', { name: 'Zamknij' });
    await userEvent.click(closeBtn);
    await waitFor(() => {
      expect(document.querySelector('[data-testid="sheet-content"]')).toBeNull();
    });
  },
};

// --- Story 6: StatusCard Variants & Retry Contrast ---

export const StatusCards: Story = {
  render: () => (
    <div className="max-w-xl space-y-4">
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
  ),
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

// --- Story 7: Progress and LoadingScreen Primitives ---

export const ProgressAndLoading: Story = {
  render: () => (
    <div className="max-w-xl space-y-8">
      <div data-testid="progress-wrapper">
        <Progress value={65} />
      </div>
      <div data-testid="loading-screen-wrapper">
        <LoadingScreen />
      </div>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // 1. Progress track and indicator
    const progressWrapper = canvas.getByTestId('progress-wrapper');
    const progressBar = progressWrapper.querySelector('[role="progressbar"]') as HTMLElement;
    expect(progressBar).not.toBeNull();
    const trackStyle = window.getComputedStyle(progressBar);
    const trackColor = parseCssColor(trackStyle.backgroundColor);
    const fgPrimaryRgb = resolveLiveTokenRgba('--color-fg-primary');
    expect(trackColor[0]).toBe(fgPrimaryRgb[0]);
    expect(trackColor[1]).toBe(fgPrimaryRgb[1]);
    expect(trackColor[2]).toBe(fgPrimaryRgb[2]);
    expect(trackColor[3]).toBeCloseTo(0.07, 2);

    const indicator = progressBar.firstElementChild as HTMLElement;
    expect(indicator).not.toBeNull();
    const indicatorStyle = window.getComputedStyle(indicator);
    expect(indicatorStyle.backgroundColor).toBe(resolveLiveTokenComputed('--color-accent'));

    // 2. LoadingScreen skeleton elements
    const loadingWrapper = canvas.getByTestId('loading-screen-wrapper');
    expect(loadingWrapper.querySelector('.animate-pulse')).not.toBeNull();
  },
};

// --- Story 8: Live Token Resolution and Color Parser ---

export const LiveTokenResolver: Story = {
  render: () => (
    <div className="space-y-2 p-4">
      <div data-testid="token-resolver-probe" className="rounded bg-surface p-3 text-fg-primary">
        Live Token and Browser Canvas Parser Verification
      </div>
    </div>
  ),
  play: async () => {
    // 1. Resolving a nonexistent token throws explicitly
    expect(() => resolveLiveTokenComputed('--color-nonexistent')).toThrow(
      'CSS token "--color-nonexistent" is not defined on document.documentElement',
    );

    // 2. A live opaque semantic token resolves correctly
    const accentRgba = resolveLiveTokenRgba('--color-accent');
    expect(accentRgba).toEqual([56, 130, 246, 1]);
    expect(resolveLiveTokenComputed('--color-accent')).toBe('rgb(56, 130, 246)');

    // 3. The backdrop token preserves alpha fidelity
    const backdropRgba = resolveLiveTokenRgba('--color-backdrop');
    expect(backdropRgba[0]).toBe(0);
    expect(backdropRgba[1]).toBe(0);
    expect(backdropRgba[2]).toBe(0);
    expect(backdropRgba[3]).toBeCloseTo(0.7, 1);

    // 4. The browser-backed resolver handles representative modern computed color (such as oklab(...))
    const oklabRgba = parseCssColor('oklab(0.636841 0.187884 0.0889429)');
    expect(oklabRgba).toEqual([239, 68, 68, 1]);

    // 5. Unsupported or invalid CSS color syntax throws explicitly instead of defaulting to black
    expect(() => parseCssColor('not-a-valid-css-color')).toThrow(
      'Unsupported or invalid CSS color syntax: "not-a-valid-css-color"',
    );
  },
};
