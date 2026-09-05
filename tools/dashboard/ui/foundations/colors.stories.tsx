import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { useLayoutEffect, useRef, useState } from 'react';
import { resolveLiveToken, resolveLiveTokenComputed, resolveLiveTokenRgba, contrastRatio } from '@storybook-test-utils';

interface ColorTokenMeta {
  name: string;
  description: string;
}

interface ColorGroupMeta {
  title: string;
  description: string;
  tokens: ColorTokenMeta[];
}

const COLOR_GROUPS: ColorGroupMeta[] = [
  {
    title: 'Neutral Foundation',
    description:
      'Neutral foundation tokens for canvas, surfaces, and structural borders. Dark-only theme (color-scheme: dark).',
    tokens: [
      { name: '--color-background', description: 'Default canvas background' },
      { name: '--color-surface', description: 'Base component surface' },
      { name: '--color-surface-raised', description: 'Raised cards, dropdowns, and modal panels' },
      { name: '--color-surface-hover', description: 'Hover state for interactive surfaces' },
      { name: '--color-border', description: 'Standard subtle border' },
      { name: '--color-border-strong', description: 'Prominent structural border' },
    ],
  },
  {
    title: 'Foreground Hierarchy',
    description: 'Text and iconography contrast hierarchy across neutral and accent surfaces.',
    tokens: [
      { name: '--color-fg-primary', description: 'Primary high-contrast text and headers' },
      { name: '--color-fg-secondary', description: 'Secondary subdued text and metadata' },
      { name: '--color-fg-muted', description: 'Muted captions, placeholders, and icons' },
      { name: '--color-fg-on-accent', description: 'High-contrast text on solid accent backgrounds' },
    ],
  },
  {
    title: 'Interaction & Accent',
    description: 'Primary interaction, focus, and solid button fills.',
    tokens: [
      { name: '--color-accent', description: 'Interactive focus, links, and highlights' },
      { name: '--color-accent-solid', description: 'Solid button fill and active toggles' },
    ],
  },
  {
    title: 'Canonical Status',
    description: 'Semantic status vocabulary covering all 7 StatusTone values.',
    tokens: [
      { name: '--color-status-success', description: 'Success and verified states' },
      { name: '--color-status-warning', description: 'Warning and review-required states' },
      { name: '--color-status-error', description: 'Error and failure states' },
      { name: '--color-status-attention', description: 'Attention and notice states' },
      { name: '--color-status-info', description: 'Informational and readiness states' },
      { name: '--color-status-active', description: 'Running and in-progress operational states' },
      { name: '--color-status-neutral', description: 'Neutral and default fallback state' },
    ],
  },
  {
    title: 'Action Role',
    description: 'Destructive action indicator and buttons.',
    tokens: [{ name: '--color-action-destructive', description: 'Destructive delete/terminate action' }],
  },
  {
    title: 'Provider & Workflow',
    description: 'Agent provider accents and workflow lane highlights.',
    tokens: [
      { name: '--color-provider-claude', description: 'Claude agent provider badge/indicator' },
      { name: '--color-provider-antigravity', description: 'Antigravity agent provider badge/indicator' },
      { name: '--color-workflow-design', description: 'Design workflow stage badge' },
    ],
  },
  {
    title: 'Diff Statistics',
    description: 'Git diff addition and deletion statistics.',
    tokens: [
      { name: '--color-diff-addition', description: 'Diff lines added count' },
      { name: '--color-diff-deletion', description: 'Diff lines deleted count' },
    ],
  },
  {
    title: 'Overlay',
    description: 'Modal and drawer backdrop dimming.',
    tokens: [{ name: '--color-backdrop', description: 'Semi-transparent modal overlay' }],
  },
];

function ColorTokenCard({ token }: { token: ColorTokenMeta }) {
  const probeRef = useRef<HTMLDivElement>(null);
  const [computedColor, setComputedColor] = useState<string>('');
  const [declaredValue, setDeclaredValue] = useState<string>('');

  useLayoutEffect(() => {
    if (probeRef.current) {
      const computed = window.getComputedStyle(probeRef.current).backgroundColor;
      setComputedColor(computed);
    }
    try {
      const declared = resolveLiveToken(token.name);
      setDeclaredValue(declared);
    } catch {
      setDeclaredValue('');
    }
  }, [token.name]);

  return (
    <div
      data-token={token.name}
      className="overflow-hidden rounded-xl border border-border bg-surface p-3.5 text-xs shadow-xs"
    >
      <div className="mb-2.5 flex items-center gap-2.5">
        <div
          ref={probeRef}
          data-probe="true"
          className="size-9 shrink-0 rounded-lg border border-border-strong"
          style={{ backgroundColor: `var(${token.name})` }}
        />
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono font-medium text-fg-primary">{token.name}</div>
          <div data-computed-color="true" className="truncate font-mono text-[11px] text-fg-secondary">
            {computedColor || 'resolving…'}
          </div>
          {declaredValue && (
            <div data-declared-value="true" className="truncate font-mono text-[10px] text-fg-muted">
              decl: {declaredValue}
            </div>
          )}
        </div>
      </div>
      <div className="text-[11px] text-fg-muted">{token.description}</div>
    </div>
  );
}

