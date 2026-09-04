import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
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

// --- Color & Contrast Utilities ---

function parseColorToRgba(str: string): [number, number, number, number] {
  // If rgba / rgb format:
  const rgbMatch = str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (rgbMatch) {
    return [
      parseInt(rgbMatch[1], 10),
      parseInt(rgbMatch[2], 10),
      parseInt(rgbMatch[3], 10),
      rgbMatch[4] !== undefined ? parseFloat(rgbMatch[4]) : 1,
    ];
  }

  // If oklab format: oklab(L a b / alpha) or oklab(L a b)
  const oklabMatch = str.match(/oklab\(([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)(?:\s*\/\s*([\d.]+%?))?\)/);
  if (oklabMatch) {
    const L = parseFloat(oklabMatch[1]);
    const a = parseFloat(oklabMatch[2]);
    const b = parseFloat(oklabMatch[3]);
    let alpha = 1;
    if (oklabMatch[4]) {
      alpha = oklabMatch[4].endsWith('%') ? parseFloat(oklabMatch[4]) / 100 : parseFloat(oklabMatch[4]);
    }
    const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = L - 0.0894841775 * a - 1.291485548 * b;
    const l = l_ * l_ * l_;
    const m = m_ * m_ * m_;
    const s = s_ * s_ * s_;
    let r = +4.0767439362 * l - 3.3077115913 * m + 0.2309699292 * s;
    let g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
    let bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
    r = r <= 0.0031308 ? 12.92 * r : 1.055 * Math.pow(r, 1 / 2.4) - 0.055;
    g = g <= 0.0031308 ? 12.92 * g : 1.055 * Math.pow(g, 1 / 2.4) - 0.055;
    bl = bl <= 0.0031308 ? 12.92 * bl : 1.055 * Math.pow(bl, 1 / 2.4) - 0.055;
    return [
      Math.round(Math.max(0, Math.min(255, r * 255))),
      Math.round(Math.max(0, Math.min(255, g * 255))),
      Math.round(Math.max(0, Math.min(255, bl * 255))),
      alpha,
    ];
  }

  return [0, 0, 0, 1];
}

function srgbToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function relLuminance(rgb: [number, number, number]): number {
  return 0.2126 * srgbToLinear(rgb[0]) + 0.7152 * srgbToLinear(rgb[1]) + 0.0722 * srgbToLinear(rgb[2]);
}

function contrastRatio(rgb1: [number, number, number], rgb2: [number, number, number]): number {
  const l1 = relLuminance(rgb1);
  const l2 = relLuminance(rgb2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function compositeOver(
  fg: [number, number, number, number],
  bg: [number, number, number, number],
): [number, number, number, number] {
  const alphaOut = fg[3] + bg[3] * (1 - fg[3]);
  if (alphaOut === 0) return [0, 0, 0, 0];
  const r = (fg[0] * fg[3] + bg[0] * bg[3] * (1 - fg[3])) / alphaOut;
  const g = (fg[1] * fg[3] + bg[1] * bg[3] * (1 - fg[3])) / alphaOut;
  const b = (fg[2] * fg[3] + bg[2] * bg[3] * (1 - fg[3])) / alphaOut;
  return [Math.round(r), Math.round(g), Math.round(b), alphaOut];
}

function getEffectiveBackgroundColor(el: HTMLElement): [number, number, number] {
  const stack: [number, number, number, number][] = [];
  let curr: HTMLElement | null = el;
  while (curr && curr !== document.documentElement) {
    const bg = window.getComputedStyle(curr).backgroundColor;
    if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') {
      stack.unshift(parseColorToRgba(bg));
    }
    curr = curr.parentElement;
  }
  let comp: [number, number, number, number] = [9, 10, 13, 1]; // #090a0d base background
  for (const layer of stack) {
    comp = compositeOver(layer, comp);
  }
  return [comp[0], comp[1], comp[2]];
}

// --- Meta ---

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
    expect(styleDefault.backgroundColor).toBe('rgb(29, 78, 216)'); // --color-accent-solid
    expect(styleDefault.color).toBe('rgb(248, 250, 252)'); // --color-fg-on-accent

    // 2. Secondary button: surface-raised with border and fg-primary
    const btnSecondary = canvas.getByTestId('btn-secondary');
    const styleSecondary = window.getComputedStyle(btnSecondary);
    expect(styleSecondary.backgroundColor).toBe('rgb(20, 23, 29)'); // --color-surface-raised
    expect(styleSecondary.borderColor).toBe('rgb(37, 42, 51)'); // --color-border
    expect(styleSecondary.color).toBe('rgb(241, 243, 245)'); // --color-fg-primary

    // 3. Ghost button: muted text, transparent background
    const btnGhost = canvas.getByTestId('btn-ghost');
    const styleGhost = window.getComputedStyle(btnGhost);
    expect(styleGhost.color).toBe('rgb(146, 155, 170)'); // --color-fg-muted

    // 4. Disabled button: opacity 50%
    const btnDisabled = canvas.getByTestId('btn-disabled');
    const styleDisabled = window.getComputedStyle(btnDisabled);
    expect(styleDisabled.opacity).toBe('0.5');

    // 5. Destructive button: contrast in default and hover state
    const btnDestructive = canvas.getByTestId('btn-destructive');
    const styleDestructive = window.getComputedStyle(btnDestructive);
    expect(styleDestructive.color).toBe('rgb(239, 68, 68)'); // --color-action-destructive

    // Check default contrast against effective background (transparent over surface-raised #14171d)
    const fgDestructive: [number, number, number] = [239, 68, 68];
    const defaultBg = getEffectiveBackgroundColor(btnDestructive);
    const defaultContrast = contrastRatio(fgDestructive, defaultBg);
    expect(defaultContrast).toBeGreaterThanOrEqual(4.5);

    // Hover destructive button
    await userEvent.hover(btnDestructive);
    const hoverBg = getEffectiveBackgroundColor(btnDestructive);
    const hoverContrast = contrastRatio(fgDestructive, hoverBg);
    expect(hoverContrast).toBeGreaterThanOrEqual(4.5);
    await userEvent.unhover(btnDestructive);
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
    expect(styleBtn.color).toBe('rgb(239, 68, 68)'); // --color-action-destructive

    const fg: [number, number, number] = [239, 68, 68];

    // Default state contrast in realistic container
    const defaultBg = getEffectiveBackgroundColor(btn);
    const defaultContrast = contrastRatio(fg, defaultBg);
    expect(defaultContrast).toBeGreaterThanOrEqual(4.5);

    // Hover state contrast in realistic container
    await userEvent.hover(btn);
    const hoverBg = getEffectiveBackgroundColor(btn);
    const hoverContrast = contrastRatio(fg, hoverBg);
    expect(hoverContrast).toBeGreaterThanOrEqual(4.5);
    await userEvent.unhover(btn);
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
    expect(badgeStyle.color).toBe('rgb(146, 155, 170)'); // --color-fg-muted
    expect(badgeStyle.backgroundColor).toBe('rgb(20, 23, 29)'); // --color-surface-raised
    expect(badgeStyle.borderColor).toBe('rgb(37, 42, 51)'); // --color-border

    const card = canvas.getByTestId('test-card');
    const cardStyle = window.getComputedStyle(card);
    expect(cardStyle.backgroundColor).toBe('rgb(15, 17, 22)'); // --color-surface
    expect(cardStyle.borderColor).toBe('rgb(37, 42, 51)'); // --color-border
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

    // 3. Verify overlay token is semantic backdrop: rgba(0, 0, 0, 0.7)
    const overlay = document.querySelector('.bg-backdrop') as HTMLElement;
    expect(overlay).not.toBeNull();
    const overlayColor = parseColorToRgba(window.getComputedStyle(overlay).backgroundColor);
    expect(overlayColor[0]).toBe(0);
    expect(overlayColor[1]).toBe(0);
    expect(overlayColor[2]).toBe(0);
    expect(overlayColor[3]).toBeCloseTo(0.7, 1);

    // 4. Verify title and description colors
    const title = within(document.body).getByTestId('dialog-title');
    expect(window.getComputedStyle(title).color).toBe('rgb(241, 243, 245)'); // --color-fg-primary

    const desc = within(document.body).getByTestId('dialog-desc');
    expect(window.getComputedStyle(desc).color).toBe('rgb(146, 155, 170)'); // --color-fg-muted

    // 5. Close dialog
    const closeBtn = document.querySelector('button[aria-label="Zamknij"]') as HTMLButtonElement;
    expect(closeBtn).not.toBeNull();
    await userEvent.click(closeBtn);
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

    // 3. Verify overlay token
    const overlay = document.querySelector('.bg-backdrop') as HTMLElement;
    expect(overlay).not.toBeNull();
    const overlayColor = parseColorToRgba(window.getComputedStyle(overlay).backgroundColor);
    expect(overlayColor[0]).toBe(0);
    expect(overlayColor[1]).toBe(0);
    expect(overlayColor[2]).toBe(0);
    expect(overlayColor[3]).toBeCloseTo(0.7, 1);

    // 4. Verify sheet content uses surface-raised
    const contentStyle = window.getComputedStyle(content);
    expect(contentStyle.backgroundColor).toBe('rgb(20, 23, 29)'); // --color-surface-raised

    // 5. Close sheet
    const closeBtn = document.querySelector('button[aria-label="Zamknij"]') as HTMLButtonElement;
    expect(closeBtn).not.toBeNull();
    await userEvent.click(closeBtn);
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

    // 1. Icon hover contrast on RetryButton (D4 fix)
    const iconBtn = canvas.getByTestId('retry-btn-icon');
    const iconStyle = window.getComputedStyle(iconBtn);
    expect(iconStyle.color).toBe('rgb(56, 130, 246)'); // --color-accent

    const fgAccent: [number, number, number] = [56, 130, 246];
    const defaultBg = getEffectiveBackgroundColor(iconBtn);
    expect(contrastRatio(fgAccent, defaultBg)).toBeGreaterThanOrEqual(4.5);

    await userEvent.hover(iconBtn);
    const hoverBg = getEffectiveBackgroundColor(iconBtn);
    expect(contrastRatio(fgAccent, hoverBg)).toBeGreaterThanOrEqual(4.5);
    await userEvent.unhover(iconBtn);

    // 2. Loading state icon rotation
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
    const trackColor = parseColorToRgba(trackStyle.backgroundColor);
    expect(trackColor[0]).toBe(241);
    expect(trackColor[1]).toBe(243);
    expect(trackColor[2]).toBe(245);
    expect(trackColor[3]).toBeCloseTo(0.07, 2);

    const indicator = progressBar.firstElementChild as HTMLElement;
    expect(indicator).not.toBeNull();
    const indicatorStyle = window.getComputedStyle(indicator);
    expect(indicatorStyle.backgroundColor).toBe('rgb(56, 130, 246)'); // --color-accent

    // 2. LoadingScreen skeleton elements
    const loadingWrapper = canvas.getByTestId('loading-screen-wrapper');
    expect(loadingWrapper.querySelector('.animate-pulse')).not.toBeNull();
  },
};
