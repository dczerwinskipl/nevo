import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { useLayoutEffect, useRef, useState } from 'react';

interface ColorTokenMeta {
  name: string;
  sourceLine: number;
  description: string;
}

interface ColorGroupMeta {
  title: string;
  sourceRange: string;
  description: string;
  tokens: ColorTokenMeta[];
}

const COLOR_GROUPS: ColorGroupMeta[] = [
  {
    title: 'Neutral Foundation',
    sourceRange: 'tools/dashboard/ui/index.css:6-14',
    description:
      'Neutral foundation tokens. These values must never be derived from --accent. Dashboard is dark-only (color-scheme: dark, no light theme toggle).',
    tokens: [
      { name: '--background', sourceLine: 6, description: 'Default canvas background' },
      { name: '--surface', sourceLine: 7, description: 'Base component surface' },
      { name: '--surface-raised', sourceLine: 8, description: 'Raised cards and modal panels' },
      { name: '--surface-hover', sourceLine: 9, description: 'Hover state for interactive surfaces' },
      { name: '--border', sourceLine: 10, description: 'Standard subtle border' },
      { name: '--border-strong', sourceLine: 11, description: 'Prominent structural border' },
      { name: '--foreground', sourceLine: 12, description: 'Primary high-contrast text' },
      { name: '--muted', sourceLine: 13, description: 'Secondary subdued text' },
      { name: '--muted-strong', sourceLine: 14, description: 'Readable prose and commentary' },
    ],
  },
  {
    title: 'Interaction & Active State',
    sourceRange: 'tools/dashboard/ui/index.css:17-21',
    description: 'Accent and interactive focus tokens.',
    tokens: [
      { name: '--accent', sourceLine: 17, description: 'Primary brand and action color' },
      { name: '--accent-strong', sourceLine: 18, description: 'Active and pressed states' },
      { name: '--accent-foreground', sourceLine: 19, description: 'High-contrast text on accent' },
      { name: '--accent-muted', sourceLine: 20, description: 'Subtle accent wash' },
      { name: '--accent-border', sourceLine: 21, description: 'Accent border highlight' },
    ],
  },
  {
    title: 'Semantic State',
    sourceRange: 'tools/dashboard/ui/index.css:24-39',
    description: 'Status feedback colors: success, warning, danger, info.',
    tokens: [
      { name: '--success', sourceLine: 24, description: 'Completed and verified state' },
      { name: '--success-strong', sourceLine: 25, description: 'Prominent success accent' },
      { name: '--success-muted', sourceLine: 26, description: 'Subtle success background' },
      { name: '--success-border', sourceLine: 27, description: 'Success border' },

      { name: '--warning', sourceLine: 28, description: 'In-review or attention-required state' },
      { name: '--warning-strong', sourceLine: 29, description: 'Prominent warning text' },
      { name: '--warning-muted', sourceLine: 30, description: 'Subtle warning background' },
      { name: '--warning-border', sourceLine: 31, description: 'Warning border' },

      { name: '--danger', sourceLine: 32, description: 'Error and failure state' },
      { name: '--danger-strong', sourceLine: 33, description: 'Prominent danger text' },
      { name: '--danger-muted', sourceLine: 34, description: 'Subtle danger background' },
      { name: '--danger-border', sourceLine: 35, description: 'Danger border' },

      { name: '--info', sourceLine: 36, description: 'Informational and ready state' },
      { name: '--info-strong', sourceLine: 37, description: 'Prominent info text' },
      { name: '--info-muted', sourceLine: 38, description: 'Subtle info background' },
      { name: '--info-border', sourceLine: 39, description: 'Info border' },
    ],
  },
  {
    title: 'Lane Presentation',
    sourceRange: 'tools/dashboard/ui/index.css:42-48',
    description: 'Workflow lane badges and status indicators.',
    tokens: [
      { name: '--lane-new', sourceLine: 42, description: 'New change lane' },
      { name: '--lane-design', sourceLine: 43, description: 'Design lane' },
      { name: '--lane-ready', sourceLine: 44, description: 'Ready for implementation lane' },
      { name: '--lane-implementation', sourceLine: 45, description: 'In-implementation lane' },
      { name: '--lane-review', sourceLine: 46, description: 'In-review lane' },
      { name: '--lane-done', sourceLine: 47, description: 'Done / verified lane' },
      { name: '--lane-danger', sourceLine: 48, description: 'Blocked / danger lane' },
    ],
  },
  {
    title: 'Categories',
    sourceRange: 'tools/dashboard/ui/index.css:50-51',
    description: 'Category accent tokens.',
    tokens: [
      { name: '--cat-1', sourceLine: 50, description: 'Category 1 accent' },
      { name: '--cat-2', sourceLine: 51, description: 'Category 2 accent' },
    ],
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
    const root = window.getComputedStyle(document.documentElement);
    const declared = root.getPropertyValue(token.name).trim();
    setDeclaredValue(declared);
  }, [token.name]);

  return (
    <div
      data-token={token.name}
      className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-xs shadow-xs"
    >
      <div className="mb-2.5 flex items-center gap-2.5">
        <div
          ref={probeRef}
          data-probe="true"
          className="size-9 shrink-0 rounded-md border border-[var(--border-strong)]"
          style={{ backgroundColor: `var(${token.name})` }}
        />
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono font-medium text-[var(--foreground)]">{token.name}</div>
          <div data-computed-color="true" className="truncate font-mono text-[11px] text-[var(--muted-strong)]">
            {computedColor || 'resolving…'}
          </div>
          {declaredValue && (
            <div data-declared-value="true" className="truncate font-mono text-[10px] text-[var(--muted)]">
              decl: {declaredValue}
            </div>
          )}
        </div>
      </div>
      <div className="text-[11px] text-[var(--muted)]">
        {token.description} <span className="text-[10px] text-[var(--muted)]">(:{token.sourceLine})</span>
      </div>
    </div>
  );
}

function ColorPaletteFoundation() {
  return (
    <div className="space-y-8 p-6 text-[var(--foreground)]">
      <div>
        <h1 className="text-2xl font-bold">Color Foundation Tokens</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Live tokens declared in <code className="text-[var(--foreground)]">tools/dashboard/ui/index.css:6-51</code>.
          Values shown are read live via <code className="text-[var(--foreground)]">getComputedStyle</code> from
          rendered probes and CSS declarations. The dashboard is exclusively dark-mode (
          <code className="text-[var(--foreground)]">color-scheme: dark</code>). No alternate light theme exists.
        </p>
      </div>

      {COLOR_GROUPS.map((group) => (
        <section key={group.title} className="space-y-3">
          <div className="border-b border-[var(--border)] pb-2">
            <h2 className="text-lg font-semibold">{group.title}</h2>
            <p className="text-xs text-[var(--muted)]">
              {group.description} ({group.sourceRange})
            </p>
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
    expect(cards.length).toBe(39); // 9 neutral + 5 interaction + 16 semantic + 7 lane + 2 categories

    const rootStyle = window.getComputedStyle(document.documentElement);

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

      // Verify the card display text matches the probe's computed value
      const displayedComputed = card.querySelector('[data-computed-color="true"]')?.textContent?.trim();
      expect(displayedComputed).toBe(computedBg);

      // Verify live CSS declaration on :root matches
      const liveDecl = rootStyle.getPropertyValue(tokenName!).trim();
      expect(liveDecl).toBeTruthy();
      const displayedDecl = card.querySelector('[data-declared-value="true"]')?.textContent?.trim();
      expect(displayedDecl).toBe(`decl: ${liveDecl}`);
    }
  },
};