function FilledButtonContrastDemo() {
  const fgRgba = resolveLiveTokenRgba('--color-fg-on-accent');
  const bgRgba = resolveLiveTokenRgba('--color-accent-solid');
  const ratio = contrastRatio([fgRgba[0], fgRgba[1], fgRgba[2]], [bgRgba[0], bgRgba[1], bgRgba[2]]);

  return (
    <div
      data-testid="filled-button-contrast-demo"
      className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-surface-raised p-4"
    >
      <div>
        <h3 className="text-sm font-semibold text-fg-primary">Filled Button Contrast Pair</h3>
        <p className="text-xs text-fg-muted">WCAG 2.1 AA requirement: ≥ 4.5:1 for normal text.</p>
      </div>
      <div className="flex items-center gap-4">
        <div
          data-testid="filled-button-sample"
          className="rounded-lg bg-accent-solid px-4 py-2 font-medium text-fg-on-accent shadow-xs"
        >
          Primary Button
        </div>
        <div className="font-mono text-xs">
          <span className="text-fg-muted">Ratio: </span>
          <span data-testid="contrast-ratio-value" className="font-bold text-status-success">
            {ratio.toFixed(2)}:1
          </span>
        </div>
      </div>
    </div>
  );
}

function ColorPaletteFoundation() {
  return (
    <div className="space-y-8 p-6 text-fg-primary">
      <div>
        <h1 className="text-2xl font-bold text-fg-primary">Color Foundation Tokens</h1>
        <p className="mt-1 text-sm text-fg-muted">
          Semantic tokens declared in Tailwind CSS v4 <code className="text-fg-primary">@theme static</code> block in{' '}
          <code className="text-fg-primary">tools/dashboard/ui/index.css</code>. Values shown are read live via{' '}
          <code className="text-fg-primary">getComputedStyle</code> from rendered probes and CSS declarations.
        </p>
      </div>

      <FilledButtonContrastDemo />

      {COLOR_GROUPS.map((group) => (
        <section key={group.title} className="space-y-3">
          <div className="border-b border-border pb-2">
            <h2 className="text-lg font-semibold text-fg-primary">{group.title}</h2>
            <p className="text-xs text-fg-muted">{group.description}</p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {group.tokens.map((token) => (
              <ColorTokenCard key={token.name} token={token} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

const meta: Meta<typeof ColorPaletteFoundation> = {
  title: 'Foundations/Colors',
  component: ColorPaletteFoundation,
};

export default meta;
type Story = StoryObj<typeof ColorPaletteFoundation>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const cards = canvasElement.querySelectorAll<HTMLElement>('[data-token]');
    const totalExpectedTokens = COLOR_GROUPS.reduce((acc, g) => acc + g.tokens.length, 0);
    expect(cards.length).toBe(totalExpectedTokens);

    for (const card of cards) {
      const tokenName = card.getAttribute('data-token');
      expect(tokenName).toBeTruthy();

      const probe = card.querySelector<HTMLElement>('[data-probe="true"]');
      expect(probe).not.toBeNull();

      // Read computed background-color from the live probe element
      const computedBg = window.getComputedStyle(probe!).backgroundColor;
      expect(computedBg).toBeTruthy();
      expect(computedBg).not.toBe('');
      expect(computedBg).not.toBe('rgba(0, 0, 0, 0)');

      // Verify probe computed matches resolveLiveTokenComputed
      const liveComputed = resolveLiveTokenComputed(tokenName!);
      expect(computedBg).toBe(liveComputed);

      // Verify the card display text matches the probe's computed value
      const displayedComputed = card.querySelector('[data-computed-color="true"]')?.textContent?.trim();
      expect(displayedComputed).toBe(computedBg);

      // Verify live CSS declaration on :root matches
      const liveDecl = resolveLiveToken(tokenName!);
      expect(liveDecl).toBeTruthy();
      const displayedDecl = card.querySelector('[data-declared-value="true"]')?.textContent?.trim();
      expect(displayedDecl).toBe(`decl: ${liveDecl}`);
    }

    // Verify filled-button pair contrast ≥ 4.5:1
    const fgOnAccent = resolveLiveTokenRgba('--color-fg-on-accent');
    const accentSolid = resolveLiveTokenRgba('--color-accent-solid');
    const ratio = contrastRatio(
      [fgOnAccent[0], fgOnAccent[1], fgOnAccent[2]],
      [accentSolid[0], accentSolid[1], accentSolid[2]],
    );
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  },
};
